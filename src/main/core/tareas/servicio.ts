import { randomUUID } from 'node:crypto'
import type { DatosProyectos } from '@shared/modelos'
import {
  MAX_TAREAS,
  PRIORIDADES,
  ESTADOS_POR_DEFECTO,
  categoriaDe,
  dependenciasAbiertas,
  estaAbierta,
  evaluarTransicion,
  fechaCorta,
  filtrarTareas,
  haceCiclo,
  resumirTareas,
  siguienteTarea,
  validarEstados,
  type Actividad,
  type Autor,
  type DatosNuevaTarea,
  type DetalleTarea,
  type EstadoTarea,
  type FiltroTareas,
  type ItemLista,
  type OperacionesTareas,
  type ParcheTarea,
  type Prioridad,
  type Referencia,
  type ResumenTareas,
  type Tarea,
  type TipoActividad,
  type TipoReferencia
} from '@shared/tareas'
import type { AlmacenJson } from '../memory/almacen'

const ID = 'tareas'
const MAX_ACTIVIDAD = 5000
const MAX_ITEMS = 50
const MAX_ETIQUETAS = 20

export interface Documento {
  version: 1
  siguiente: number
  estados: EstadoTarea[]
  tareas: Tarea[]
  actividad: Actividad[]
}

export interface ContextoTareas {
  proyectos(): Promise<DatosProyectos>
  /** Se avisa tras cada cambio (la interfaz se refresca aunque lo haya hecho la IA). */
  alCambiar?(): void
}

type Registrar = (tipo: TipoActividad, detalle: string, t?: Tarea, motivo?: string) => void

const vacio = (): Documento => ({ version: 1, siguiente: 1, estados: ESTADOS_POR_DEFECTO.map((e) => ({ ...e })), tareas: [], actividad: [] })

function normalizar(actual: Documento | undefined): Documento {
  if (!actual) return vacio()
  const d: Documento = {
    version: 1,
    siguiente: Number.isInteger(actual.siguiente) && actual.siguiente > 0 ? actual.siguiente : 1,
    estados: Array.isArray(actual.estados) && validarEstados(actual.estados) === null ? actual.estados : vacio().estados,
    tareas: Array.isArray(actual.tareas) ? actual.tareas : [],
    actividad: Array.isArray(actual.actividad) ? actual.actividad : []
  }
  d.siguiente = Math.max(d.siguiente, ...d.tareas.map((t) => t.numero + 1))
  return d
}

const texto = (valor: unknown, campo: string, max: number, obligatorio = false): string => {
  if (valor === undefined || valor === null) {
    if (obligatorio) throw new Error(`Falta «${campo}».`)
    return ''
  }
  if (typeof valor !== 'string') throw new Error(`«${campo}» debe ser texto.`)
  const t = valor.trim()
  if (obligatorio && !t) throw new Error(`«${campo}» no puede estar vacío.`)
  if (t.length > max) throw new Error(`«${campo}» es demasiado largo (máx. ${max} caracteres).`)
  return t
}

const fecha = (v: unknown, campo: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`«${campo}» debe ser una fecha válida (milisegundos).`)
  return v
}

const prioridad = (v: unknown): Prioridad => {
  if (!PRIORIDADES.includes(v as Prioridad)) throw new Error(`La prioridad debe ser: ${PRIORIDADES.join(', ')}.`)
  return v as Prioridad
}

const etiquetas = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw new Error('«etiquetas» debe ser una lista.')
  const limpias = [...new Set(v.map((e) => texto(e, 'etiqueta', 30, true)))]
  if (limpias.length > MAX_ETIQUETAS) throw new Error(`Máximo ${MAX_ETIQUETAS} etiquetas.`)
  return limpias
}

const item = (t: unknown): ItemLista => ({ id: randomUUID().slice(0, 8), texto: texto(t, 'texto', 300, true), hecho: false })

