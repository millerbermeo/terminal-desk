import { cpSync, existsSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Carpeta de datos del usuario (en su carpeta personal). */
export const CARPETA_DATOS = '.odesk-agent'
/** Nombre anterior de la aplicación («Centro de Proyectos»): sus datos se mueven solos a `CARPETA_DATOS`. */
export const CARPETA_DATOS_ANTIGUA = '.centro-proyectos'

export type EstadoMigracion = 'migrado' | 'nada' | 'conflicto' | 'error'

/**
 * Mueve una carpeta a su nuevo nombre sin perder nada: renombra (atómico) y, si no se puede, copia y borra el origen solo cuando la
 * copia terminó. Nunca pisa un destino que ya existe.
 */
export function migrarCarpeta(origen: string, destino: string): { estado: EstadoMigracion; error?: string } {
  if (!existsSync(origen)) return { estado: 'nada' }
  if (existsSync(destino)) return { estado: 'conflicto' }
  try {
    renameSync(origen, destino)
    return { estado: 'migrado' }
  } catch (e1) {
    try {
      cpSync(origen, destino, { recursive: true, preserveTimestamps: true })
      rmSync(origen, { recursive: true, force: true })
      return { estado: 'migrado' }
    } catch (e2) {
      rmSync(destino, { recursive: true, force: true }) // copia a medias: el origen sigue intacto
      return { estado: 'error', error: `${(e1 as Error).message}; ${(e2 as Error).message}` }
    }
  }
}

export interface ResolucionDatos {
  /** Carpeta que se usa de verdad. */
  dir: string
  /** Se acaba de mover desde el nombre anterior en este arranque. */
  migrado: boolean
  /** Algo que merece quedar en el registro (no se pudo migrar, etc.). */
  aviso?: string
}

/**
 * Decide qué carpeta de datos usar y migra la antigua si hace falta. Si la migración falla (permisos, archivos abiertos…) se sigue
 * usando la carpeta antigua: es mejor conservar el nombre viejo que arrancar «vacío» y parecer que se perdieron los datos.
 */
export function resolverDirDatos(casa: string = homedir()): ResolucionDatos {
  const nuevo = join(casa, CARPETA_DATOS)
  const viejo = join(casa, CARPETA_DATOS_ANTIGUA)
  const r = migrarCarpeta(viejo, nuevo)
  if (r.estado === 'migrado') return { dir: nuevo, migrado: true }
  if (r.estado === 'error') return { dir: viejo, migrado: false, aviso: `No se pudieron mover los datos a ${nuevo} (${r.error}). Se siguen usando en ${viejo}.` }
  if (r.estado === 'conflicto') {
    // Existen las dos: manda la nueva, salvo que sea una carpeta vacía y la antigua tenga los proyectos.
    const soloLaAntiguaTieneDatos = !existsSync(join(nuevo, 'proyectos.json')) && existsSync(join(viejo, 'proyectos.json'))
    if (soloLaAntiguaTieneDatos) return { dir: viejo, migrado: false, aviso: `Existen ${nuevo} y ${viejo}; los datos están en la antigua, que se sigue usando. Mueve su contenido a la nueva y bórrala.` }
  }
  return { dir: nuevo, migrado: false }
}

/** Carpetas que ha usado Electron para el perfil de la aplicación con sus nombres anteriores (por orden de preferencia). */
export const PERFILES_ANTIGUOS = ['ODESK AI', 'Centro de Proyectos', 'centro-proyectos'] as const

/** Perfil de Electron (localStorage…): se mueve al nombre actual si solo existe uno con un nombre anterior. */
export function resolverPerfil(appData: string, nombre: string): string {
  const nuevo = join(appData, nombre)
  if (existsSync(nuevo)) return nuevo
  for (const antiguo of PERFILES_ANTIGUOS) {
    const origen = join(appData, antiguo)
    const r = migrarCarpeta(origen, nuevo)
    if (r.estado === 'migrado') return nuevo
    if (r.estado === 'error') return origen
  }
  return nuevo
}
