import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { EstadoVacio } from './EstadoVacio'
import { IconoCarpeta, IconoCerrar, IconoChispa, IconoTerminal } from './Iconos'
import { LimiteErrores } from './LimiteErrores'
import { extrasDe, MAX_PESTANAS, puedeDuplicar, TIPOS, tipoActivo, tituloPestana, type OperacionPestana, type TipoCelda } from '../duplicar'
import { ChatAgente } from './ChatAgente'
import { TerminalPanel } from './TerminalPanel'
import { useAgente } from '../agente/useAgente'
import type { TerminalInfo } from '../App'

const PanelArchivos = lazy(() => import('../editor/PanelArchivos').then((m) => ({ default: m.PanelArchivos })))
import {
  calcular,
  conRazon,
  hojaEn,
  intercambiar,
  limitarRazon,
  minimo,
  normalizar,
  reconciliar,
  type DivisorGeo,
  type Medidas,
  type Nodo
} from '../arbol'
import { cargarLayout, guardarLayout, olvidarLayout } from '../layoutGuardado'

export type Modo = 'rejilla' | 'pestanas'

interface Props {
  terminales: TerminalInfo[]
  activa: string | null
  modo: Modo
  reiniciarLayout: number // cambia para volver a la cuadrícula automática
  /** Clave de la pestaña: con ella se guarda la distribución y se recupera al reabrir el grupo. */
  claveLayout?: string
  onPersonalizado: (v: boolean) => void
  onActivar: (id: string) => void
  onCerrar: (id: string) => void
  onPty?: (terminalId: string, ptyId: string) => void
  /** Cambia lo que muestra una celda (terminal o asistente). */
  onVista?: (terminalId: string, vista: 'terminal' | 'asistente' | 'archivos') => void
  /** Duplicar / cerrar / elegir las pestañas extra de una celda (hasta 3 duplicadas por tipo, `duplicar.ts`). */
  onPestanas?: (terminalId: string, op: OperacionPestana) => void
}

const MIN_ANCHO = 260 // px
const MIN_ALTO = 150 // px
const MARGEN = 4 // px a cada lado de un panel (8 px entre paneles)
const ASA = 10 // grosor (px) de la zona de agarre de un divisor

interface Arrastre {
  tipo: 'divisor' | 'mover'
  arbol0: Nodo // árbol al empezar: cada movimiento se calcula desde aquí
  // divisor
  divisor?: DivisorGeo
  // mover
  id?: string
  caja: { left: number; top: number; width: number; height: number }
}

/** Asistente de una celda: conversación propia (estado por celda) con el proyecto fijado. */
function AsistenteCelda({ proyecto, clave }: { proyecto: { id: string; nombre: string }; clave: string }) {
  const agente = useAgente({ clave }) // la primera celda del proyecto recuerda su conversación; cada copia empieza la suya
  return <ChatAgente agente={agente} proyectoFijo={proyecto} />
}