const referencia = (r: { tipo?: TipoReferencia | undefined; titulo?: string | undefined; destino?: string | undefined }): Referencia => {
  const destino = texto(r.destino, 'destino', 2000, true)
  const tipo: TipoReferencia = r.tipo ?? (/^https?:\/\//i.test(destino) ? 'enlace' : 'archivo')
  if (!['enlace', 'archivo', 'nota'].includes(tipo)) throw new Error('Tipo de referencia inválido.')
  if (tipo === 'enlace' && !/^https?:\/\/\S+$/i.test(destino)) throw new Error('Un enlace debe empezar por http:// o https://.')
  return { id: randomUUID().slice(0, 8), tipo, titulo: texto(r.titulo, 'titulo', 120) || destino.slice(0, 120), destino }
}

const corto = (t: Pick<Tarea, 'numero' | 'titulo'>): string => `#${t.numero} «${t.titulo}»`

/** Servicio de tareas: único punto por el que pasan la interfaz, la IA (herramientas y MCP) y los tests. */
export class ServicioTareas {
  constructor(
    private readonly almacen: AlmacenJson<Documento>,
    private readonly ctx: ContextoTareas
  ) {}

  async leer(): Promise<Documento> {
    return normalizar(await this.almacen.leer(ID))
  }

  /** Lee, aplica el cambio y guarda de forma atómica; `f` es síncrona: si lanza, no se escribe nada. */
  private async mutar<R>(autor: Autor, f: (d: Documento, registrar: Registrar) => R): Promise<R> {
    let resultado!: R
    await this.almacen.actualizar(ID, (actual) => {
      const d = normalizar(actual)
      const registrar: Registrar = (tipo, detalle, t, motivo) => {
        const m = motivo?.trim()
        d.actividad.push({
          id: randomUUID().slice(0, 12),
          fecha: Date.now(),
          autor,
          tipo,
          detalle,
          ...(t ? { tareaId: t.id, numero: t.numero, titulo: t.titulo, ...(t.proyectoId ? { proyectoId: t.proyectoId } : {}) } : {}),
          ...(m ? { motivo: m.slice(0, 500) } : {})
        })
      }
      resultado = f(d, registrar)
      if (d.actividad.length > MAX_ACTIVIDAD) d.actividad = d.actividad.slice(-MAX_ACTIVIDAD)
      return d
    })
    this.ctx.alCambiar?.()
    return resultado
  }

  private buscar(d: Documento, ref: string): Tarea {
    const r = String(ref ?? '').trim().replace(/^#/, '')
    const t = /^\d+$/.test(r) ? d.tareas.find((x) => x.numero === Number(r)) : d.tareas.find((x) => x.id === r)
    if (!t) throw new Error(`No existe la tarea «${ref}».`)
    return t
  }

  private estadoDe(d: Documento, id: string): EstadoTarea {
    const e = d.estados.find((x) => x.id === id)
    if (!e) throw new Error(`Estado desconocido «${id}». Estados: ${d.estados.map((x) => x.id).join(', ')}.`)
    return e
  }

  /** Valida y completa el vínculo con proyecto y grupo (el grupo del proyecto se hereda si no se indica otro). */
  private vinculo(datos: DatosProyectos, proyectoId?: string | null, grupoId?: string | null): { proyectoId?: string; grupoId?: string } {
    const salida: { proyectoId?: string; grupoId?: string } = {}
    if (proyectoId) {
      const p = datos.proyectos.find((x) => x.id === proyectoId)
      if (!p) throw new Error(`No existe el proyecto «${proyectoId}».`)
      salida.proyectoId = p.id
      if (!grupoId && p.grupo && datos.grupos.some((g) => g.id === p.grupo)) salida.grupoId = p.grupo
    }
    if (grupoId) {
      if (!datos.grupos.some((g) => g.id === grupoId)) throw new Error(`No existe el grupo «${grupoId}».`)
      salida.grupoId = grupoId
    }
    return salida
  }

  private ordenFinal(d: Documento, estado: string): number {
    return d.tareas.filter((t) => t.estado === estado).reduce((m, t) => Math.max(m, t.orden), 0) + 10
  }

  private construir(d: Documento, datos: DatosProyectos, n: DatosNuevaTarea, previas: Tarea[], indices: number[] | undefined, registrar: Registrar): Tarea {
    if (d.tareas.length >= MAX_TAREAS) throw new Error(`Hay demasiadas tareas (máx. ${MAX_TAREAS}).`)
    const estado = n.estado ? this.estadoDe(d, n.estado) : (d.estados.find((e) => e.categoria === 'pendiente') ?? d.estados[0]!)
    if (['hecha', 'cancelada', 'bloqueada'].includes(estado.categoria)) throw new Error(`Una tarea nueva no puede nacer en «${estado.nombre}».`)
    const dependeDe = [...(n.dependeDe ?? []).map((r) => this.buscar(d, r).id), ...(indices ?? []).map((i) => {
      const previa = previas[i]
      if (!previa) throw new Error(`«dependeDeIndices» debe apuntar a una tarea anterior del mismo lote (índice ${i}).`)
      return previa.id
    })]
    const ahora = Date.now()
    const t: Tarea = {
      id: randomUUID(),
      numero: d.siguiente++,
      titulo: texto(n.titulo, 'titulo', 200, true),
      descripcion: texto(n.descripcion, 'descripcion', 20_000),
      estado: estado.id,
      prioridad: n.prioridad ? prioridad(n.prioridad) : 'media',
      ...this.vinculo(datos, n.proyectoId, n.grupoId),
      etiquetas: n.etiquetas ? etiquetas(n.etiquetas) : [],
      creada: ahora,
      actualizada: ahora,
      criterios: (n.criterios ?? []).map(item),
      checklist: (n.checklist ?? []).map(item),
      dependeDe: [...new Set(dependeDe)],
      referencias: (n.referencias ?? []).map(referencia),
      comentarios: [],
      notasTecnicas: texto(n.notasTecnicas, 'notasTecnicas', 20_000),
      orden: this.ordenFinal(d, estado.id)
    }
    if (n.inicio !== undefined) t.inicio = fecha(n.inicio, 'inicio')
    if (n.vence !== undefined) t.vence = fecha(n.vence, 'vence')
    if (t.criterios.length > MAX_ITEMS || t.checklist.length > MAX_ITEMS) throw new Error(`Máximo ${MAX_ITEMS} elementos por lista.`)
    if (estado.categoria === 'en_curso') t.inicio ??= ahora
    d.tareas.push(t)
    registrar('creada', `Creó ${corto(t)}${t.proyectoId ? '' : ' (sin proyecto)'}`, t)
    return t
  }

  // ---------------------------------------------------------------- lectura

  async listar(f: FiltroTareas = {}): Promise<Tarea[]> {
    const d = await this.leer()
    return filtrarTareas(d.tareas, d.estados, f)
  }

  async obtener(ref: string): Promise<DetalleTarea> {
    const d = await this.leer()
    const t = this.buscar(d, ref)
    const resumen = (x: Tarea): { id: string; numero: number; titulo: string } => ({ id: x.id, numero: x.numero, titulo: x.titulo })
    return {
      tarea: t,
      bloqueadaPor: dependenciasAbiertas(t, d.tareas, d.estados).map(resumen),
      bloquea: d.tareas.filter((x) => x.dependeDe.includes(t.id) && estaAbierta(x, d.estados)).map(resumen),
      actividad: d.actividad.filter((a) => a.tareaId === t.id).slice(-50).reverse()
    }
  }

  async actividad(f: { tarea?: string; proyectoId?: string; limite?: number } = {}): Promise<Actividad[]> {
    const d = await this.leer()
    const id = f.tarea ? this.buscar(d, f.tarea).id : undefined
    const limite = Math.min(Math.max(Math.trunc(f.limite ?? 100), 1), 500)
    return d.actividad
      .filter((a) => (!id || a.tareaId === id) && (!f.proyectoId || a.proyectoId === f.proyectoId))
      .slice(-limite)
      .reverse()
  }

  async resumen(f: { proyectoId?: string; grupoId?: string } = {}): Promise<ResumenTareas> {
    const d = await this.leer()
    return resumirTareas(filtrarTareas(d.tareas, d.estados, { ...(f.proyectoId ? { proyectoId: f.proyectoId } : {}), ...(f.grupoId ? { grupoId: f.grupoId } : {}) }), d.tareas, d.estados)
  }

  async siguiente(f: { proyectoId?: string; grupoId?: string } = {}): Promise<Tarea | null> {
    const d = await this.leer()
    return siguienteTarea(filtrarTareas(d.tareas, d.estados, { ...(f.proyectoId ? { proyectoId: f.proyectoId } : {}), ...(f.grupoId ? { grupoId: f.grupoId } : {}) }), d.tareas, d.estados) ?? null
  }

  /** Proyectos y grupos tal como están ahora (para que la IA sepa a qué vincular). */
  proyectosYGrupos(): Promise<DatosProyectos> {
    return this.ctx.proyectos()
  }

  async estados(): Promise<EstadoTarea[]> {
    return (await this.leer()).estados
  }

  // ---------------------------------------------------------------- escritura

  async crear(n: DatosNuevaTarea, autor: Autor): Promise<Tarea> {
    const datos = await this.ctx.proyectos()
    return this.mutar(autor, (d, reg) => this.construir(d, datos, n, [], undefined, reg))
  }

  async crearVarias(lote: OperacionesTareas['crearVarias']['entrada'], autor: Autor): Promise<Tarea[]> {
    if (!Array.isArray(lote.tareas) || lote.tareas.length === 0) throw new Error('Indica al menos una tarea.')
    if (lote.tareas.length > 50) throw new Error('Máximo 50 tareas por lote.')
    const datos = await this.ctx.proyectos()
    return this.mutar(autor, (d, reg) => {
      const creadas: Tarea[] = []
      for (const n of lote.tareas) creadas.push(this.construir(d, datos, n, creadas, n.dependeDeIndices, reg))
      return creadas
    })
  }

  async editar(ref: string, parche: ParcheTarea, autor: Autor, motivo?: string): Promise<Tarea> {
    const datos = await this.ctx.proyectos()
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, ref)
      const cambios: string[] = []
      if (parche.titulo !== undefined) {
        const v = texto(parche.titulo, 'titulo', 200, true)
        if (v !== t.titulo) {
          cambios.push('título')
          t.titulo = v
        }
      }
      if (parche.descripcion !== undefined) {
        const v = texto(parche.descripcion, 'descripcion', 20_000)
        if (v !== t.descripcion) {
          cambios.push('descripción')
          t.descripcion = v
        }
      }
      if (parche.notasTecnicas !== undefined) {
        const v = texto(parche.notasTecnicas, 'notasTecnicas', 20_000)
        if (v !== t.notasTecnicas) {
          cambios.push('notas técnicas')
          t.notasTecnicas = v
        }
      }
      if (parche.prioridad !== undefined && parche.prioridad !== t.prioridad) {
        cambios.push(`prioridad (${t.prioridad} → ${prioridad(parche.prioridad)})`)
        t.prioridad = parche.prioridad
      }
      if (parche.etiquetas !== undefined) {
        const v = etiquetas(parche.etiquetas)
        if (v.join('\n') !== t.etiquetas.join('\n')) {
          cambios.push('etiquetas')
          t.etiquetas = v
        }
      }
      for (const campo of ['inicio', 'vence'] as const) {
        if (parche[campo] === undefined) continue
        if (parche[campo] === null) {
          if (t[campo] !== undefined) {
            cambios.push(`${campo} (quitada)`)
            delete t[campo]
          }
        } else if (fecha(parche[campo], campo) !== t[campo]) {
          t[campo] = parche[campo]
          cambios.push(`${campo} (${fechaCorta(parche[campo])})`)
        }
      }
      let vinculada = false
      if (parche.proyectoId !== undefined || parche.grupoId !== undefined) {
        const v = this.vinculo(datos, parche.proyectoId ?? (parche.proyectoId === null ? null : t.proyectoId), parche.grupoId ?? (parche.grupoId === null ? null : undefined))
        const nuevoProyecto = parche.proyectoId === null ? undefined : (v.proyectoId ?? t.proyectoId)
        const nuevoGrupo = parche.grupoId === null ? undefined : (v.grupoId ?? (parche.proyectoId === undefined ? t.grupoId : undefined))
        if (nuevoProyecto !== t.proyectoId || nuevoGrupo !== t.grupoId) {
          if (nuevoProyecto) t.proyectoId = nuevoProyecto
          else delete t.proyectoId
          if (nuevoGrupo) t.grupoId = nuevoGrupo
          else delete t.grupoId
          vinculada = true
        }
      }
      if (cambios.length === 0 && !vinculada) return t
      t.actualizada = Date.now()
      if (vinculada) reg('vinculada', `${corto(t)}: ${t.proyectoId ? `proyecto «${datos.proyectos.find((p) => p.id === t.proyectoId)?.nombre ?? t.proyectoId}»` : 'sin proyecto'}${t.grupoId ? `, grupo «${datos.grupos.find((g) => g.id === t.grupoId)?.nombre ?? t.grupoId}»` : ''}`, t, motivo)
      if (cambios.length) reg('editada', `Editó ${corto(t)}: ${cambios.join(', ')}`, t, motivo)
      return t
    })
  }

  private aplicarEstado(d: Documento, t: Tarea, destinoId: string, motivo: string | undefined, reg: Registrar): void {
    const destino = this.estadoDe(d, destinoId)
    if (t.estado === destino.id) return
    const rechazo = evaluarTransicion(t, destino, d.tareas, d.estados, motivo)
    if (rechazo) throw new Error(rechazo)
    const origen = d.estados.find((e) => e.id === t.estado)
    const ahora = Date.now()
    t.estado = destino.id
    t.actualizada = ahora
    t.orden = this.ordenFinal(d, destino.id)
    if (destino.categoria === 'en_curso') t.inicio ??= ahora
    if (destino.categoria === 'hecha') t.completada = ahora
    else delete t.completada
    reg('estado', `${corto(t)}: ${origen?.nombre ?? t.estado} → ${destino.nombre}`, t, motivo)
  }

  async estado(ref: string, estado: string, autor: Autor, motivo?: string): Promise<Tarea> {
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, ref)
      this.aplicarEstado(d, t, estado, motivo, reg)
      return t
    })
  }

  async mover(ref: string, estado: string, autor: Autor, antesDe?: string, motivo?: string): Promise<Tarea> {
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, ref)
      this.aplicarEstado(d, t, estado, motivo, reg)
      const columna = d.tareas.filter((x) => x.estado === t.estado && x.id !== t.id).sort((a, b) => a.orden - b.orden)
      const i = antesDe ? columna.findIndex((x) => x.id === antesDe) : -1
      columna.splice(i < 0 ? columna.length : i, 0, t)
      columna.forEach((x, j) => (x.orden = (j + 1) * 10))
      return t
    })
  }

  async comentar(ref: string, textoComentario: string, autor: Autor): Promise<Tarea> {
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, ref)
      const c = texto(textoComentario, 'texto', 5000, true)
      t.comentarios.push({ id: randomUUID().slice(0, 8), autor, texto: c, fecha: Date.now() })
      t.actualizada = Date.now()
      reg('comentario', `Comentó en ${corto(t)}: ${c.length > 120 ? c.slice(0, 120) + '…' : c}`, t)
      return t
    })
  }

  async item(e: OperacionesTareas['item']['entrada'], autor: Autor): Promise<Tarea> {
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, e.tarea)
      if (e.lista !== 'criterios' && e.lista !== 'checklist') throw new Error('«lista» debe ser criterios o checklist.')
      const lista = t[e.lista]
      const tipo: TipoActividad = e.lista === 'criterios' ? 'criterio' : 'checklist'
      const nombre = e.lista === 'criterios' ? 'criterio' : 'subtarea'
      const buscarItem = (): ItemLista => {
        const ref = String(e.itemId ?? '').trim()
        const x = lista.find((i) => i.id === ref) ?? (/^\d+$/.test(ref) ? lista[Number(ref) - 1] : undefined)
        if (!x) throw new Error(`No existe el ${nombre} «${ref}» en ${corto(t)}.`)
        return x
      }
      switch (e.accion) {
        case 'anadir': {
          if (lista.length >= MAX_ITEMS) throw new Error(`Máximo ${MAX_ITEMS} elementos por lista.`)
          const nuevo = item(e.texto)
          lista.push(nuevo)
          reg(tipo, `Añadió ${nombre} a ${corto(t)}: ${nuevo.texto}`, t)
          break
        }
        case 'marcar': {
          const x = buscarItem()
          x.hecho = e.hecho !== false
          reg(tipo, `${x.hecho ? 'Cumplió' : 'Reabrió'} ${nombre} de ${corto(t)}: ${x.texto}`, t)
          break
        }
        case 'editar': {
          const x = buscarItem()
          x.texto = texto(e.texto, 'texto', 300, true)
          reg(tipo, `Editó ${nombre} de ${corto(t)}: ${x.texto}`, t)
          break
        }
        case 'quitar': {
          const x = buscarItem()
          lista.splice(lista.indexOf(x), 1)
          reg(tipo, `Quitó ${nombre} de ${corto(t)}: ${x.texto}`, t)
          break
        }
        default:
          throw new Error('«accion» debe ser anadir, marcar, editar o quitar.')
      }
      t.actualizada = Date.now()
      return t
    })
  }

  async dependencias(ref: string, dependeDe: string[], autor: Autor): Promise<Tarea> {
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, ref)
      if (!Array.isArray(dependeDe)) throw new Error('«dependeDe» debe ser una lista.')
      const ids = [...new Set(dependeDe.map((r) => this.buscar(d, r).id))]
      if (ids.includes(t.id)) throw new Error('Una tarea no puede depender de sí misma.')
      if (haceCiclo(t.id, ids, d.tareas)) throw new Error('Esas dependencias crearían un ciclo (A espera a B y B espera a A).')
      const nombres = (lista: string[]): string => lista.map((id) => `#${d.tareas.find((x) => x.id === id)?.numero ?? '?'}`).join(', ') || 'ninguna'
      if (ids.join() === t.dependeDe.join()) return t
      reg('dependencias', `${corto(t)} depende de: ${nombres(ids)} (antes: ${nombres(t.dependeDe)})`, t)
      t.dependeDe = ids
      t.actualizada = Date.now()
      return t
    })
  }

  async referencia(e: OperacionesTareas['referencia']['entrada'], autor: Autor): Promise<Tarea> {
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, e.tarea)
      if (e.accion === 'anadir') {
        if (t.referencias.length >= MAX_ITEMS) throw new Error(`Máximo ${MAX_ITEMS} referencias.`)
        const r = referencia(e)
        t.referencias.push(r)
        reg('referencia', `Añadió referencia a ${corto(t)}: ${r.titulo}`, t)
      } else if (e.accion === 'quitar') {
        const ref = String(e.referenciaId ?? '').trim()
        const r = t.referencias.find((x) => x.id === ref) ?? (/^\d+$/.test(ref) ? t.referencias[Number(ref) - 1] : undefined)
        if (!r) throw new Error(`No existe la referencia «${ref}».`)
        t.referencias.splice(t.referencias.indexOf(r), 1)
        reg('referencia', `Quitó referencia de ${corto(t)}: ${r.titulo}`, t)
      } else throw new Error('«accion» debe ser anadir o quitar.')
      t.actualizada = Date.now()
      return t
    })
  }

  /** Solo la interfaz lo ofrece: la IA no borra tareas (puede descartarlas con un motivo). */
  async eliminar(ref: string, autor: Autor): Promise<{ ok: true }> {
    return this.mutar(autor, (d, reg) => {
      const t = this.buscar(d, ref)
      d.tareas = d.tareas.filter((x) => x.id !== t.id)
      for (const x of d.tareas) x.dependeDe = x.dependeDe.filter((id) => id !== t.id)
      reg('eliminada', `Eliminó ${corto(t)}`, t)
      return { ok: true as const }
    })
  }

  async guardarEstados(estados: EstadoTarea[], reasignar: Record<string, string> | undefined, autor: Autor): Promise<EstadoTarea[]> {
    const limpios = (Array.isArray(estados) ? estados : []).map((e) => ({ id: String(e.id).trim(), nombre: String(e.nombre).trim(), categoria: e.categoria }))
    const error = validarEstados(limpios)
    if (error) throw new Error(error)
    return this.mutar(autor, (d, reg) => {
      const quitados = d.estados.filter((e) => !limpios.some((n) => n.id === e.id))
      for (const q of quitados) {
        const usadas = d.tareas.filter((t) => t.estado === q.id)
        if (usadas.length === 0) continue
        const destino = reasignar?.[q.id]
        if (!destino || !limpios.some((n) => n.id === destino)) throw new Error(`El estado «${q.nombre}» tiene ${usadas.length} tarea(s): indica a qué estado pasan.`)
        for (const t of usadas) t.estado = destino
      }
      // Una tarea que cambia de categoría por reasignación conserva sus datos; las marcas de fechas se ajustan al abrir o cerrar.
      for (const t of d.tareas) {
        if (categoriaDe(limpios, t.estado) !== 'hecha') delete t.completada
        else t.completada ??= Date.now()
      }
      d.estados = limpios
      reg('estados', `Cambió los estados: ${limpios.map((e) => e.nombre).join(' · ')}`)
      return limpios
    })
  }

  /**
   * Incorpora tareas de otra computadora (mismo proyecto): las nuevas se añaden y las que ya existen se reemplazan solo si la remota
   * es más reciente. Si el número corto (#n) de una nueva ya lo usa otra tarea, recibe uno libre; un estado desconocido pasa a «pendiente».
   * Devuelve cuántas tareas cambiaron. No pasa por las reglas de transición: es el estado que ya validó el otro equipo.
   */
  async fusionar(remotas: Tarea[]): Promise<number> {
    let cambios = 0
    await this.almacen.actualizar(ID, (actual) => {
      const d = normalizar(actual)
      const estados = new Set(d.estados.map((e) => e.id))
      for (const r of remotas) {
        if (!r || typeof r.id !== 'string' || typeof r.titulo !== 'string') continue
        const i = d.tareas.findIndex((t) => t.id === r.id)
        if (i >= 0 && d.tareas[i].actualizada >= r.actualizada) continue
        const tarea: Tarea = { ...r, estado: estados.has(r.estado) ? r.estado : 'pendiente' }
        if (i >= 0) {
          tarea.numero = d.tareas[i].numero
          d.tareas[i] = tarea
        } else {
          if (d.tareas.some((t) => t.numero === tarea.numero)) tarea.numero = d.siguiente
          d.siguiente = Math.max(d.siguiente, tarea.numero + 1)
          d.tareas.push(tarea)
        }
        cambios++
      }
      return cambios ? d : actual
    })
    if (cambios) this.ctx.alCambiar?.()
    return cambios
  }

  /**
   * Quita tareas que se borraron en otra computadora. `soloSinProyecto`: solo si aquí tampoco tienen proyecto (un borrado de la lista de
   * tareas sueltas no debe llevarse una tarea que mientras tanto pasó a un proyecto). Devuelve cuántas quitó.
   */
  async quitarRemotas(borradas: { id: string; hasta: number }[], soloSinProyecto = false): Promise<number> {
    let n = 0
    await this.almacen.actualizar(ID, (actual) => {
      const d = normalizar(actual)
      const antes = d.tareas.length
      const porId = new Map(borradas.map((b) => [b.id, b.hasta]))
      d.tareas = d.tareas.filter((t) => {
        const hasta = porId.get(t.id)
        if (hasta === undefined || t.actualizada > hasta || (soloSinProyecto && t.proyectoId)) return true
        return false
      })
      for (const t of d.tareas) t.dependeDe = t.dependeDe.filter((id) => !porId.has(id) || d.tareas.some((x) => x.id === id))
      n = antes - d.tareas.length
      return n ? d : actual
    })
    if (n) this.ctx.alCambiar?.()
    return n
  }

  /** Columnas del tablero que llegan de otra computadora. Las inválidas se ignoran; las tareas en un estado que ya no existe pasan al primero. */
  async fijarEstados(estados: EstadoTarea[]): Promise<boolean> {
    if (!Array.isArray(estados) || validarEstados(estados) !== null) return false
    let cambio = false
    await this.almacen.actualizar(ID, (actual) => {
      const d = normalizar(actual)
      if (JSON.stringify(d.estados) === JSON.stringify(estados)) return actual
      d.estados = estados.map((e) => ({ ...e }))
      const ids = new Set(estados.map((e) => e.id))
      for (const t of d.tareas) if (!ids.has(t.estado)) t.estado = estados[0]!.id
      cambio = true
      return d
    })
    if (cambio) this.ctx.alCambiar?.()
    return cambio
  }

  /** Cuando se elimina un proyecto o un grupo, sus tareas quedan sueltas (no se pierden). */
  async desvincular(f: { proyectoId?: string; grupoId?: string }): Promise<void> {
    await this.mutar('usuario', (d, reg) => {
      for (const t of d.tareas) {
        const porProyecto = f.proyectoId !== undefined && t.proyectoId === f.proyectoId
        const porGrupo = f.grupoId !== undefined && t.grupoId === f.grupoId
        if (!porProyecto && !porGrupo) continue
        if (porProyecto) delete t.proyectoId
        if (porGrupo) delete t.grupoId
        t.actualizada = Date.now()
        reg('vinculada', `${corto(t)} quedó sin ${porProyecto ? 'proyecto' : 'grupo'} (se eliminó)`, t)
      }
    })
  }

  // ---------------------------------------------------------------- contexto para la IA

  /**
   * Resumen compacto de las tareas del proyecto para el prompt del asistente: lo que está abierto, lo que bloquea y la
   * siguiente recomendada. Va acotado: la IA consulta el detalle con las herramientas.
   */
  async contextoParaIA(proyectoId: string, nombreProyecto: string): Promise<string> {
    const d = await this.leer()
    const tareas = filtrarTareas(d.tareas, d.estados, { proyectoId })
    const abiertas = tareas.filter((t) => estaAbierta(t, d.estados))
    const reglas =
      'Reglas: antes de implementar algo, consulta las tareas relacionadas (listar_tareas / obtener_tarea) y respeta sus criterios de aceptación; ' +
      'pasa la tarea a «en curso» al empezar; marca cada criterio al cumplirlo; completa la tarea solo cuando todos se cumplan; ' +
      'documenta decisiones y problemas con comentar_tarea. No borres tareas: si ya no valen, descártalas con un motivo.'
    if (tareas.length === 0) return `Tareas de «${nombreProyecto}»: aún no hay ninguna. Puedes crearlas con crear_tarea / crear_tareas.\n${reglas}`
    const r = resumirTareas(tareas, d.tareas, d.estados)
    const nombreEstado = (id: string): string => d.estados.find((e) => e.id === id)?.nombre ?? id
    const lineas = abiertas.slice(0, 25).map((t) => {
      const deps = dependenciasAbiertas(t, d.tareas, d.estados)
      const crit = t.criterios.length ? ` · criterios ${t.criterios.filter((c) => c.hecho).length}/${t.criterios.length}` : ' · sin criterios'
      return `#${t.numero} [${nombreEstado(t.estado)} · ${t.prioridad}] ${t.titulo}${t.vence ? ` · vence ${fechaCorta(t.vence)}` : ''}${deps.length ? ` · espera a ${deps.map((x) => `#${x.numero}`).join(', ')}` : ''}${crit}`
    })
    return [
      `Tareas de «${nombreProyecto}»: ${r.abiertas} abiertas, ${r.hechas} terminadas (${r.progreso} %).`,
      ...lineas,
      ...(abiertas.length > 25 ? [`… y ${abiertas.length - 25} más (usa listar_tareas).`] : []),
      ...(r.siguiente ? [`Siguiente recomendada: #${r.siguiente.numero} ${r.siguiente.titulo}.`] : []),
      reglas
    ].join('\n')
  }
}
