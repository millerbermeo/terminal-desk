import type { SecretoDetectado } from '@shared/versiones'
import { confirmar } from '../confirmar'
import { git } from './useGit'

const MAX_MOSTRADOS = 6

const ubicacion = (s: SecretoDetectado): string => `${s.archivo}${s.linea ? `:${s.linea}` : ''}`

/** Texto del aviso: dónde está cada posible credencial (con el valor redactado) y qué conviene hacer. */
export function textoAvisoSecretos(secretos: readonly SecretoDetectado[]): string {
  const lista = secretos.slice(0, MAX_MOSTRADOS).map((s) => `${ubicacion(s)} — ${s.mensaje}`)
  if (secretos.length > MAX_MOSTRADOS) lista.push(`… y ${secretos.length - MAX_MOSTRADOS} más`)
  return [
    `Los cambios preparados parecen contener ${secretos.length === 1 ? 'una credencial' : `${secretos.length} credenciales`}:`,
    ...lista,
    'Una vez en el historial de git (y más aún si lo envías), la credencial queda expuesta aunque la borres después: habría que revocarla.',
    'Lo recomendable es cancelar, moverla a una variable de entorno o a un archivo ignorado por git, y volver a preparar. Confirma solo si sabes que no es un secreto real.'
  ].join('\n\n')
}

/**
 * Antes de un commit hecho por la persona: si lo preparado parece contener credenciales, avisa y deja decidir.
 * Devuelve `null` si hay que cancelar, o la entrada extra para `commit` (`permitirSecretos` solo si se aceptó el aviso).
 * Si la revisión misma falla, no se bloquea aquí: el propio `commit` vuelve a revisar y frena con su error.
 */
export async function revisarSecretosAntesDeCommit(proyectoId: string): Promise<{ permitirSecretos?: true } | null> {
  let secretos: SecretoDetectado[]
  try {
    secretos = await git('secretosPreparados', { proyectoId })
  } catch {
    return {}
  }
  if (secretos.length === 0) return {}
  const seguir = await confirmar({
    titulo: 'Posibles credenciales en el commit',
    texto: textoAvisoSecretos(secretos),
    etiqueta: 'Confirmar igual',
    cancelar: 'Cancelar y revisar',
    tono: 'peligro'
  })
  return seguir ? { permitirSecretos: true } : null
}