export function TerminalGrid({ terminales, activa, modo, reiniciarLayout, claveLayout, onPersonalizado, onActivar, onCerrar, onPty, onVista, onPestanas }: Props) {
  // El asistente y el editor de una celda se montan la primera vez que se muestran y ya no se desmontan (conservan la conversación
  // y los archivos abiertos con su historial de deshacer).
  const [montados, setMontados] = useState<Set<string>>(new Set())
  useEffect(() => {
    const nuevos = terminales
      .filter((t) => t.vista === 'asistente' || t.vista === 'archivos')
      .map((t) => `${t.id}:${t.extraActiva ?? t.vista}`)
      .filter((k) => !montados.has(k))
    if (nuevos.length) setMontados((s) => new Set([...s, ...nuevos]))
  }, [terminales, montados])

  const ids = terminales.map((t) => t.id)
  const contenedor = useRef<HTMLDivElement>(null)
  const [estado, setEstado] = useState<{ arbol: Nodo | null; personalizado: boolean }>(() => {
    const guardado = claveLayout ? cargarLayout(claveLayout, terminales) : null
    return { arbol: guardado, personalizado: guardado !== null }
  })
  const arrastre = useRef<Arrastre | null>(null)
  const [arrastrando, setArrastrando] = useState<'divisor' | 'mover' | null>(null)
  const [moviendo, setMoviendo] = useState<string | null>(null)

  // Tamaño real del lienzo (se vuelve a calcular el layout al cambiar la ventana); oculto (otra pestaña) mide 0: medidas por defecto.
  const [tam, setTam] = useState({ ancho: 0, alto: 0 })
  useEffect(() => {
    const el = contenedor.current
    if (!el) return
    let raf = 0
    const medir = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setTam((p) => (Math.abs(p.ancho - el.clientWidth) < 1 && Math.abs(p.alto - el.clientHeight) < 1 ? p : { ancho: el.clientWidth, alto: el.clientHeight })))
    }
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    medir()
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])
  const medidas = (): Medidas => ({ ancho: tam.ancho || 1000, alto: tam.alto || 700, minAncho: MIN_ANCHO, minAlto: MIN_ALTO })

  // Layout efectivo: se calcula en el render (sin parpadeo) y se guarda en el efecto.
  const efectivo = reconciliar(estado.arbol, ids, estado.personalizado, medidas())
  const clave = ids.join('|')
  useEffect(() => {
    setEstado(efectivo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  useEffect(() => {
    if (reiniciarLayout > 0) setEstado({ arbol: null, personalizado: false })
  }, [reiniciarLayout])

  useEffect(() => onPersonalizado(efectivo.personalizado), [efectivo.personalizado, onPersonalizado])

  // la distribución a mano se recuerda por pestaña; «Reorganizar» la olvida
  useEffect(() => {
    if (!claveLayout) return
    if (efectivo.personalizado && efectivo.arbol) guardarLayout(claveLayout, efectivo.arbol, terminales)
    else if (!efectivo.personalizado && reiniciarLayout > 0) olvidarLayout(claveLayout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [efectivo.arbol, efectivo.personalizado])

  // lo que se dibuja respeta los mínimos aunque el árbol guardado no (ventana pequeña, subárbol comprimido)
  const med = medidas()
  const vista = efectivo.arbol && normalizar(efectivo.arbol, med.ancho, med.alto, med)
  const { hojas: rects, divisores } = calcular(vista)

  const empezar = (e: PointerEvent<HTMLElement>, a: Omit<Arrastre, 'arbol0' | 'caja'>): void => {
    const caja = contenedor.current?.getBoundingClientRect()
    if (!caja || !efectivo.arbol) return
    arrastre.current = { ...a, arbol0: normalizar(efectivo.arbol, caja.width, caja.height, medidas()), caja: { left: caja.left, top: caja.top, width: caja.width, height: caja.height } }
    setArrastrando(a.tipo)
    if (a.id) {
      setMoviendo(a.id)
      onActivar(a.id)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const arrastrar = (e: PointerEvent<HTMLElement>): void => {
    const a = arrastre.current
    if (!a) return
    const { caja } = a
    if (a.tipo === 'divisor' && a.divisor) {
      const d = a.divisor
      const horizontal = d.dir === 'h'
      const tam = (horizontal ? d.nodo.w * caja.width : d.nodo.h * caja.height) || 1
      const origen = horizontal ? caja.left + d.nodo.x * caja.width : caja.top + d.nodo.y * caja.height
      const deseada = ((horizontal ? e.clientX : e.clientY) - origen) / tam
      const razon = limitarRazon(a.arbol0, d.id, deseada, tam, { ancho: caja.width, alto: caja.height, minAncho: MIN_ANCHO, minAlto: MIN_ALTO })
      setEstado({ arbol: conRazon(a.arbol0, d.id, razon), personalizado: true })
    } else if (a.id) {
      // mover = intercambiar con la terminal que haya bajo el puntero
      const base = calcular(a.arbol0).hojas
      const destino = hojaEn(base, (e.clientX - caja.left) / caja.width, (e.clientY - caja.top) / caja.height)
      const arbol = destino && destino !== a.id ? intercambiar(a.arbol0, a.id, destino) : a.arbol0
      setEstado({ arbol, personalizado: true })
    }
  }

  const terminar = (): void => {
    arrastre.current = null
    setArrastrando(null)
    setMoviendo(null)
  }

  const rejilla = modo === 'rejilla'
  // Si las celdas no caben ni en su tamaño mínimo, en vez de apretarlas hasta romperlas se pasa a un carrusel: una celda a la vista y un
  // deslizador (o las flechas, o arrastrar/rueda en horizontal) para ver las demás.
  const carrusel = rejilla && terminales.length > 1 && tam.ancho > 0 && !!efectivo.arbol && (minimo(efectivo.arbol, 'x', med) > tam.ancho + 1 || minimo(efectivo.arbol, 'y', med) > tam.alto + 1)
  const [indice, setIndice] = useState(0)
  const temporizadorScroll = useRef(0)
  const irA = useCallback(
    (i: number, suave = true): void => {
      const n = terminales.length
      const destino = terminales[Math.min(Math.max(i, 0), n - 1)]
      if (!destino) return
      const el = contenedor.current?.querySelector<HTMLElement>(`[data-celda="${destino.id}"]`)
      el?.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', inline: 'start', block: 'nearest' })
      setIndice(Math.min(Math.max(i, 0), n - 1))
    },
    [terminales]
  )
  // al deslizar a mano, la celda que queda a la vista pasa a ser la activa (el foco va con ella)
  const alDeslizar = (): void => {
    window.clearTimeout(temporizadorScroll.current)
    temporizadorScroll.current = window.setTimeout(() => {
      const caja = contenedor.current
      if (!caja) return
      let mejor = 0
      let dist = Infinity
      terminales.forEach((t, i) => {
        const el = caja.querySelector<HTMLElement>(`[data-celda="${t.id}"]`)
        if (!el) return
        const d = Math.abs(el.offsetLeft - caja.scrollLeft)
        if (d < dist) {
          dist = d
          mejor = i
        }
      })
      setIndice(mejor)
      const t = terminales[mejor]
      if (t && t.id !== activa) onActivar(t.id)
    }, 120)
  }
  // la celda activa (clic en el proyecto, nueva celda…) se muestra; al entrar en modo carrusel también
  useEffect(() => {
    if (!carrusel || !activa) return
    const i = terminales.findIndex((t) => t.id === activa)
    if (i >= 0) irA(i, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrusel, activa])

  // menú «Duplicar» de una celda: añade una pestaña de terminal, asistente o archivos
  const [menuDup, setMenuDup] = useState<{ id: string; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menuDup) return
    const cerrar = (): void => setMenuDup(null)
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('mousedown', cerrar)
    window.addEventListener('keydown', tecla)
    window.addEventListener('blur', cerrar)
    window.addEventListener('resize', cerrar)
    return () => {
      window.removeEventListener('mousedown', cerrar)
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('blur', cerrar)
      window.removeEventListener('resize', cerrar)
    }
  }, [menuDup])
  const origenDup = menuDup ? terminales.find((t) => t.id === menuDup.id) : undefined

  const estiloPanel = (id: string): CSSProperties => {
    const r = rects[id]
    if (!rejilla || carrusel || !r) return {}
    return {
      left: `calc(${r.x * 100}% + ${MARGEN}px)`,
      top: `calc(${r.y * 100}% + ${MARGEN}px)`,
      width: `calc(${r.w * 100}% - ${2 * MARGEN}px)`,
      height: `calc(${r.h * 100}% - ${2 * MARGEN}px)`
    }
  }

  const estiloDivisor = (d: DivisorGeo): CSSProperties =>
    d.dir === 'h'
      ? { left: `calc(${(d.nodo.x + d.nodo.w * d.razon) * 100}% - ${ASA / 2}px)`, width: ASA, top: `${d.nodo.y * 100}%`, height: `${d.nodo.h * 100}%` }
      : { top: `calc(${(d.nodo.y + d.nodo.h * d.razon) * 100}% - ${ASA / 2}px)`, height: ASA, left: `${d.nodo.x * 100}%`, width: `${d.nodo.w * 100}%` }

  return (
    <div className="area">
      {modo === 'pestanas' && (
        <div className="pestanas">
          {terminales.map((t) => (
            <div key={t.id} className={`pestana${t.id === activa ? ' activa' : ''}`} onClick={() => onActivar(t.id)}>
              <IconoTerminal />
              <span>{t.titulo}</span>
              <button
                className="cerrar"
                title="Cerrar"
                onClick={(e) => {
                  e.stopPropagation()
                  onCerrar(t.id)
                }}
              >
                <IconoCerrar />
              </button>
            </div>
          ))}
        </div>
      )}
      <div ref={contenedor} className={`paneles ${modo}${carrusel ? ' carrusel' : ''}${arrastrando ? ` arrastrando arrastrando-${arrastrando}` : ''}`} onScroll={carrusel ? alDeslizar : undefined}>
        {terminales.length === 0 && (
          <EstadoVacio icono={<IconoTerminal />} titulo="Sin terminales abiertas" texto="Elige un proyecto en la barra lateral o crea una terminal nueva." />
        )}
        {terminales.map((t) => {
          const visible = rejilla || t.id === activa
          return (
            <div
              key={t.id}
              data-celda={t.id}
              className={`panel${t.id === activa ? ' activa' : ''}${moviendo === t.id ? ' en-mano' : ''}`}
              style={{ display: visible ? 'flex' : 'none', ...estiloPanel(t.id) }}
            >
              {rejilla && (
                <div
                  className="panel-barra"
                  title={carrusel ? t.titulo : 'Arrastra sobre otra terminal para intercambiarlas'}
                  onPointerDown={(e) => !carrusel && empezar(e, { tipo: 'mover', id: t.id })}
                  onPointerMove={arrastrar}
                  onPointerUp={terminar}
                  onPointerCancel={terminar}
                >
                  <span className="panel-titulo">
                    <IconoTerminal /> {t.titulo}
                  </span>
                  <button className="cerrar" title="Cerrar" onPointerDown={(e) => e.stopPropagation()} onClick={() => onCerrar(t.id)}>
                    <IconoCerrar />
                  </button>
                </div>
              )}
              {t.proyectoId && onVista && (
                <div className="panel-vista" role="tablist" aria-label="Pestañas de la celda">
                  {TIPOS.map((tipo) => {
                    const baseActiva = tipoActivo(t) === tipo && !t.extraActiva
                    const nombre = tituloPestana(tipo, 1)
                    const icono = tipo === 'terminal' ? <IconoTerminal /> : tipo === 'asistente' ? <IconoChispa /> : <IconoCarpeta />
                    const ayuda =
                      tipo === 'terminal'
                        ? 'Terminal del proyecto'
                        : tipo === 'asistente'
                          ? 'Asistente integrado: conversa con el agente en este proyecto (la terminal sigue viva)'
                          : 'Archivos del proyecto: árbol y editor con guardado automático (la terminal sigue viva)'
                    return (
                      <Fragment key={tipo}>
                        <button role="tab" aria-selected={baseActiva} className={baseActiva ? 'on' : ''} onClick={() => onVista(t.id, tipo)} title={ayuda}>
                          {icono} {nombre}
                        </button>
                        {extrasDe(t.extras, tipo).map((x) => (
                          <span key={x.id} className={`pestana-extra${t.extraActiva === x.id ? ' on' : ''}`}>
                            <button role="tab" aria-selected={t.extraActiva === x.id} className={t.extraActiva === x.id ? 'on' : ''} onClick={() => onPestanas?.(t.id, { t: 'activar', id: x.id })} title={`${nombre} duplicado ${x.n}`}>
                              {icono} {tituloPestana(tipo, x.n)}
                            </button>
                            <button type="button" className="cerrar-extra" aria-label={`Cerrar ${tituloPestana(tipo, x.n)}`} title={`Cerrar ${tituloPestana(tipo, x.n)}`} onClick={() => onPestanas?.(t.id, { t: 'cerrar', id: x.id })}>
                              ×
                            </button>
                          </span>
                        ))}
                      </Fragment>
                    )
                  })}
                  {onPestanas && (
                    <button
                      type="button"
                      className="panel-duplicar"
                      aria-haspopup="menu"
                      aria-expanded={menuDup?.id === t.id}
                      title="Duplicar: abre otra pestaña de terminal, asistente o archivos en esta celda"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setMenuDup((m) => (m?.id === t.id ? null : { id: t.id, x: r.right, y: r.bottom }))
                      }}
                    >
                      <span aria-hidden="true">＋</span> Duplicar
                    </button>
                  )}
                </div>
              )}
              {t.proyectoId && (
                <>
                  {montados.has(`${t.id}:archivos`) && (
                    <div className="panel-archivos" style={{ display: tipoActivo(t) === 'archivos' && !t.extraActiva ? 'flex' : 'none' }}>
                      <LimiteErrores zona="archivos" compacto>
                        <Suspense fallback={null}>
                          <PanelArchivos proyectoId={t.proyectoId} nombre={t.titulo.split(' · ')[0] ?? t.titulo} visible={visible && tipoActivo(t) === 'archivos' && !t.extraActiva} />
                        </Suspense>
                      </LimiteErrores>
                    </div>
                  )}
                  {montados.has(`${t.id}:asistente`) && (
                    <div className="panel-asistente" style={{ display: tipoActivo(t) === 'asistente' && !t.extraActiva ? 'flex' : 'none' }}>
                      <LimiteErrores zona="asistente" compacto>
                        <AsistenteCelda proyecto={{ id: t.proyectoId, nombre: t.titulo }} clave={t.proyectoId} />
                      </LimiteErrores>
                    </div>
                  )}
                  {(t.extras ?? []).map((x) => {
                    const aVista = t.extraActiva === x.id
                    if (x.tipo === 'archivos')
                      return (
                        montados.has(`${t.id}:${x.id}`) && (
                          <div key={x.id} className="panel-archivos" style={{ display: aVista ? 'flex' : 'none' }}>
                            <LimiteErrores zona="archivos" compacto>
                              <Suspense fallback={null}>
                                <PanelArchivos proyectoId={t.proyectoId!} nombre={t.titulo.split(' · ')[0] ?? t.titulo} visible={visible && aVista} />
                              </Suspense>
                            </LimiteErrores>
                          </div>
                        )
                      )
                    if (x.tipo === 'asistente')
                      return (
                        montados.has(`${t.id}:${x.id}`) && (
                          <div key={x.id} className="panel-asistente" style={{ display: aVista ? 'flex' : 'none' }}>
                            <LimiteErrores zona="asistente" compacto>
                              <AsistenteCelda proyecto={{ id: t.proyectoId!, nombre: t.titulo }} clave={`${t.proyectoId}#${x.id}`} />
                            </LimiteErrores>
                          </div>
                        )
                      )
                    // terminal duplicada: su propio proceso, que sigue vivo aunque se vea otra pestaña
                    return (
                      <div key={x.id} className="panel-terminal" style={{ display: aVista ? 'flex' : 'none' }}>
                        <LimiteErrores zona="terminal" compacto>
                          <TerminalPanel
                            id={x.id}
                            cwd={t.cwd}
                            proyectoId={t.proyectoId}
                            ptyExistente={x.ptyId}
                            onPty={(_id, pty) => onPestanas?.(t.id, { t: 'pty', id: x.id, ptyId: pty })}
                            visible={visible && aVista}
                            activa={t.id === activa && aVista}
                            onActivar={() => onActivar(t.id)}
                          />
                        </LimiteErrores>
                      </div>
                    )
                  })}
                </>
              )}
              <div className="panel-terminal" style={{ display: tipoActivo(t) === 'terminal' && !t.extraActiva ? 'flex' : 'none' }}>
                <LimiteErrores zona="terminal" compacto>
                  <TerminalPanel
                    id={t.id}
                    cwd={t.cwd}
                    proveedorId={t.proveedorId}
                    proyectoId={t.proyectoId}
                    ptyExistente={t.ptyId}
                    onPty={onPty}
                    visible={visible && tipoActivo(t) === 'terminal' && !t.extraActiva}
                    activa={t.id === activa && tipoActivo(t) === 'terminal' && !t.extraActiva}
                    onActivar={onActivar}
                  />
                </LimiteErrores>
              </div>
            </div>
          )
        })}
        {rejilla &&
          !carrusel &&
          divisores.map((d) => (
            <div
              key={d.id}
              className={`divisor divisor-${d.dir}`}
              style={estiloDivisor(d)}
              role="separator"
              aria-orientation={d.dir === 'h' ? 'vertical' : 'horizontal'}
              title="Arrastra para redimensionar · doble clic para igualar"
              onPointerDown={(e) => empezar(e, { tipo: 'divisor', divisor: d })}
              onPointerMove={arrastrar}
              onPointerUp={terminar}
              onPointerCancel={terminar}
              onDoubleClick={() => vista && setEstado({ arbol: conRazon(vista, d.id, 0.5), personalizado: true })}
            />
          ))}
      </div>
      {carrusel && (
        <div className="carrusel-barra" role="group" aria-label="Celdas de esta pestaña">
          <button type="button" onClick={() => irA(indice - 1)} disabled={indice <= 0} aria-label="Celda anterior" title="Celda anterior">
            ‹
          </button>
          <input type="range" min={0} max={terminales.length - 1} step={1} value={Math.min(indice, terminales.length - 1)} onChange={(e) => irA(Number(e.target.value))} aria-label="Deslizar entre las celdas" />
          <button type="button" onClick={() => irA(indice + 1)} disabled={indice >= terminales.length - 1} aria-label="Celda siguiente" title="Celda siguiente">
            ›
          </button>
          <span className="carrusel-etiqueta" title="No caben todas las celdas a la vez en este tamaño: desliza para ver las demás">
            {Math.min(indice, terminales.length - 1) + 1} / {terminales.length} · {terminales[Math.min(indice, terminales.length - 1)]?.titulo}
          </span>
        </div>
      )}
      {menuDup &&
        origenDup &&
        onPestanas &&
        createPortal(
          <div className="menu-ia menu-duplicar" role="menu" style={{ left: Math.max(8, Math.min(menuDup.x - 240, window.innerWidth - 250)), top: Math.min(menuDup.y + 4, window.innerHeight - 190) }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="menu-ia-tit">
              Duplicar en «{origenDup.titulo.split(' · ')[0]}» ({3 + (origenDup.extras?.length ?? 0)}/{MAX_PESTANAS} pestañas)
            </div>
            {TIPOS.map((tipo) => {
              const p = puedeDuplicar(origenDup.extras, tipo)
              const etiqueta = tituloPestana(tipo, 1)
              return (
                <button
                  key={tipo}
                  role="menuitem"
                  disabled={!p.ok}
                  title={p.ok ? `Abre otra pestaña de ${etiqueta.toLowerCase()} en esta celda` : p.motivo}
                  onClick={() => {
                    setMenuDup(null)
                    onPestanas(origenDup.id, { t: 'agregar', tipo })
                  }}
                >
                  {tipo === 'terminal' ? <IconoTerminal /> : tipo === 'asistente' ? <IconoChispa /> : <IconoCarpeta />}
                  <span>{etiqueta}</span>
                  <kbd>
                    {p.usadas}/{p.max}
                  </kbd>
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}
