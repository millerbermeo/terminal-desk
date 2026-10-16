import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CambioArchivo, EntradaArchivo, MarcaGit } from '@shared/archivos'
import { ArbolArchivos, type CreandoEn } from './ArbolArchivos'
import { EditorCodigo, type ManejoEditor } from './EditorCodigo'
import { lenguajeDe } from './lenguajes'

interface Abierto {
  ruta: string
  original: string // lo que hay en disco (según lo último que se leyó o guardó)
  mtimeMs: number
  sucio: boolean
  estado: 'ok' | 'guardando' | 'error' | 'conflicto'
  mensaje?: string
  /** El archivo cambió o desapareció en disco mientras había cambios sin guardar. */
  externo?: { tipo: 'cambiado' | 'borrado'; mtimeMs?: number }
  noEditable?: string // motivo por el que no se puede mostrar
}

interface Props {
  proyectoId: string
  nombre: string
  visible: boolean
}

const MOTIVOS: Record<string, string> = {
  binario: 'Es un archivo binario: no se puede mostrar como texto.',
  'demasiado-grande': 'Es demasiado grande para el editor (más de 1 MB).',
  'no-utf8': 'No está codificado en UTF-8: abrirlo aquí podría estropearlo.',
  'no-existe': 'El archivo ya no existe.',
  'no-es-archivo': 'No es un archivo.'
}
const limpiar = (m: string): string => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const carpetaDe = (ruta: string): string => ruta.split('/').slice(0, -1).join('/')
const base = (ruta: string): string => ruta.split('/').pop() ?? ruta
const unir = (padre: string, nombre: string): string => (padre ? `${padre}/${nombre}` : nombre)
const clave = (id: string): string => `editor:estado:${id}`

