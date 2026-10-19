import type { NombreOperacionGit, OperacionesGit } from '@shared/versiones'
import { Repositorio, type ProveedorCredenciales } from './repositorio'

type Entrada<K extends NombreOperacionGit> = OperacionesGit[K]['entrada']
type Implementaciones = { [K in NombreOperacionGit]: (r: Repositorio, e: Entrada<K>) => Promise<OperacionesGit[K]['salida']> }

const OPERACIONES: Implementaciones = {
  estado: (r) => r.estado(),
  iniciar: (r, e) => r.iniciar(e.rama),
  diff: (r, e) => r.diff(e.ruta, e.preparado === true, e.hash),
  preparar: (r, e) => r.preparar(e.rutas),
  despreparar: (r, e) => r.despreparar(e.rutas),
  descartar: (r, e) => r.descartar(e.rutas),
  commit: (r, e) => r.commit(e.mensaje, e.enmendar === true),
  historial: (r, e) => r.historial(e),
  detalleCommit: (r, e) => r.detalleCommit(e.hash),
  ramas: (r) => r.ramas(),
  crearRama: (r, e) => r.crearRama(e.nombre, e.desde, e.cambiar === true),
  cambiarRama: (r, e) => r.cambiarRama(e.nombre, e.remota === true),
  eliminarRama: (r, e) => r.eliminarRama(e.nombre, e.forzar === true),
  fusionar: (r, e) => r.fusionar(e.rama),
  fusionPrevia: (r, e) => r.fusionPrevia(e.origen),
  fusionArchivo: (r, e) => r.fusionArchivo(e.origen, e.ruta),
  fusionAplicar: (r, e) => r.fusionAplicar(e.origen, e.resoluciones, e.mensaje, e.confirmar !== false),
  revertir: (r, e) => r.revertir(e.hash),
  abortar: (r) => r.abortar(),
  continuar: (r) => r.continuar(),
  remotos: (r) => r.remotos(),
  agregarRemoto: (r, e) => r.agregarRemoto(e.nombre, e.url),
  obtener: (r, e) => r.obtener(e.remoto),
  traer: (r, e) => r.traer(e.rebase === true),
  enviar: (r, e) => r.enviar(e.remoto),
  etiquetas: (r) => r.etiquetas(),
  crearEtiqueta: (r, e) => r.crearEtiqueta(e.nombre, e.mensaje, e.commit),
  eliminarEtiqueta: (r, e) => r.eliminarEtiqueta(e.nombre),
  enviarEtiqueta: (r, e) => r.enviarEtiqueta(e.nombre, e.remoto),
  stashes: (r) => r.stashes(),
  guardarStash: (r, e) => r.guardarStash(e.mensaje, e.incluirNoSeguidos === true),
  aplicarStash: (r, e) => r.aplicarStash(e.indice, e.quitar === true),
  eliminarStash: (r, e) => r.eliminarStash(e.indice),
  identidad: (r) => r.identidad(),
  fijarIdentidad: (r, e) => r.fijarIdentidad(e.nombre, e.correo, e.global === true)
}

/**
 * Operaciones de git de la interfaz. El renderer solo manda el id del proyecto; la carpeta la resuelve `carpetaDe`
 * (que falla si el proyecto no existe), así que nunca se opera fuera de los proyectos registrados.
 */
export async function ejecutarOperacionGit(carpetaDe: (proyectoId: string) => Promise<string>, op: unknown, entrada: unknown, credenciales?: ProveedorCredenciales): Promise<unknown> {
  if (typeof op !== 'string' || !Object.hasOwn(OPERACIONES, op)) throw new Error(`Operación de git desconocida: ${String(op)}`)
  const e = entrada !== null && typeof entrada === 'object' ? (entrada as { proyectoId?: unknown }) : {}
  if (typeof e.proyectoId !== 'string' || !e.proyectoId) throw new Error('Falta el proyecto.')
  const repo = new Repositorio(await carpetaDe(e.proyectoId), credenciales)
  return (OPERACIONES[op as NombreOperacionGit] as (r: Repositorio, e: unknown) => Promise<unknown>)(repo, e)
}
