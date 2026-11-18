import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EstadoChrome, NombreOperacionChrome, OperacionesChrome } from '@shared/chrome'
import type { PuenteChrome } from './puente'

/** Carpeta de la extensión: junto a la app empaquetada (`extraResources`) o en el repositorio en desarrollo. */
export function carpetaExtension(o: { empaquetada: boolean; recursos: string; rutaApp: string }): string {
  const empaquetada = join(o.recursos, 'extension-chrome')
  return o.empaquetada && existsSync(empaquetada) ? empaquetada : join(o.rutaApp, 'extension')
}

export async function estadoChrome(p: PuenteChrome, carpeta: string): Promise<EstadoChrome> {
  const d = await p.leerDatos()
  const nav = p.navegador
  const codigo = p.codigoVigente
  return {
    activo: d.activo,
    puerto: p.puerto,
    conectado: p.conectado,
    ...(nav ? { navegador: nav.nombre, version: nav.version } : {}),
    pausado: p.conectado && p.pausado,
    emparejadas: p.emparejadas(),
    ...(codigo ? { codigo } : {}),
    pestanas: p.conectado ? p.pestanas : [],
    sitios: [...d.sitios].sort(),
    carpetaExtension: carpeta,
    ...(p.error ? { error: p.error } : {})
  }
}

/** Operaciones del panel «Chrome» (canal `chrome:operar`). Todo se valida aquí: el renderer no es de fiar. */
export async function ejecutarOperacionChrome(
  p: PuenteChrome,
  d: { carpeta: string; abrirCarpeta: (ruta: string) => Promise<unknown> },
  op: NombreOperacionChrome,
  entrada: unknown
): Promise<OperacionesChrome[NombreOperacionChrome]['salida']> {
  const e = (entrada ?? {}) as Record<string, unknown>
  switch (op) {
    case 'estado':
      break
    case 'activar':
      await p.cambiarDatos((x) => void (x.activo = e.activo === true))
      break
    case 'emparejar':
      p.nuevoCodigo()
      break
    case 'cancelarEmparejar':
      p.cancelarCodigo()
      break
    case 'olvidar':
      await p.olvidar(typeof e.id === 'string' ? e.id : undefined)
      break
    case 'quitarSitio':
      if (typeof e.origen === 'string') await p.cambiarDatos((x) => void (x.sitios = x.sitios.filter((s) => s !== e.origen)))
      break
    case 'abrirCarpeta':
      await d.abrirCarpeta(d.carpeta)
      break
    default:
      throw new Error(`Operación de Chrome desconocida: ${String(op)}`)
  }
  return estadoChrome(p, d.carpeta)
}
