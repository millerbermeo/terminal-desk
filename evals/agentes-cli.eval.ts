import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LlamadaHerramienta } from '@shared/core/herramientas'
import type { Recurso } from '@shared/modelos'
import { archivosPlugin } from '../src/main/agentes'
import { AVISO_SUBAGENTES, guiaRecursos } from '../src/main/core/avisos'
import { ejecutarSuscripcion, type OpcionesEjecucion } from '../src/main/core/suscripcion'

/**
 * Cómo usa el Asistente (modo suscripción, `claude -p` con los MISMOS argumentos que la app) los agentes y skills del proyecto:
 * los usa solo cuando aportan, obedece cuando se le piden por nombre y no los invoca en tareas triviales. Mide además el consumo.
 * Consume de la suscripción: `ODESK_EVAL_CLI=1 pnpm evals -- agentes-cli` (modelo con `EVAL_CLI_MODELO`, por defecto sonnet).
 */

const MODELO = process.env.EVAL_CLI_MODELO ?? 'sonnet'

const RECURSOS: Recurso[] = [
  {
    id: 'a1',
    tipo: 'agente',
    nombre: 'Revisor de seguridad',
    descripcion: 'Auditor de seguridad. Úsalo cuando haya que revisar o auditar código en busca de vulnerabilidades (inyección SQL, XSS, secretos expuestos, validación de entradas).',
    contenido: 'Eres un auditor de seguridad. Lee el código indicado y devuelve una lista de vulnerabilidades con archivo:línea, gravedad (alta/media/baja) y la corrección propuesta. Sé breve.',
    herramientas: ['Read', 'Grep', 'Glob'],
    modelo: 'haiku',
    ambito: 'proyecto',
    proyectoId: 'p'
  },
  {
    id: 's1',
    tipo: 'skill',
    nombre: 'Formato de commit',
    descripcion: 'Convención de mensajes de commit de este proyecto. Úsala siempre que haya que escribir o proponer un mensaje de commit.',
    contenido: 'Formato obligatorio:\n\n```\n<tipo>(<ámbito>): <resumen en minúsculas, máx. 60 caracteres>\n\n<cuerpo opcional>\n\nRef: ODK-0\n```\n\nTipos: feat, fix, refactor, docs, test, chore. La última línea SIEMPRE es `Ref: ODK-0`.',
    ambito: 'proyecto',
    proyectoId: 'p'
  },
  {
    id: 's2',
    tipo: 'skill',
    nombre: 'Glosario de traducción',
    descripcion: 'Glosario oficial para traducir textos de la interfaz del español al inglés. Úsala cuando haya que traducir textos de la UI.',
    contenido: 'Glosario obligatorio (español → inglés):\n- Guardar cambios → Commit changes\n- Cancelar → Dismiss\n- Pedido → Ticket\n\nTraduce el resto de forma natural.',
    ambito: 'proyecto',
    proyectoId: 'p'
  }
]

const CODIGO: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'tienda', version: '1.0.0', type: 'module' }, null, 2),
  'src/suma.js': 'export function suma(a, b) {\n  return a + b\n}\n',
  'src/db.js':
    "import { pool } from './pool.js'\n\nexport async function buscarUsuario(req) {\n  const nombre = req.query.nombre\n  return pool.query(\"SELECT * FROM usuarios WHERE nombre = '\" + nombre + \"'\")\n}\n\nexport const CLAVE_API = 'sk-live-1234567890abcdef'\n",
  'src/pool.js': 'export const pool = { query: async (q) => q }\n'
}

interface Caso {
  id: string
  prompt: string
  /** Lo que se espera: 'agente' = delega en el revisor; 'skill:<n>' = carga esa skill; 'nada' = ni agentes ni skills. */
  espera: 'agente' | 'skill:formato-de-commit' | 'skill:glosario-de-traduccion' | 'nada'
  /** Texto que debe aparecer en la respuesta (prueba de que la skill se aplicó de verdad). */
  contiene?: RegExp
}

const CASOS: Caso[] = [
  { id: 'implicito-agente', prompt: 'Audita la seguridad de src/db.js y dime qué hay que arreglar. No modifiques archivos.', espera: 'agente' },
  { id: 'implicito-skill', prompt: 'Propón el mensaje de commit para un cambio que añade validación de entradas en src/db.js. Solo el mensaje, no hagas commit.', espera: 'skill:formato-de-commit', contiene: /Ref: ODK-0/ },
  { id: 'explicito-agente', prompt: 'Usa el agente revisor-de-seguridad para revisar src/suma.js.', espera: 'agente' },
  { id: 'explicito-skill', prompt: 'Con la skill glosario-de-traduccion, traduce al inglés el botón «Guardar cambios».', espera: 'skill:glosario-de-traduccion', contiene: /Commit changes/i },
  { id: 'trivial', prompt: '¿Cuánto es 17 * 3? Responde solo el número.', espera: 'nada' },
  { id: 'simple', prompt: '¿Qué devuelve la función de src/suma.js? Una frase.', espera: 'nada' },
  { id: 'cerca-no', prompt: 'Añade un comentario JSDoc breve a la función de src/suma.js.', espera: 'nada' }
]