/** Mini editor de código de la celda: árbol del proyecto, pestañas de archivos y guardado automático. */
export function PanelArchivos({ proyectoId, nombre, visible }: Props) {
  const api = window.api.archivos
  const editor = useRef<ManejoEditor>(null)
  const [hijos, setHijos] = useState<Record<string, EntradaArchivo[]>>({})
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set(['']))
  const [marcas, setMarcas] = useState<Record<string, MarcaGit>>({})
  const [abiertos, setAbiertos] = useState<Abierto[]>([])
  const [activa, setActiva] = useState<string | null>(null)
  const [creando, setCreando] = useState<CreandoEn | null>(null)
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entrada: EntradaArchivo | null } | null>(null)
  const [errorArbol, setErrorArbol] = useState('')
  const [arbolVisible, setArbolVisible] = useState(false) // en paneles estrechos el árbol es un cajón
  const [cursor, setCursor] = useState({ l: 1, c: 1 })
  const [auto, setAuto] = useState<boolean>(() => {
    try {
      return localStorage.getItem('editor:autoguardado') !== '0'
    } catch {
      return true
    }
  })

  // Referencias con el último valor: los avisos del disco y los temporizadores llegan fuera del ciclo de render.
  const refAbiertos = useRef<Abierto[]>([])
  const refExpandidas = useRef(expandidas)
  refExpandidas.current = expandidas
  const refAuto = useRef(auto)
  refAuto.current = auto
  const temporizadores = useRef(new Map<string, number>())
  const colas = useRef(new Map<string, Promise<void>>())
  const temporizadorGit = useRef<number | undefined>(undefined)

  const poner = useCallback((f: (a: Abierto[]) => Abierto[]): void => {
    refAbiertos.current = f(refAbiertos.current)
    setAbiertos(refAbiertos.current)
  }, [])
  const parche = useCallback((ruta: string, p: Partial<Abierto>): void => poner((as) => as.map((a) => (a.ruta === ruta ? { ...a, ...p } : a))), [poner])
  const buscar = (ruta: string): Abierto | undefined => refAbiertos.current.find((a) => a.ruta === ruta)

  // ---- árbol ----
  const cargar = useCallback(
    async (ruta: string): Promise<void> => {
      try {
        const lista = await api.listar(proyectoId, ruta)
        setHijos((h) => ({ ...h, [ruta]: lista }))
        if (ruta === '') setErrorArbol('')
      } catch (e) {
        if (ruta === '') setErrorArbol(limpiar((e as Error).message))
      }
    },
    [api, proyectoId]
  )
  const refrescarGit = useCallback((): void => {
    window.clearTimeout(temporizadorGit.current)
    temporizadorGit.current = window.setTimeout(() => void api.estadoGit(proyectoId).then(setMarcas).catch(() => setMarcas({})), 600)
  }, [api, proyectoId])
  const refrescarTodo = useCallback((): void => {
    for (const r of refExpandidas.current) void cargar(r)
    refrescarGit()
  }, [cargar, refrescarGit])

  const alternar = (ruta: string): void => {
    setExpandidas((s) => {
      const n = new Set(s)
      if (n.delete(ruta)) return n
      n.add(ruta)
      void cargar(ruta)
      return n
    })
  }

  // ---- guardado ----
  const guardar = useCallback(
    (ruta: string): Promise<void> => {
      const previa = colas.current.get(ruta) ?? Promise.resolve()
      const siguiente = previa.then(async () => {
        const a = refAbiertos.current.find((x) => x.ruta === ruta)
        if (!a || a.noEditable || a.externo?.tipo === 'cambiado') return // con un conflicto sin resolver no se escribe
        const texto = editor.current?.texto(ruta)
        if (texto === undefined || (texto === a.original && !a.sucio)) return
        parche(ruta, { estado: 'guardando' })
        try {
          const r = await api.guardar(proyectoId, ruta, texto, a.externo?.tipo === 'borrado' ? undefined : a.mtimeMs)
          if (r.ok) {
            const ahora = editor.current?.texto(ruta)
            parche(ruta, { original: texto, mtimeMs: r.mtimeMs, sucio: ahora !== texto, estado: 'ok', externo: undefined })
            if (ahora !== texto && refAuto.current) programar(ruta) // se siguió escribiendo mientras se guardaba
            refrescarGit()
          } else if (r.motivo === 'conflicto') {
            parche(ruta, { estado: 'conflicto', externo: { tipo: 'cambiado', ...(r.mtimeMs !== undefined ? { mtimeMs: r.mtimeMs } : {}) } })
          } else {
            parche(ruta, { estado: 'error', mensaje: r.mensaje ?? (r.motivo === 'demasiado-grande' ? 'Demasiado grande para guardar (más de 5 MB)' : 'No se pudo guardar') })
          }
        } catch (e) {
          parche(ruta, { estado: 'error', mensaje: limpiar((e as Error).message) })
        }
      })
      colas.current.set(ruta, siguiente.catch(() => undefined))
      return siguiente
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, proyectoId, parche, refrescarGit]
  )
  const programar = useCallback(
    (ruta: string): void => {
      window.clearTimeout(temporizadores.current.get(ruta))
      temporizadores.current.set(ruta, window.setTimeout(() => void guardar(ruta), 1000))
    },
    [guardar]
  )
  const guardarYa = useCallback(
    (ruta: string): Promise<void> => {
      window.clearTimeout(temporizadores.current.get(ruta))
      return guardar(ruta)
    },
    [guardar]
  )
  const guardarPendientes = useCallback((): void => {
    for (const a of refAbiertos.current) if (a.sucio) void guardarYa(a.ruta)
  }, [guardarYa])

  const alEditar = useCallback(
    (ruta: string): void => {
      const a = buscar(ruta)
      if (a && !a.sucio) parche(ruta, { sucio: true, estado: 'ok', mensaje: '' })
      if (refAuto.current) programar(ruta)
    },
    [parche, programar]
  )

  // ---- abrir y cerrar ----
  const abrir = useCallback(
    async (ruta: string, activar = true): Promise<void> => {
      if (buscar(ruta)) {
        if (activar) setActiva(ruta)
        return
      }
      try {
        const r = await api.leer(proyectoId, ruta)
        poner((as) =>
          as.some((a) => a.ruta === ruta)
            ? as
            : [...as, r.ok ? { ruta, original: r.contenido, mtimeMs: r.mtimeMs, sucio: false, estado: 'ok' } : { ruta, original: '', mtimeMs: 0, sucio: false, estado: 'ok', noEditable: MOTIVOS[r.motivo] ?? 'No se puede abrir.' }]
        )
        if (activar) setActiva(ruta)
      } catch (e) {
        setErrorArbol(limpiar((e as Error).message))
      }
    },
    [api, proyectoId, poner]
  )

  const cerrar = useCallback(
    async (ruta: string): Promise<void> => {
      const a = buscar(ruta)
      if (a?.sucio) {
        if (refAuto.current) await guardarYa(ruta)
        if (buscar(ruta)?.sucio && !window.confirm(`«${base(ruta)}» tiene cambios sin guardar. ¿Descartarlos?`)) return
      }
      window.clearTimeout(temporizadores.current.get(ruta))
      editor.current?.olvidar(ruta)
      poner((as) => as.filter((x) => x.ruta !== ruta))
      setActiva((act) => {
        if (act !== ruta) return act
        const resto = refAbiertos.current
        return resto[resto.length - 1]?.ruta ?? null
      })
    },
    [guardarYa, poner]
  )

  // ---- cambios en disco (el agente u otro programa) ----
  const alCambioDisco = useCallback(
    async (c: CambioArchivo): Promise<void> => {
      if (c.proyectoId !== proyectoId) return
      if (refExpandidas.current.has(c.carpeta)) void cargar(c.carpeta)
      refrescarGit()
      if (!c.nombre) return
      const ruta = unir(c.carpeta, c.nombre)
      const a = buscar(ruta)
      if (!a || a.noEditable) return
      const r = await api.leer(proyectoId, ruta).catch(() => undefined)
      if (!r) return
      if (!r.ok) {
        if (r.motivo !== 'no-existe') return
        if (a.sucio) parche(ruta, { externo: { tipo: 'borrado' } })
        else void cerrar(ruta)
        return
      }
      if (r.mtimeMs === a.mtimeMs || r.contenido === editor.current?.texto(ruta)) {
        if (r.mtimeMs !== a.mtimeMs) parche(ruta, { mtimeMs: r.mtimeMs, original: r.contenido })
        return // es nuestro propio guardado (o el contenido ya coincide)
      }
      if (!a.sucio) {
        editor.current?.reemplazar(ruta, r.contenido) // sin cambios propios: se actualiza solo (p. ej. lo que acaba de escribir el agente)
        parche(ruta, { original: r.contenido, mtimeMs: r.mtimeMs, estado: 'ok', externo: undefined })
      } else parche(ruta, { externo: { tipo: 'cambiado', mtimeMs: r.mtimeMs }, estado: 'conflicto' })
    },
    [api, proyectoId, cargar, refrescarGit, parche, cerrar]
  )
  useEffect(() => api.onCambio((c) => void alCambioDisco(c)), [api, alCambioDisco])

  const resolver = async (ruta: string, como: 'recargar' | 'conservar' | 'cerrar'): Promise<void> => {
    const a = buscar(ruta)
    if (!a) return
    if (como === 'cerrar') {
      parche(ruta, { sucio: false })
      return void cerrar(ruta)
    }
    if (como === 'conservar') {
      parche(ruta, { mtimeMs: a.externo?.mtimeMs ?? a.mtimeMs, externo: a.externo?.tipo === 'borrado' ? { tipo: 'borrado' } : undefined, estado: 'ok' })
      return void guardarYa(ruta)
    }
    const r = await api.leer(proyectoId, ruta)
    if (r.ok) {
      editor.current?.reemplazar(ruta, r.contenido)
      parche(ruta, { original: r.contenido, mtimeMs: r.mtimeMs, sucio: false, estado: 'ok', externo: undefined })
    }
  }

  // ---- vigilancia: carpetas desplegadas y carpetas de los archivos abiertos ----
  const carpetasVigiladas = useMemo(() => [...new Set([...expandidas, ...abiertos.map((a) => carpetaDe(a.ruta))])], [expandidas, abiertos])
  useEffect(() => {
    void api.vigilar(proyectoId, carpetasVigiladas).catch(() => undefined)
  }, [api, proyectoId, carpetasVigiladas])
  useEffect(() => () => void api.vigilar(proyectoId, []).catch(() => undefined), [api, proyectoId])

  // ---- arranque: recuerda lo desplegado y lo abierto en este proyecto ----
  useEffect(() => {
    let guardado: { abiertos?: string[]; activa?: string | null; expandidas?: string[] } = {}
    try {
      guardado = JSON.parse(localStorage.getItem(clave(proyectoId)) ?? '{}')
    } catch {
      /* sin estado previo */
    }
    const desplegar = new Set(['', ...(guardado.expandidas ?? [])])
    setExpandidas(desplegar)
    for (const r of desplegar) void cargar(r)
    refrescarGit()
    void (async () => {
      for (const r of guardado.abiertos ?? []) await abrir(r, false)
      setActiva(guardado.activa && refAbiertos.current.some((a) => a.ruta === guardado.activa) ? guardado.activa : (refAbiertos.current[0]?.ruta ?? null))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId])
  useEffect(() => {
    try {
      localStorage.setItem(clave(proyectoId), JSON.stringify({ abiertos: abiertos.map((a) => a.ruta), activa, expandidas: [...expandidas].filter(Boolean) }))
    } catch {
      /* sin almacenamiento */
    }
  }, [proyectoId, abiertos, activa, expandidas])

  // Guardar al cambiar de archivo, al perder el foco, al ocultar la pestaña y al cerrar.
  const anterior = useRef<string | null>(null)
  useEffect(() => {
    if (anterior.current && anterior.current !== activa && buscar(anterior.current)?.sucio) void guardarYa(anterior.current)
    anterior.current = activa
  }, [activa, guardarYa])
  useEffect(() => {
    if (!visible) guardarPendientes()
  }, [visible, guardarPendientes])
  useEffect(() => {
    window.addEventListener('blur', guardarPendientes)
    window.addEventListener('beforeunload', guardarPendientes)
    return () => {
      window.removeEventListener('blur', guardarPendientes)
      window.removeEventListener('beforeunload', guardarPendientes)
      guardarPendientes() // la celda se cierra: lo último que se escribió no se pierde
      for (const t of temporizadores.current.values()) window.clearTimeout(t)
    }
  }, [guardarPendientes])

  const cambiarAuto = (v: boolean): void => {
    setAuto(v)
    refAuto.current = v
    try {
      localStorage.setItem('editor:autoguardado', v ? '1' : '0')
    } catch {
      /* sin almacenamiento */
    }
    if (v) for (const a of refAbiertos.current) if (a.sucio) programar(a.ruta)
  }

  // ---- crear, renombrar, borrar ----
  const iniciarNuevo = (padre: string, tipo: 'archivo' | 'carpeta'): void => {
    setMenu(null)
    setRenombrando(null)
    if (padre && !expandidas.has(padre)) alternar(padre)
    setCreando({ padre, tipo })
    setArbolVisible(true)
  }
  const confirmarNombre = async (texto: string): Promise<void> => {
    const accion = creando
    const viejo = renombrando
    setCreando(null)
    setRenombrando(null)
    if (!texto || /[\\]|(^|\/)\.\.(\/|$)/.test(texto)) return setErrorArbol('Nombre no válido')
    try {
      if (accion) {
        const ruta = unir(accion.padre, texto)
        await api.crear(proyectoId, ruta, accion.tipo)
        await cargar(accion.padre)
        if (accion.padre) setExpandidas((x) => new Set(x).add(accion.padre)) // se ve lo recién creado
        if (accion.tipo === 'carpeta') setExpandidas((s) => new Set(s).add(ruta))
        else await abrir(ruta)
      } else if (viejo) {
        const nuevo = unir(carpetaDe(viejo), texto)
        if (nuevo === viejo) return
        for (const a of refAbiertos.current.filter((x) => x.sucio && (x.ruta === viejo || x.ruta.startsWith(`${viejo}/`)))) await guardarYa(a.ruta)
        await api.renombrar(proyectoId, viejo, nuevo)
        const afectados = refAbiertos.current.filter((a) => a.ruta === viejo || a.ruta.startsWith(`${viejo}/`)).map((a) => a.ruta)
        for (const r of afectados) {
          editor.current?.olvidar(r)
          poner((as) => as.filter((x) => x.ruta !== r))
        }
        await cargar(carpetaDe(viejo))
        for (const r of afectados) await abrir(nuevo + r.slice(viejo.length), r === activa)
      }
      setErrorArbol('')
      refrescarGit()
    } catch (e) {
      setErrorArbol(limpiar((e as Error).message))
    }
  }
  const borrar = async (e: EntradaArchivo): Promise<void> => {
    setMenu(null)
    if (!window.confirm(`¿Mover «${e.nombre}» a la papelera?${e.tipo === 'carpeta' ? ' Se moverá todo su contenido.' : ''}`)) return
    try {
      await api.borrar(proyectoId, e.ruta)
      for (const a of refAbiertos.current.filter((x) => x.ruta === e.ruta || x.ruta.startsWith(`${e.ruta}/`))) {
        parche(a.ruta, { sucio: false })
        await cerrar(a.ruta)
      }
      await cargar(carpetaDe(e.ruta))
      refrescarGit()
    } catch (err) {
      setErrorArbol(limpiar((err as Error).message))
    }
  }

  useEffect(() => {
    if (!menu) return
    const cerrarMenu = (): void => setMenu(null)
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cerrarMenu()
    }
    window.addEventListener('mousedown', cerrarMenu)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('mousedown', cerrarMenu)
      window.removeEventListener('keydown', tecla)
    }
  }, [menu])

  const conCambios = useMemo(() => {
    const s = new Set<string>()
    for (const r of Object.keys(marcas)) for (let i = r.indexOf('/'); i !== -1; i = r.indexOf('/', i + 1)) s.add(r.slice(0, i))
    return s
  }, [marcas])

  const actual = abiertos.find((a) => a.ruta === activa)
  const estado = !actual || actual.noEditable ? '' : actual.estado === 'guardando' ? 'Guardando…' : actual.estado === 'error' ? `Error: ${actual.mensaje}` : actual.estado === 'conflicto' ? 'Conflicto con el disco' : actual.sucio ? (auto ? 'Sin guardar…' : 'Sin guardar') : 'Guardado'

  return (
    <div className="ed">
      <aside className={`ed-arbol${arbolVisible ? ' abierto' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="ed-arbol-cab">
          <strong title={nombre}>{nombre}</strong>
          <span className="ag-espacio" />
          <button className="icono" title="Nuevo archivo" aria-label="Nuevo archivo" onClick={() => iniciarNuevo('', 'archivo')}>＋📄</button>
          <button className="icono" title="Nueva carpeta" aria-label="Nueva carpeta" onClick={() => iniciarNuevo('', 'carpeta')}>＋📁</button>
          <button className="icono" title="Actualizar" aria-label="Actualizar" onClick={refrescarTodo}>↻</button>
          <button className="icono" title="Plegar todo" aria-label="Plegar todo" onClick={() => setExpandidas(new Set(['']))}>⊟</button>
        </div>
        <div className="ed-arbol-cuerpo">
          <ArbolArchivos
            hijos={hijos}
            expandidas={expandidas}
            marcas={marcas}
            conCambios={conCambios}
            activa={activa}
            creando={creando}
            renombrando={renombrando}
            error={errorArbol}
            onAlternar={alternar}
            onAbrir={(r) => {
              void abrir(r)
              setArbolVisible(false)
            }}
            onMenu={(x, y, entrada) => setMenu({ x, y, entrada })}
            onNombre={(t) => void confirmarNombre(t)}
            onCancelarNombre={() => {
              setCreando(null)
              setRenombrando(null)
            }}
          />
        </div>
      </aside>

      <section className="ed-principal">
        <div className="ed-pestanas" role="tablist">
          <button className="icono ed-cajon" title="Mostrar u ocultar el árbol de archivos" aria-label="Árbol de archivos" aria-expanded={arbolVisible} onClick={() => setArbolVisible((v) => !v)}>
            ☰
          </button>
          {abiertos.map((a) => (
            <div
              key={a.ruta}
              role="tab"
              aria-selected={a.ruta === activa}
              className={`ed-pestana${a.ruta === activa ? ' activa' : ''}`}
              title={a.ruta}
              onClick={() => setActiva(a.ruta)}
              onAuxClick={(e) => {
                if (e.button === 1) void cerrar(a.ruta)
              }}
            >
              <span className="ed-pestana-nombre">{base(a.ruta)}</span>
              {a.externo || a.estado === 'conflicto' ? <span className="ed-sucio aviso" title="Cambió en disco">⚠</span> : a.sucio ? <span className="ed-sucio" title="Sin guardar">●</span> : null}
              <button className="icono" aria-label={`Cerrar ${base(a.ruta)}`} onClick={(e) => (e.stopPropagation(), void cerrar(a.ruta))}>✕</button>
            </div>
          ))}
        </div>

        {actual?.externo && (
          <div className="ed-aviso" role="alert">
            {actual.externo.tipo === 'cambiado' ? 'Este archivo cambió en disco (¿el agente u otro programa?) y tienes cambios sin guardar.' : 'Este archivo se eliminó del disco y tienes cambios sin guardar.'}
            {actual.externo.tipo === 'cambiado' && <button onClick={() => void resolver(actual.ruta, 'recargar')}>Cargar el del disco</button>}
            <button onClick={() => void resolver(actual.ruta, 'conservar')}>{actual.externo.tipo === 'cambiado' ? 'Conservar los míos' : 'Guardar de nuevo'}</button>
            {actual.externo.tipo === 'borrado' && <button onClick={() => void resolver(actual.ruta, 'cerrar')}>Descartar</button>}
          </div>
        )}

        <div className="ed-cuerpo">
          {!actual && (
            <div className="vacio">
              <strong>Editor de {nombre}</strong>
              <span>Elige un archivo del árbol. Los cambios se guardan solos. Clic derecho en el árbol para crear, renombrar o borrar.</span>
            </div>
          )}
          {actual?.noEditable && (
            <div className="vacio">
              <strong>{base(actual.ruta)}</strong>
              <span>{actual.noEditable}</span>
            </div>
          )}
          <EditorCodigo
            ref={editor}
            ruta={actual && !actual.noEditable ? actual.ruta : null}
            inicial={actual?.original ?? ''}
            onCambio={alEditar}
            onGuardar={(r) => void guardarYa(r)}
            onCursor={(l, c) => setCursor({ l, c })}
          />
        </div>

        <div className="ed-estado">
          <span className={`ed-estado-texto ${actual?.estado ?? ''}`}>{estado}</span>
          <span className="ag-espacio" />
          {actual && !actual.noEditable && (
            <>
              <span className="ed-pos">Ln {cursor.l}, Col {cursor.c}</span>
              <span className="largo">{lenguajeDe(actual.ruta).nombre} · UTF-8</span>
            </>
          )}
          <label className="ag-check" title="Guarda un segundo después de dejar de escribir (un servidor con recarga en caliente se reiniciará con cada guardado)">
            <input type="checkbox" checked={auto} onChange={(e) => cambiarAuto(e.target.checked)} /> Guardado automático
          </label>
          {actual && !actual.noEditable && !auto && actual.sucio && <button onClick={() => void guardarYa(actual.ruta)}>Guardar</button>}
        </div>
      </section>

      {menu && (
        <div className="menu-ia ed-menu" style={{ top: menu.y, left: menu.x }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
          {(() => {
            const padre = menu.entrada ? (menu.entrada.tipo === 'carpeta' ? menu.entrada.ruta : carpetaDe(menu.entrada.ruta)) : ''
            return (
              <>
                <button role="menuitem" onClick={() => iniciarNuevo(padre, 'archivo')}>Nuevo archivo</button>
                <button role="menuitem" onClick={() => iniciarNuevo(padre, 'carpeta')}>Nueva carpeta</button>
                {menu.entrada && (
                  <>
                    <button role="menuitem" onClick={() => (setMenu(null), setCreando(null), setRenombrando(menu.entrada!.ruta))}>Renombrar</button>
                    <button role="menuitem" onClick={() => (void navigator.clipboard?.writeText(menu.entrada!.ruta).catch(() => undefined), setMenu(null))}>Copiar ruta relativa</button>
                    <button role="menuitem" className="peligro" onClick={() => void borrar(menu.entrada!)}>Mover a la papelera</button>
                  </>
                )}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
