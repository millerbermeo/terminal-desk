import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { ResultadoAgente } from '@shared/core/agente'
import type { InformeEval, ResultadoCaso } from '@shared/core/evals'
import { Agente } from '../agents/agente'
import { Harness, type Aprobador } from '../agents/harness'
import type { ProveedorLLM } from '../agents/llm/proveedor'
import { esDestructiva } from '../guardrails/destructivo'
import { MotorGuardrails } from '../guardrails/motor'
import type { Trazador } from '../tracing/trazador'
import { registrarIntegradas } from '../tools/integradas'
import { rutaSegura } from '../tools/integradas/ruta'
import { RegistroHerramientas } from '../tools/registro'
import { agenteEval } from './agente-eval'
import { evaluarAsercion } from './aserciones'
import type { CasoEval, SuiteEval } from './tipos'

export interface EntornoEval {
  llm: ProveedorLLM
  /** Modelo que juzga las aserciones `juez_llm` (por defecto, el mismo `llm`). */
  juez?: ProveedorLLM
  modeloJuez?: string
  modelo?: string
  trazador?: Trazador
  raiz?: string // carpeta donde se crean los proyectos temporales
  conservarProyectos?: boolean
}

/**
 * Aprobación automática SOLO para el proyecto temporal de la prueba: escribir sí; ejecutar solo binarios permitidos y nunca
 * algo destructivo. Ojo: no es un sandbox de seguridad (`node -e` puede hacer cualquier cosa): ejecuta únicamente casos de confianza.
 */
const aprobarEnSandbox = (permitidos: readonly string[]): Aprobador => async (llamada, riesgo) => {
  if (riesgo === 'escritura') return true
  if (riesgo !== 'ejecucion' || llamada.nombre !== 'ejecutar_comando') return false
  return permitidos.includes(basename(String(llamada.entrada.comando))) && esDestructiva(llamada.nombre, llamada.entrada) === null
}

async function crearProyecto(raiz: string, archivos: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(raiz, 'eval-'))
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = await rutaSegura(dir, ruta)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido, 'utf8')
  }
  return dir
}

export async function ejecutarCaso(caso: CasoEval, env: EntornoEval): Promise<ResultadoCaso> {
  const inicio = Date.now()
  const base = { id: caso.id, descripcion: caso.descripcion }
  const dir = await crearProyecto(env.raiz ?? tmpdir(), caso.archivos)
  const ejecucionId = randomUUID()
  const registro = new RegistroHerramientas()
  registrarIntegradas(registro)
  const def = { ...(caso.agente ?? agenteEval), ...(caso.maxPasos ? { maxPasos: caso.maxPasos } : {}) }
  const usadas = new Set<string>()
  let guardrailActivado = false
  const ctl = new AbortController()
  const temporizador = setTimeout(() => ctl.abort(), caso.timeoutMs ?? 300_000)
  env.trazador?.iniciar(ejecucionId, { prompt: caso.prompt, agente: def.nombre, modo: 'eval' })
  try {
    const harness = new Harness({
      llm: env.llm,
      registro,
      validar: new MotorGuardrails().validarLlamada,
      aprobar: aprobarEnSandbox(caso.comandosPermitidos ?? ['node']),
      ...(env.trazador ? { trazador: env.trazador } : {})
    })
    let resultado: ResultadoAgente
    try {
      resultado = await harness.ejecutar(new Agente(def), {
        prompt: caso.prompt,
        cwd: dir,
        ejecucionId,
        ...(env.modelo ? { modelo: env.modelo } : {}),
        senal: ctl.signal,
        alEvento: (e) => {
          env.trazador?.registrarEvento(e)
          if (e.tipo === 'herramienta_inicio') usadas.add(e.llamada.nombre)
          if (e.tipo === 'guardrail') guardrailActivado = true
        }
      })
    } catch (err) {
      return { ...base, pasa: false, aserciones: [], pasos: 0, uso: { tokensEntrada: 0, tokensSalida: 0 }, duracionMs: Date.now() - inicio, trazaId: ejecucionId, error: (err as Error).message }
    }
    const aserciones = [
      { tipo: 'agente_completa', ok: resultado.estado === 'completado', detalle: `estado del agente: ${resultado.estado}${resultado.error ? ` (${resultado.error})` : ''}` }
    ]
    for (const a of caso.aserciones) {
      aserciones.push(
        await evaluarAsercion(a, {
          dir, resultado, herramientasUsadas: usadas, guardrailActivado,
          juez: env.juez ?? env.llm,
          ...(env.modeloJuez ? { modeloJuez: env.modeloJuez } : {})
        })
      )
    }
    return {
      ...base,
      pasa: aserciones.every((a) => a.ok),
      aserciones,
      estadoAgente: resultado.estado,
      pasos: resultado.pasos,
      uso: resultado.uso,
      duracionMs: Date.now() - inicio,
      trazaId: ejecucionId
    }
  } finally {
    clearTimeout(temporizador)
    await env.trazador?.finalizar(ejecucionId)
    if (!env.conservarProyectos) await rm(dir, { recursive: true, force: true })
  }
}

export interface OpcionesSuite {
  /** Ids de los casos a ejecutar (todos si se omite). */
  casos?: readonly string[]
  alCaso?(r: ResultadoCaso): void
}

/** Ejecuta los casos de uno en uno (controla el gasto y los límites de la API) y consolida el informe. */
export async function ejecutarSuite(suite: SuiteEval, env: EntornoEval, o: OpcionesSuite = {}): Promise<InformeEval> {
  const inicio = Date.now()
  const casos = suite.casos.filter((c) => !o.casos || o.casos.includes(c.id))
  const resultados: ResultadoCaso[] = []
  for (const caso of casos) {
    const r = await ejecutarCaso(caso, env)
    resultados.push(r)
    o.alCaso?.(r)
  }
  const pasan = resultados.filter((r) => r.pasa).length
  const tasa = resultados.length ? pasan / resultados.length : 0
  const umbral = suite.umbral ?? 0.8
  return {
    suite: suite.id,
    fecha: new Date().toISOString(),
    ...(env.modelo ? { modelo: env.modelo } : {}),
    total: resultados.length,
    pasan,
    tasa,
    umbral,
    superaUmbral: resultados.length > 0 && tasa >= umbral,
    uso: resultados.reduce((u, r) => ({ tokensEntrada: u.tokensEntrada + r.uso.tokensEntrada, tokensSalida: u.tokensSalida + r.uso.tokensSalida }), { tokensEntrada: 0, tokensSalida: 0 }),
    duracionMs: Date.now() - inicio,
    casos: resultados
  }
}
