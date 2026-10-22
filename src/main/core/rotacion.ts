import type { Sesion } from './memory/sesion'
import { bloqueContextoPrevio, digestDeConversacion, PROMPT_RESUMEN, resumenDeRespaldo, type MotivoRotacion } from './consumo'
import { consultarCli, type UsoPorModelo } from './suscripcion'

export interface ResultadoRotacion {
  /** Bloque listo para anteponer al primer mensaje de la sesión nueva. */
  bloque: string
  /** El resumen en sí (se guarda como pendiente hasta que la sesión nueva exista). */
  resumen: string
  /** `false` si el modelo no respondió y se usó el digest recortado. */
  conModelo: boolean
}

/**
 * Prepara el paso a una sesión nueva: resume la conversación con un modelo barato a partir de lo que la app guardó (peticiones,
 * herramientas y respuestas), no del historial del CLI. Si no hay nada que resumir devuelve `undefined` (no se rota: se perdería todo).
 * Un fallo del resumen no bloquea: se usa la cola del digest.
 */
export async function prepararRotacion(o: {
  sesion: Sesion | undefined
  motivo: MotivoRotacion
  carpeta?: string
  cwd?: string
  senal?: AbortSignal
  alUso?: (u: UsoPorModelo[]) => void
}): Promise<ResultadoRotacion | undefined> {
  const turnos = o.sesion?.transcripcion ?? []
  const digest = digestDeConversacion(turnos)
  if (!digest.trim()) return undefined
  try {
    const r = await consultarCli(PROMPT_RESUMEN, `<conversacion>\n${digest}\n</conversacion>`, {
      ...(o.carpeta ? { carpeta: o.carpeta } : {}),
      ...(o.cwd ? { cwd: o.cwd } : {}),
      ...(o.senal ? { senal: o.senal } : {})
    })
    if (r.uso.length) o.alUso?.(r.uso)
    return { bloque: bloqueContextoPrevio(r.texto, o.motivo), resumen: r.texto, conModelo: true }
  } catch {
    const resumen = resumenDeRespaldo(digest)
    return { bloque: bloqueContextoPrevio(resumen, o.motivo), resumen, conModelo: false }
  }
}