interface Medida {
  id: string
  agentes: string[]
  skills: string[]
  herramientas: string[]
  texto: string
  pasos: number
  contexto: number
  costo: number
  entrada: number
  salida: number
  cache: number
  ms: number
}

async function preparar(): Promise<{ proyecto: string; plugin: string }> {
  const base = await mkdtemp(join(tmpdir(), 'eval-agentes-'))
  const proyecto = join(base, 'tienda')
  const plugin = join(base, 'plugin')
  const escribir = async (raiz: string, archivos: Record<string, string>): Promise<void> => {
    for (const [ruta, texto] of Object.entries(archivos)) {
      await mkdir(dirname(join(raiz, ruta)), { recursive: true })
      await writeFile(join(raiz, ruta), texto)
    }
  }
  await escribir(proyecto, CODIGO)
  await escribir(plugin, archivosPlugin('tienda', RECURSOS))
  return { proyecto, plugin }
}

async function correr(caso: Caso, proyecto: string, extra: Partial<OpcionesEjecucion>): Promise<Medida> {
  const m: Medida = { id: caso.id, agentes: [], skills: [], herramientas: [], texto: '', pasos: 0, contexto: 0, costo: 0, entrada: 0, salida: 0, cache: 0, ms: 0 }
  const t0 = Date.now()
  const r = await ejecutarSuscripcion({
    prompt: caso.prompt,
    cwd: proyecto,
    modelo: MODELO,
    autonomia: 'autonomo',
    verificaciones: [],
    senal: AbortSignal.timeout(5 * 60_000),
    alPermiso: async () => ({ permitir: true }),
    alEvento: (e) => {
      if (e.tipo !== 'herramienta_inicio') return
      const { nombre, entrada } = e.llamada as LlamadaHerramienta
      m.herramientas.push(nombre)
      if (nombre === 'Agent' || nombre === 'Task') m.agentes.push(String(entrada.subagent_type ?? ''))
      if (nombre === 'Skill') m.skills.push(String(entrada.skill ?? entrada.command ?? ''))
    },
    alUso: (u) =>
      u.forEach((x) => {
        m.costo += x.costo
        m.entrada += x.uso.tokensEntrada
        m.salida += x.uso.tokensSalida
        m.cache += x.cache
      }),
    ...extra,
    sistemaExtra: [AVISO_SUBAGENTES, guiaRecursos(extra.recursos ?? { agentes: false, skills: false })].filter(Boolean).join('\n\n')
  })
  m.ms = Date.now() - t0
  m.texto = r.resultado.texto
  m.pasos = r.resultado.pasos
  m.contexto = r.contexto
  return m
}

const cumple = (c: Caso, m: Medida): boolean => {
  const usoAgente = m.agentes.some((a) => a.includes('revisor'))
  const skill = c.espera.startsWith('skill:') ? c.espera.slice(6) : undefined
  const usoSkill = (n: string): boolean => m.skills.some((s) => s.includes(n))
  if (c.contiene && !c.contiene.test(m.texto)) return false
  if (c.espera === 'agente') return usoAgente
  if (skill) return usoSkill(skill) && !usoAgente
  return m.agentes.length === 0 && m.skills.length === 0
}

describe.skipIf(process.env.ODESK_EVAL_CLI !== '1')('Asistente (CLI real): agentes y skills del proyecto', () => {
  it('los usa cuando aportan, obedece cuando se le piden y no los invoca en lo trivial', async () => {
    const { proyecto, plugin } = await preparar()
    const conAgentes = { pluginDirs: [plugin], recursos: { agentes: true, skills: true } }
    const medidas: Medida[] = []
    for (const c of CASOS) medidas.push(await correr(c, proyecto, conAgentes))
    // Lo que cuesta tenerlos cargados: el mismo caso trivial sin el plugin.
    const sin = await correr(CASOS.find((c) => c.espera === 'nada')!, proyecto, {})

    const filas = medidas.map((m) => {
      const c = CASOS.find((x) => x.id === m.id)!
      return {
        caso: m.id,
        ok: cumple(c, m) ? 'OK' : 'FALLA',
        agentes: m.agentes.join(',') || '-',
        skills: m.skills.join(',') || '-',
        herramientas: m.herramientas.join(','),
        pasos: m.pasos,
        contexto: m.contexto,
        usd: m.costo.toFixed(4),
        s: Math.round(m.ms / 1000)
      }
    })
    console.table(filas)
    console.log(`contexto del caso trivial: con agentes/skills ${medidas.find((m) => m.id === 'trivial')!.contexto} tokens, sin ellos ${sin.contexto} tokens`)
    console.log(JSON.stringify({ medidas, sin }, null, 2))
    for (const m of medidas) expect.soft(cumple(CASOS.find((c) => c.id === m.id)!, m), `${m.id}: ${m.texto.slice(0, 200)}`).toBe(true)
  })
})
