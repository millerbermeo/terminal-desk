/** Preferencias de GitHub de este equipo (se guardan en el navegador de la app: cada PC puede tener las suyas). */
const CLAVES = { protocolo: 'odesk.github.protocolo', carpeta: 'odesk.clonar.padre', grupo: 'odesk.github.grupo' } as const

function leer(clave: string): string {
  try {
    return localStorage.getItem(clave) ?? ''
  } catch {
    return ''
  }
}
function guardar(clave: string, valor: string): void {
  try {
    if (valor) localStorage.setItem(clave, valor)
    else localStorage.removeItem(clave)
  } catch {
    // sin almacenamiento: dura solo esta sesión
  }
}

export interface PreferenciasGitHub {
  protocolo: 'https' | 'ssh'
  /** Carpeta donde se clonan los repositorios (ruta completa); vacío = preguntar. */
  carpeta: string
  /** Grupo en el que se agregan los proyectos clonados; vacío = sin grupo. */
  grupo: string
}

export const leerPreferencias = (): PreferenciasGitHub => ({ protocolo: leer(CLAVES.protocolo) === 'ssh' ? 'ssh' : 'https', carpeta: leer(CLAVES.carpeta), grupo: leer(CLAVES.grupo) })

export function guardarPreferencias(p: Partial<PreferenciasGitHub>): void {
  if (p.protocolo !== undefined) guardar(CLAVES.protocolo, p.protocolo === 'ssh' ? 'ssh' : '')
  if (p.carpeta !== undefined) guardar(CLAVES.carpeta, p.carpeta.trim())
  if (p.grupo !== undefined) guardar(CLAVES.grupo, p.grupo)
}
