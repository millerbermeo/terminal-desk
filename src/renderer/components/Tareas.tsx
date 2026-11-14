import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import { NOMBRE_RESPONSABLE, PRIORIDADES, categoriaDe, fechaCorta, filtrarTareas, type DatosNuevaTarea, type ParcheTarea, type Tarea } from '@shared/tareas'
import { NOMBRE_AGRUPAR, aplicarFiltroVista, contarFiltros, rangoIds, valoresUsados, type AgruparPor, type FiltroVista } from '@shared/tareas-vista'
import { filtroDeAmbito, useTareas, mensajeDe, type Ambito } from '../tareas/useTareas'
import { usePrefsVista, type Pestana } from '../tareas/vista'
import { TareaDetalle } from './TareaDetalle'
import { TareasEstados } from './TareasEstados'
import { EstadoVacio } from './EstadoVacio'
import { IconoMas, IconoTareas, IconoCerrar } from './Iconos'
import { Esqueletos } from './Cargando'
import { ModalConfirmar } from './ModalConfirmar'
import { AccionesMasivas } from './tareas/AccionesMasivas'
import { AyudaAtajos } from './tareas/AyudaAtajos'
import { BarraFiltros } from './tareas/BarraFiltros'
import { Calendario } from './tareas/Calendario'
import { ContextoAcciones, type AccionesTareas } from './tareas/contexto'
import { Cronograma } from './tareas/Cronograma'
import { Emergente, MenuLista, type ItemMenu } from './tareas/Emergente'
import { ListaTareas } from './tareas/ListaTareas'
import { ActividadTareas, Resumen } from './tareas/PanelResumen'
import { atajosFecha } from './tareas/Selectores'
import { Tablero } from './tareas/Tablero'
import { VistaHoy } from './tareas/VistaHoy'
import { ICONO_PRIORIDAD, NOMBRE_PRIORIDAD } from './tareas/constantes'

export { NOMBRE_COLOR, NOMBRE_PRIORIDAD } from './tareas/constantes'

const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'tablero', nombre: 'Tablero' },
  { id: 'lista', nombre: 'Lista' },
  { id: 'calendario', nombre: 'Calendario' },
  { id: 'cronograma', nombre: 'Cronograma' },
  { id: 'hoy', nombre: 'Mis tareas' },
  { id: 'resumen', nombre: 'Resumen' },
  { id: 'actividad', nombre: 'Actividad' }
]
const AGRUPABLES: AgruparPor[] = ['ninguno', 'proyecto', 'prioridad', 'responsable', 'etiqueta', 'hito']
const CON_FILTROS: Pestana[] = ['tablero', 'lista', 'calendario', 'cronograma', 'hoy']

interface Props {
  datos: DatosProyectos
  visible: boolean
}

interface PeticionMotivo {
  tarea: Tarea
  estado: string
  antesDe?: string
  pregunta: string
}

interface Aviso {
  id: number
  texto: string
  deshacer?: () => void
}

type NivelMenu = 'principal' | 'estado' | 'prioridad' | 'responsable' | 'fecha'

/** Parche que deja la tarea como estaba antes de aplicar `parche` (para «Deshacer»). */
function inversoDe(t: Tarea, parche: ParcheTarea): ParcheTarea {
  const inv: ParcheTarea = {}
  if ('titulo' in parche) inv.titulo = t.titulo
  if ('descripcion' in parche) inv.descripcion = t.descripcion
  if ('notasTecnicas' in parche) inv.notasTecnicas = t.notasTecnicas
  if ('prioridad' in parche) inv.prioridad = t.prioridad
  if ('color' in parche) inv.color = t.color ?? null
  if ('etiquetas' in parche) inv.etiquetas = t.etiquetas
  if ('responsable' in parche) inv.responsable = t.responsable ?? null
  if ('estimacion' in parche) inv.estimacion = t.estimacion ?? null
  if ('hito' in parche) inv.hito = t.hito ?? null
  if ('inicio' in parche) inv.inicio = t.inicio ?? null
  if ('vence' in parche) inv.vence = t.vence ?? null
  if ('proyectoId' in parche) inv.proyectoId = t.proyectoId ?? null
  if ('grupoId' in parche) inv.grupoId = t.grupoId ?? null
  return inv
}

