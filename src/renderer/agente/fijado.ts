/**
 * Contexto fijado de una conversación: archivos/carpetas clave y una nota que el modelo debe tener presentes en todos los mensajes.
 * No va en el prompt de sistema (cambiarlo relanzaría el proceso del CLI e invalidaría la caché): viaja delante del mensaje SOLO cuando
 * cambia o después de una compactación (el resumen pudo perderlo). Se guarda por conversación en este equipo.
 */

export interface ContextoFijado {
  archivos: string[]
  nota: string
}

export const FIJADO_VACIO: ContextoFijado = { archivos: [], nota: '' }
export const MAX_ARCHIVOS_FIJADOS = 20
export const MAX_NOTA_FIJADA = 2_000

export const fijadoVacio = (f: ContextoFijado | undefined): boolean => !f || (f.archivos.length === 0 && !f.nota.trim())

/** Limpia lo que escribió la persona: una ruta por línea (sin `@` ni comillas), sin repetidas, con tope. */
export function normalizarFijado(archivosTexto: string, nota: string): ContextoFijado {
  const archivos = [
    ...new Set(
      archivosTexto
        .split(/\r?\n|,/)
        .map((l) => l.trim().replace(/^@/, '').replace(/^["'`]|["'`]$/g, '').trim())
        .filter((l) => l && l.length <= 300)
    )
  ].slice(0, MAX_ARCHIVOS_FIJADOS)
  return { archivos, nota: nota.trim().slice(0, MAX_NOTA_FIJADA) }
}

export const huellaFijado = (f: ContextoFijado | undefined): string => (fijadoVacio(f) ? '' : JSON.stringify({ a: f!.archivos, n: f!.nota.trim() }))

/**
 * Bloque que va delante del mensaje, o `undefined` si no hace falta enviar nada: lo mismo que ya se envió y sin compactación de por medio.
 * Si se quitó todo lo fijado, se avisa una vez para que el modelo deje de tenerlo en cuenta.
 */
export function bloqueFijado(f: ContextoFijado | undefined, huellaEnviada: string, compactado: boolean): string | undefined {
  const huella = huellaFijado(f)
  if (huella === huellaEnviada && !(compactado && huella)) return undefined
  if (!huella) return huellaEnviada ? '<contexto_fijado>El usuario quitó el contexto fijado de esta conversación: ya no hace falta tenerlo en cuenta.</contexto_fijado>' : undefined
  const partes = ['<contexto_fijado>', 'El usuario fijó este contexto para toda la conversación: tenlo presente en cada respuesta, aunque no lo repita.']
  if (f!.archivos.length) partes.push(`Archivos y carpetas clave (léelos cuando los necesites; las rutas son relativas al proyecto):\n${f!.archivos.map((a) => `- ${a}`).join('\n')}`)
  if (f!.nota.trim()) partes.push(`Nota del usuario:\n${f!.nota.trim()}`)
  partes.push('</contexto_fijado>')
  return partes.join('\n')
}

const leer = (clave: string): string | null => {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}
const escribir = (clave: string, valor: string | null): void => {
  try {
    if (valor === null) localStorage.removeItem(clave)
    else localStorage.setItem(clave, valor)
  } catch {
    /* sin almacenamiento: solo dura esta sesión */
  }
}

export function leerFijado(sesionId: string): ContextoFijado | undefined {
  try {
    const v = JSON.parse(leer(`asistente:fijado:${sesionId}`) ?? 'null') as ContextoFijado | null
    return v && Array.isArray(v.archivos) && typeof v.nota === 'string' ? { archivos: v.archivos.filter((a) => typeof a === 'string'), nota: v.nota } : undefined
  } catch {
    return undefined
  }
}
export const guardarFijado = (sesionId: string, f: ContextoFijado | undefined): void => escribir(`asistente:fijado:${sesionId}`, fijadoVacio(f) ? null : JSON.stringify(f))
export const leerHuellaEnviada = (sesionId: string): string => leer(`asistente:fijado-enviado:${sesionId}`) ?? ''
export const guardarHuellaEnviada = (sesionId: string, huella: string): void => escribir(`asistente:fijado-enviado:${sesionId}`, huella || null)
