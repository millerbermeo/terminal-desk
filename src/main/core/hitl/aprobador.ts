import type { EventoAgente } from '@shared/core/agente'
import type { LlamadaHerramienta } from '@shared/core/herramientas'
import type { Aprobador } from '../agents/harness'
import { esDestructiva } from '../guardrails/destructivo'
import type { ModoAutonomia, NuevaRegla, ReglaPermiso } from '@shared/core/permisos'
import { decidir, reglaDe } from '../permisos/reglas'
import type { PuertaHumana } from '../orchestrator/puerta'

export interface DepsAprobador {
  puerta: PuertaHumana
  ejecucionId: string
  alEvento: (e: EventoAgente) => void
  senal?: AbortSignal
  /** Reglas persistentes vigentes (se consultan en cada llamada, así una regla nueva se aplica de inmediato). */
  reglas?: () => Promise<readonly ReglaPermiso[]>
  /** Guarda una regla nueva cuando el usuario elige «Permitir siempre». */
  guardarRegla?: (r: NuevaRegla) => Promise<void>
  /** Cuánto pregunta (por defecto, todo). */
  autonomia?: ModoAutonomia
  /** Comandos de verificación del proyecto (argv): en modo autónomo se ejecutan sin preguntar. */
  verificaciones?: readonly (readonly string[])[]
}

const MAX_DETALLE = 1500
const recortar = (t: string): string => (t.length > MAX_DETALLE ? t.slice(0, MAX_DETALLE) + '\n[… recortado]' : t)

/** Lo que verá el usuario: qué se va a hacer exactamente. */
export function describirLlamada(l: LlamadaHerramienta): string {
  const e = l.entrada
  switch (l.nombre) {
    case 'ejecutar_comando':
      return `$ ${[String(e.comando), ...(Array.isArray(e.args) ? e.args.map(String) : [])].join(' ')}`
    case 'escribir_archivo':
      return `Escribir ${String(e.ruta)}\n\n${recortar(String(e.contenido ?? ''))}`
    default:
      return `${l.nombre}\n${recortar(JSON.stringify(e, null, 2))}`
  }
}

/** ¿El comando es exactamente una de las verificaciones del proyecto? */
function esVerificacion(l: LlamadaHerramienta, verificaciones: readonly (readonly string[])[] = []): boolean {
  const argv = [String(l.entrada.comando), ...(Array.isArray(l.entrada.args) ? l.entrada.args.map(String) : [])]
  return verificaciones.some((v) => v.length === argv.length && v.every((t, i) => t === argv[i]))
}

/**
 * Human-in-the-loop: cada escritura o ejecución espera la confirmación del usuario.
 * Las acciones destructivas (rm, git push/reset --hard…) se marcan como tales y nunca se «recuerdan».
 * Si la ejecución se cancela mientras se espera, la acción se deniega.
 */
export function crearAprobadorHumano(d: DepsAprobador): Aprobador {
  const recordadas = new Set<string>()
  return async (llamada, riesgo, agente) => {
    const razon = esDestructiva(llamada.nombre, llamada.entrada)
    // Reglas persistentes: lo destructivo nunca se autoriza por regla (decidir() ya lo excluye).
    const regla = d.reglas ? decidir(await d.reglas(), llamada) : null
    if (regla === 'permitir') return true
    if (regla === 'denegar') return false
    // Modos de autonomía: nunca aplican a lo destructivo.
    if (!razon) {
      const modo = d.autonomia ?? 'preguntar'
      if (modo !== 'preguntar' && llamada.nombre === 'escribir_archivo') return true // los guardrails ya revisaron la ruta y el contenido
      if (modo === 'autonomo' && llamada.nombre === 'ejecutar_comando' && esVerificacion(llamada, d.verificaciones)) return true
    }
    if (!razon && recordadas.has(llamada.nombre)) return true
    try {
      const decision = await d.puerta.solicitar(
        {
          clase: 'accion',
          contenido: describirLlamada(llamada),
          detalle: `${agente} quiere usar «${llamada.nombre}» (${riesgo})${razon ? ` — ACCIÓN DESTRUCTIVA: ${razon}` : ''}`,
          herramienta: llamada.nombre,
          ...(razon ? { destructivo: true } : {}),
          ...(!razon && d.guardarRegla && reglaDe(llamada) ? { puedeSiempre: true } : {})
        },
        (solicitudId, s) => d.alEvento({ ejecucionId: d.ejecucionId, agente, profundidad: 0, tipo: 'solicitud_humana', solicitudId, ...s }),
        d.senal
      )
      if (decision.aprobado && decision.recordar && !razon) recordadas.add(llamada.nombre)
      if (decision.aprobado && decision.siempre && !razon && d.guardarRegla) {
        const nueva = reglaDe(llamada)
        if (nueva) await d.guardarRegla(nueva).catch(() => undefined) // si no se puede guardar, la acción de ahora sigue aprobada
      }
      return decision.aprobado
    } catch {
      return false
    }
  }
}