const NOMBRE_CAMPO: Record<string, string> = { prioridad: 'Prioridad', vence: 'Fecha', inicio: 'Inicio', responsable: 'Responsable', estimacion: 'Estimación', hito: 'Hito', color: 'Color', etiquetas: 'Etiquetas', titulo: 'Título', proyectoId: 'Proyecto', grupoId: 'Grupo', descripcion: 'Descripción', notasTecnicas: 'Notas' }

/** Tareas por grupos y proyectos: tablero, lista, calendario, cronograma y más. La IA las lee y las cambia con las mismas reglas que el usuario. */
export function Tareas({ datos, visible }: Props) {
  const { tareas, estados, cargado, error, setError } = useTareas()
  const [prefs, setPrefs] = usePrefsVista()
  const [ambito, setAmbito] = useState<Ambito>('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [motivo, setMotivo] = useState<PeticionMotivo | null>(null)
  const [verEstados, setVerEstados] = useState(false)
  const [verAyuda, setVerAyuda] = useState(false)
  const [nueva, setNueva] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [enfocada, setEnfocada] = useState<string | undefined>()
  const [menu, setMenu] = useState<{ x: number; y: number; t: Tarea; nivel: NivelMenu } | null>(null)
  const [aEliminar, setAEliminar] = useState<Tarea[] | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const entradaRapida = useRef<HTMLInputElement>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const cuerpo = useRef<HTMLDivElement>(null)
  const ancla = useRef<string | undefined>(undefined)
  const pila = useRef<Aviso[]>([])
  const contador = useRef(0)

  const filtro = prefs.filtro
  const nombreProyecto = useMemo(() => new Map(datos.proyectos.map((p) => [p.id, p.nombre])), [datos.proyectos])
  const usados = useMemo(() => valoresUsados(tareas), [tareas])
  const enAmbito = useMemo(() => filtrarTareas(tareas, estados, filtroDeAmbito(ambito)), [tareas, estados, ambito])
  const visibles = useMemo(() => aplicarFiltroVista(enAmbito, tareas, estados, filtro), [enAmbito, tareas, estados, filtro])
  const seleccionadas = useMemo(() => tareas.filter((t) => seleccion.has(t.id)), [tareas, seleccion])

  // La tarea abierta puede haber sido eliminada (por ti o desde otra ventana); la selección también se limpia de lo que ya no existe.
  useEffect(() => {
    if (abierta && cargado && !tareas.some((t) => t.id === abierta)) setAbierta(null)
    setSeleccion((s) => (s.size && [...s].some((id) => !tareas.some((t) => t.id === id)) ? new Set([...s].filter((id) => tareas.some((t) => t.id === id))) : s))
  }, [abierta, cargado, tareas])

  // ---------------------------------------------------------------- avisos con «Deshacer»

  const avisar = useCallback((texto: string, deshacer?: () => void): void => {
    const a: Aviso = { id: ++contador.current, texto, ...(deshacer ? { deshacer } : {}) }
    if (deshacer) pila.current = [...pila.current.slice(-19), a]
    setAviso(a)
  }, [])
  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso((x) => (x?.id === aviso.id ? null : x)), 7000)
    return () => clearTimeout(t)
  }, [aviso])
  const deshacerUltimo = useCallback((): void => {
    const a = pila.current.pop()
    if (!a?.deshacer) return
    a.deshacer()
    setAviso(null)
  }, [])

  // ---------------------------------------------------------------- acciones

  const op = window.api.tareas.operar

  /** Cambia el estado; si la regla pide un motivo (bloquear, descartar, reabrir) lo pregunta y reintenta. */
  const mover = useCallback(
    async (t: Tarea, estado: string, antesDe?: string, razon?: string): Promise<void> => {
      const previo = t.estado
      try {
        await op('mover', { tarea: t.id, estado, ...(antesDe ? { antesDe } : {}), ...(razon ? { motivo: razon } : {}) })
        setError('')
        setMotivo(null)
        if (previo !== estado) {
          const nombre = estados.find((e) => e.id === estado)?.nombre ?? estado
          avisar(`#${t.numero} movida a «${nombre}»`, () => void mover({ ...t, estado }, previo))
        }
      } catch (err) {
        const m = mensajeDe(err)
        if (/^Indica por qué/.test(m)) setMotivo({ tarea: t, estado, ...(antesDe ? { antesDe } : {}), pregunta: m })
        else setError(m)
      }
    },
    [op, setError, estados, avisar]
  )

  const editar = useCallback(
    async (t: Tarea, parche: ParcheTarea, deshacer = false): Promise<boolean> => {
      try {
        await op('editar', { tarea: t.id, parche })
        setError('')
        if (deshacer) {
          const campo = Object.keys(parche)[0] ?? ''
          const previa = inversoDe(t, parche)
          avisar(`${NOMBRE_CAMPO[campo] ?? 'Cambio'} de #${t.numero} actualizado`, () => void op('editar', { tarea: t.id, parche: previa }).catch((e) => setError(mensajeDe(e))))
        }
        return true
      } catch (err) {
        setError(mensajeDe(err))
        return false
      }
    },
    [op, setError, avisar]
  )

  const crear = useCallback(
    async (d: DatosNuevaTarea): Promise<Tarea | undefined> => {
      const proyectoId = ambito.startsWith('p:') ? ambito.slice(2) : undefined
      const grupoId = ambito.startsWith('g:') ? ambito.slice(2) : undefined
      try {
        const t = await op('crear', { ...(proyectoId ? { proyectoId } : {}), ...(grupoId ? { grupoId } : {}), ...d })
        setError('')
        avisar(`Tarea #${t.numero} creada`, () => void op('eliminar', { tarea: t.id }).catch((e) => setError(mensajeDe(e))))
        return t
      } catch (err) {
        setError(mensajeDe(err))
        return undefined
      }
    },
    [op, ambito, setError, avisar]
  )

  const duplicar = useCallback(
    async (t: Tarea): Promise<void> => {
      const pendiente = categoriaDe(estados, t.estado) === 'pendiente'
      await crear({
        titulo: `${t.titulo} (copia)`.slice(0, 200),
        descripcion: t.descripcion,
        prioridad: t.prioridad,
        ...(t.color ? { color: t.color } : {}),
        ...(t.proyectoId ? { proyectoId: t.proyectoId } : {}),
        ...(t.grupoId ? { grupoId: t.grupoId } : {}),
        ...(pendiente ? { estado: t.estado } : {}),
        etiquetas: t.etiquetas,
        ...(t.responsable ? { responsable: t.responsable } : {}),
        ...(t.estimacion !== undefined ? { estimacion: t.estimacion } : {}),
        ...(t.hito ? { hito: t.hito } : {}),
        ...(t.inicio !== undefined ? { inicio: t.inicio } : {}),
        ...(t.vence !== undefined ? { vence: t.vence } : {}),
        notasTecnicas: t.notasTecnicas,
        criterios: t.criterios.map((c) => c.texto),
        checklist: t.checklist.map((c) => c.texto)
      })
    },
    [crear, estados]
  )

  const idsEnPantalla = useCallback((): string[] => [...new Set([...(cuerpo.current?.querySelectorAll<HTMLElement>('[data-tarea]') ?? [])].map((el) => el.dataset.tarea!))], [])

  const alternarSeleccion = useCallback(
    (id: string, rango: boolean): void => {
      setSeleccion((s) => {
        if (rango && ancla.current) return new Set([...s, ...rangoIds(idsEnPantalla(), ancla.current, id)])
        const n = new Set(s)
        if (!n.delete(id)) n.add(id)
        return n
      })
      if (!rango) ancla.current = id
      setEnfocada(id)
    },
    [idsEnPantalla]
  )

  const acciones: AccionesTareas = {
    todas: tareas,
    estados,
    datos,
    nombreProyecto,
    etiquetasUsadas: usados.etiquetas,
    hitosUsados: usados.hitos,
    abrir: setAbierta,
    mover,
    editar,
    crear,
    duplicar,
    eliminar: (ts) => setAEliminar(ts),
    menu: (x, y, t) => setMenu({ x, y, t, nivel: 'principal' }),
    seleccion,
    alternarSeleccion,
    seleccionar: (ids) => setSeleccion(new Set(ids)),
    ...(enfocada ? { enfocada } : {})
  }

  const eliminarConfirmado = async (ts: Tarea[]): Promise<void> => {
    setAEliminar(null)
    let hechas = 0
    for (const t of ts) {
      try {
        await op('eliminar', { tarea: t.id })
        hechas++
      } catch (err) {
        setError(mensajeDe(err))
        break
      }
    }
    setSeleccion(new Set())
    if (hechas) avisar(hechas === 1 ? 'Tarea eliminada' : `${hechas} tareas eliminadas`)
  }

  const crearRapida = async (): Promise<void> => {
    const titulo = nueva.trim()
    if (!titulo) return
    if (await crear({ titulo })) setNueva('')
  }

  // ---------------------------------------------------------------- atajos de teclado

  const marcada = (): Tarea | undefined => tareas.find((t) => t.id === enfocada)
  useEffect(() => {
    if (!visible) return
    const tecla = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      const escribiendo = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !escribiendo) {
        e.preventDefault()
        deshacerUltimo()
        return
      }
      if (escribiendo || e.ctrlKey || e.metaKey || e.altKey) return
      if (abierta || verEstados || verAyuda || motivo || aEliminar) return
      if (document.querySelector('.modal-fondo, .emg')) return
      const ids = idsEnPantalla()
      const mover1 = (d: number): void => {
        const i = enfocada ? ids.indexOf(enfocada) : -1
        const nuevo = ids[Math.min(ids.length - 1, Math.max(0, i < 0 ? (d > 0 ? 0 : ids.length - 1) : i + d))]
        if (nuevo) {
          setEnfocada(nuevo)
          cuerpo.current?.querySelector(`[data-tarea="${nuevo}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
      }
      const t = marcada()
      switch (e.key) {
        case 'c':
        case 'C':
          e.preventDefault()
          entradaRapida.current?.focus()
          break
        case '/':
          e.preventDefault()
          buscador.current?.focus()
          break
        case '?':
          e.preventDefault()
          setVerAyuda(true)
          break
        case 'j':
        case 'ArrowDown':
          if (!ids.length) return
          e.preventDefault()
          mover1(1)
          break
        case 'k':
        case 'ArrowUp':
          if (!ids.length) return
          e.preventDefault()
          mover1(-1)
          break
        case 'Enter':
          if (t && !(e.target as HTMLElement).closest('[data-tarea]')) setAbierta(t.id)
          break
        case ' ':
          if (t && !(e.target as HTMLElement).closest('[data-tarea]')) {
            e.preventDefault()
            alternarSeleccion(t.id, false)
          }
          break
        case 'e':
        case 'E':
          if (t) {
            e.preventDefault()
            const r = cuerpo.current?.querySelector(`[data-tarea="${t.id}"]`)?.getBoundingClientRect()
            setMenu({ x: r?.left ?? 200, y: (r?.bottom ?? 200) + 4, t, nivel: 'estado' })
          }
          break
        case '1':
        case '2':
        case '3':
        case '4':
          if (t) void editar(t, { prioridad: PRIORIDADES[Number(e.key) - 1]! }, true)
          break
        case 'd':
        case 'D':
          if (t) void duplicar(t)
          break
        case 'Delete':
        case 'Backspace': {
          const objetivo = seleccionadas.length ? seleccionadas : t ? [t] : []
          if (objetivo.length) {
            e.preventDefault()
            setAEliminar(objetivo)
          }
          break
        }
        case 'Escape':
          if (seleccion.size) setSeleccion(new Set())
          else setEnfocada(undefined)
          break
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  // ---------------------------------------------------------------- menú contextual

  const itemsMenu = (m: NonNullable<typeof menu>): ItemMenu[] => {
    const { t } = m
    const sub = (nivel: NivelMenu) => () => setMenu({ ...m, nivel })
    if (m.nivel === 'estado') return estados.map((e) => ({ id: e.id, etiqueta: e.nombre, activo: t.estado === e.id, onClick: () => void mover(t, e.id) }))
    if (m.nivel === 'prioridad') return PRIORIDADES.map((p, i) => ({ id: p, etiqueta: NOMBRE_PRIORIDAD[p], icono: <span className={`prio-punto prio-${p}`}>{ICONO_PRIORIDAD[p]}</span>, atajo: String(i + 1), activo: t.prioridad === p, onClick: () => void editar(t, { prioridad: p }, true) }))
    if (m.nivel === 'responsable')
      return [
        { id: 'usuario', etiqueta: 'Yo', activo: t.responsable === 'usuario', onClick: () => void editar(t, { responsable: 'usuario' }, true) },
        { id: 'ia', etiqueta: 'IA (Asistente)', activo: t.responsable === 'ia', onClick: () => void editar(t, { responsable: 'ia' }, true) },
        { id: 'sin', etiqueta: 'Sin asignar', separador: true, activo: !t.responsable, onClick: () => void editar(t, { responsable: null }, true) }
      ]
    if (m.nivel === 'fecha')
      return [
        ...atajosFecha().map((a) => ({ id: a.id, etiqueta: a.etiqueta, atajo: fechaCorta(a.ms).slice(5), onClick: () => void editar(t, { vence: a.ms }, true) })),
        ...(t.vence !== undefined ? [{ id: 'quitar', etiqueta: 'Quitar fecha', separador: true, peligro: true, onClick: () => void editar(t, { vence: null }, true) }] : [])
      ]
    const varias = seleccion.has(t.id) && seleccion.size > 1
    return [
      { id: 'abrir', etiqueta: 'Abrir', atajo: 'Enter', onClick: () => setAbierta(t.id) },
      { id: 'estado', etiqueta: `Estado: ${estados.find((e) => e.id === t.estado)?.nombre ?? t.estado} ▸`, atajo: 'E', separador: true, onClick: sub('estado') },
      { id: 'prioridad', etiqueta: `Prioridad: ${NOMBRE_PRIORIDAD[t.prioridad]} ▸`, onClick: sub('prioridad') },
      { id: 'responsable', etiqueta: `Responsable: ${t.responsable ? NOMBRE_RESPONSABLE[t.responsable] : 'sin asignar'} ▸`, onClick: sub('responsable') },
      { id: 'fecha', etiqueta: `Fecha: ${t.vence !== undefined ? fechaCorta(t.vence) : 'sin fecha'} ▸`, onClick: sub('fecha') },
      { id: 'duplicar', etiqueta: 'Duplicar', atajo: 'D', separador: true, onClick: () => void duplicar(t) },
      { id: 'copiar', etiqueta: 'Copiar «#número título»', onClick: () => void navigator.clipboard.writeText(`#${t.numero} ${t.titulo}`).then(() => avisar('Copiado al portapapeles')) },
      { id: 'eliminar', etiqueta: varias ? `Eliminar ${seleccion.size} tareas` : 'Eliminar', atajo: 'Supr', peligro: true, separador: true, onClick: () => setAEliminar(varias ? seleccionadas : [t]) }
    ]
  }

  // ---------------------------------------------------------------- vista

  const conFiltros = CON_FILTROS.includes(prefs.pestana)
  const puedeAgrupar = prefs.pestana === 'tablero' || prefs.pestana === 'lista'
  const prefijoNueva = ambito.startsWith('p:') ? { proyectoId: ambito.slice(2) } : ambito.startsWith('g:') ? { grupoId: ambito.slice(2) } : undefined

  return (
    <main className="tareas" style={{ display: visible ? 'flex' : 'none' }}>
      <header className="tareas-barra">
        <select value={ambito} onChange={(e) => setAmbito(e.target.value as Ambito)} aria-label="Ámbito">
          <option value="">Todas las tareas</option>
          <option value="__sin__">Sin proyecto</option>
          {datos.grupos.length > 0 && (
            <optgroup label="Grupos">
              {datos.grupos.map((g) => (
                <option key={g.id} value={`g:${g.id}`}>
                  {g.nombre}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Proyectos">
            {datos.proyectos.map((p) => (
              <option key={p.id} value={`p:${p.id}`}>
                {p.nombre}
              </option>
            ))}
          </optgroup>
        </select>
        <div className="segmentado tareas-pestanas" role="tablist">
          {PESTANAS.map((p) => (
            <button key={p.id} role="tab" aria-selected={prefs.pestana === p.id} className={prefs.pestana === p.id ? 'on' : ''} onClick={() => setPrefs({ pestana: p.id })}>
              {p.nombre}
            </button>
          ))}
        </div>
        <span className="ag-espacio" />
        {conFiltros && (
          <input
            ref={buscador}
            className="tareas-buscar"
            type="search"
            value={filtro.texto}
            placeholder="Buscar…  ( / )"
            onChange={(e) => setPrefs({ filtro: { ...filtro, texto: e.target.value } })}
            aria-label="Buscar tareas"
          />
        )}
        {puedeAgrupar && (
          <select value={prefs.agrupar} onChange={(e) => setPrefs({ agrupar: e.target.value as AgruparPor })} aria-label="Agrupar por" title="Agrupar por">
            {AGRUPABLES.map((g) => (
              <option key={g} value={g}>
                {g === 'ninguno' ? 'Agrupar: nada' : `Agrupar: ${NOMBRE_AGRUPAR[g]}`}
              </option>
            ))}
          </select>
        )}
        {prefs.pestana === 'tablero' && (
          <div className="segmentado" role="group" aria-label="Densidad de las tarjetas">
            <button className={prefs.densidad === 'comoda' ? 'on' : ''} aria-pressed={prefs.densidad === 'comoda'} onClick={() => setPrefs({ densidad: 'comoda' })} title="Tarjetas cómodas">
              ▤
            </button>
            <button className={prefs.densidad === 'compacta' ? 'on' : ''} aria-pressed={prefs.densidad === 'compacta'} onClick={() => setPrefs({ densidad: 'compacta' })} title="Tarjetas compactas">
              ☰
            </button>
          </div>
        )}
        <button onClick={() => setVerEstados(true)} title="Editar los estados del flujo de trabajo">
          Estados
        </button>
        <button className="icono" onClick={() => setVerAyuda(true)} title="Atajos de teclado ( ? )" aria-label="Atajos de teclado">
          ⌨
        </button>
        <button className="primario" onClick={() => entradaRapida.current?.focus()} title="Crear una tarea ( C )">
          <IconoMas /> Nueva tarea
        </button>
      </header>
      {conFiltros && <BarraFiltros filtro={filtro} onFiltro={(f: FiltroVista) => setPrefs({ filtro: f })} estados={estados} etiquetas={usados.etiquetas} hitos={usados.hitos} />}
      <form
        className="tareas-rapida"
        onSubmit={(e) => {
          e.preventDefault()
          void crearRapida()
        }}
      >
        <IconoMas />
        <input ref={entradaRapida} value={nueva} maxLength={200} placeholder={ambito.startsWith('p:') || ambito.startsWith('g:') ? 'Nueva tarea aquí… (Enter)' : 'Nueva tarea (sin proyecto: vincúlala después)… (Enter)'} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()} aria-label="Nueva tarea" />
        {conFiltros && tareas.length > 0 && (
          <span className="tareas-suave tareas-conteo" aria-live="polite">
            {visibles.length === tareas.length ? `${tareas.length} tareas` : `${visibles.length} de ${tareas.length}`}
            {contarFiltros(filtro) > 0 ? ' · filtrado' : ''}
          </span>
        )}
      </form>
      {error && (
        <div className="tareas-error" role="alert">
          {error}
          <button className="icono" onClick={() => setError('')} aria-label="Cerrar aviso">
            <IconoCerrar />
          </button>
        </div>
      )}
      <ContextoAcciones.Provider value={acciones}>
        <div className="tareas-cuerpo" ref={cuerpo}>
          {!cargado ? (
            <Esqueletos forma="tarjetas" cuantos={4} />
          ) : tareas.length === 0 ? (
            <EstadoVacio
              icono={<IconoTareas />}
              titulo="Aún no hay tareas"
              texto="Organiza el trabajo por grupos y proyectos, con criterios de aceptación y dependencias. La IA lee y actualiza las mismas tareas: pídele un plan con /plan en el Asistente."
              pistas={['/plan <funcionalidad>', '/tareas']}
              accion={
                <button className="primario" onClick={() => entradaRapida.current?.focus()}>
                  <IconoMas /> Crear la primera tarea
                </button>
              }
            />
          ) : prefs.pestana === 'tablero' ? (
            <Tablero tareas={visibles} agrupar={prefs.agrupar} prefs={prefs} onPrefs={setPrefs} />
          ) : prefs.pestana === 'lista' ? (
            <ListaTareas tareas={visibles} agrupar={prefs.agrupar} prefs={prefs} onPrefs={setPrefs} />
          ) : prefs.pestana === 'calendario' ? (
            <Calendario tareas={visibles} {...(prefijoNueva ? { prefijoNueva } : {})} />
          ) : prefs.pestana === 'cronograma' ? (
            <Cronograma tareas={visibles} />
          ) : prefs.pestana === 'hoy' ? (
            <VistaHoy tareas={visibles} />
          ) : prefs.pestana === 'resumen' ? (
            <Resumen ambito={ambito} tareas={tareas} />
          ) : (
            <ActividadTareas ambito={ambito} tareas={tareas} />
          )}
        </div>
        {seleccion.size > 0 && <AccionesMasivas seleccionadas={seleccionadas} onLimpiar={() => setSeleccion(new Set())} />}
        {abierta && (
          <TareaDetalle
            id={abierta}
            datos={datos}
            todas={tareas}
            estados={estados}
            etiquetasUsadas={usados.etiquetas}
            onCerrar={() => setAbierta(null)}
            onEstado={(t, estado) => mover(t, estado)}
            onAbrir={setAbierta}
            onNavegar={(d) => {
              const ids = idsEnPantalla()
              const i = ids.indexOf(abierta)
              const siguiente = ids[i + d]
              if (siguiente) setAbierta(siguiente)
            }}
            onEliminar={(t) => setAEliminar([t])}
            onDuplicar={(t) => void duplicar(t)}
            intentar={async (f) => {
              try {
                await f()
                setError('')
                return true
              } catch (err) {
                setError(mensajeDe(err))
                return false
              }
            }}
          />
        )}
      </ContextoAcciones.Provider>
      {verEstados && (
        <TareasEstados
          estados={estados}
          tareas={tareas}
          onCerrar={() => setVerEstados(false)}
          intentar={async (f) => {
            try {
              await f()
              setError('')
              return true
            } catch (err) {
              setError(mensajeDe(err))
              return false
            }
          }}
        />
      )}
      {verAyuda && <AyudaAtajos onCerrar={() => setVerAyuda(false)} />}
      {motivo && <ModalMotivo peticion={motivo} onCancelar={() => setMotivo(null)} onConfirmar={(r) => void mover(motivo.tarea, motivo.estado, motivo.antesDe, r)} />}
      {aEliminar && (
        <ModalConfirmar
          titulo={aEliminar.length === 1 ? 'Eliminar tarea' : `Eliminar ${aEliminar.length} tareas`}
          texto={aEliminar.length === 1 ? `¿Eliminar #${aEliminar[0]!.numero} «${aEliminar[0]!.titulo}»? Las tareas que dependían de ella dejan de esperarla. Si solo ya no hace falta, mejor descártala con un motivo.` : `¿Eliminar ${aEliminar.length} tareas? Esta acción no se puede deshacer.`}
          etiqueta="Eliminar"
          onConfirmar={() => void eliminarConfirmado(aEliminar)}
          onCerrar={() => setAEliminar(null)}
        />
      )}
      {menu && (
        <Emergente key={menu.nivel} ancla={{ x: menu.x, y: menu.y }} onCerrar={() => setMenu(null)} etiqueta={`Acciones de #${menu.t.numero}`}>
          <MenuLista items={itemsMenu(menu)} onCerrar={() => setMenu(null)} />
        </Emergente>
      )}
      {aviso && (
        <div className="tareas-aviso" role="status" aria-live="polite">
          <span>{aviso.texto}</span>
          {aviso.deshacer && (
            <button onClick={deshacerUltimo}>
              Deshacer <kbd>Ctrl+Z</kbd>
            </button>
          )}
          <button className="icono" onClick={() => setAviso(null)} aria-label="Cerrar aviso">
            <IconoCerrar />
          </button>
        </div>
      )}
    </main>
  )
}

function ModalMotivo({ peticion, onCancelar, onConfirmar }: { peticion: PeticionMotivo; onCancelar: () => void; onConfirmar: (motivo: string) => void }) {
  const [texto, setTexto] = useState('')
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancelar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCancelar])
  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <form
        className="modal modal-chico"
        role="dialog"
        aria-modal="true"
        aria-label="Motivo del cambio"
        onSubmit={(e) => {
          e.preventDefault()
          if (texto.trim()) onConfirmar(texto.trim())
        }}
      >
        <div className="modal-cab">
          <h3>
            #{peticion.tarea.numero} {peticion.tarea.titulo}
          </h3>
        </div>
        <p className="modal-texto">{peticion.pregunta}</p>
        <input autoFocus value={texto} maxLength={500} onChange={(e) => setTexto(e.target.value)} placeholder="Motivo (queda en el historial)" aria-label="Motivo" style={{ maxWidth: 'none' }} />
        <div className="cfg-acciones">
          <button className="primario" type="submit" disabled={!texto.trim()}>
            Cambiar estado
          </button>
          <button type="button" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

