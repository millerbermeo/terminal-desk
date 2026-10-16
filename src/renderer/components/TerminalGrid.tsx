import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { IconoCerrar, IconoChispa, IconoTerminal } from './Iconos'
import { ChatAgente } from './ChatAgente'
import { TerminalPanel } from './TerminalPanel'
import { useAgente } from '../agente/useAgente'
import type { TerminalInfo } from '../App'
import {
  calcular,
  conRazon,
  hojaEn,
  intercambiar,
  limitarRazon,
  normalizar,
  reconciliar,
  type DivisorGeo,
  type Medidas,
  type Nodo
} from '../arbol'

export type Modo = 'rejilla' | 'pestanas'

interface Props {
  terminales: TerminalInfo[]
  activa: string | null
  modo: Modo
  reiniciarLayout: number // cambia para volver a la cuadrícula automática
  onPersonalizado: (v: boolean) => void
  onActivar: (id: string) => void
  onCerrar: (id: string) => void
  onPty?: (terminalId: string, ptyId: string) => void
  /** Cambia lo que muestra una celda (terminal o asistente). */
  onVista?: (terminalId: string, vista: 'terminal' | 'asistente') => void
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
function AsistenteCelda({ proyecto }: { proyecto: { id: string; nombre: string } }) {
  const agente = useAgente()
  return <ChatAgente agente={agente} proyectoFijo={proyecto} />
}

export function TerminalGrid({ terminales, activa, modo, reiniciarLayout, onPersonalizado, onActivar, onCerrar, onPty, onVista }: Props) {
  // El asistente de una celda se monta la primera vez que se muestra y ya no se desmonta (conserva su conversación).
  const [conAsistente, setConAsistente] = useState<Set<string>>(new Set())
  useEffect(() => {
    const nuevos = terminales.filter((t) => t.vista === 'asistente' && !conAsistente.has(t.id)).map((t) => t.id)
    if (nuevos.length) setConAsistente((s) => new Set([...s, ...nuevos]))
  }, [terminales, conAsistente])

  const ids = terminales.map((t) => t.id)
  const contenedor = useRef<HTMLDivElement>(null)
  const [estado, setEstado] = useState<{ arbol: Nodo | null; personalizado: boolean }>({ arbol: null, personalizado: false })
  const arrastre = useRef<Arrastre | null>(null)
  const [arrastrando, setArrastrando] = useState<'divisor' | 'mover' | null>(null)
  const [moviendo, setMoviendo] = useState<string | null>(null)

  const medidas = (): Medidas => {
    const r = contenedor.current?.getBoundingClientRect()
    // oculto (otra pestaña) mide 0: se usan medidas por defecto
    return { ancho: r?.width || 1000, alto: r?.height || 700, minAncho: MIN_ANCHO, minAlto: MIN_ALTO }
  }

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
  const estiloPanel = (id: string): CSSProperties => {
    const r = rects[id]
    if (!rejilla || !r) return {}
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
      <div ref={contenedor} className={`paneles ${modo}${arrastrando ? ` arrastrando arrastrando-${arrastrando}` : ''}`}>
        {terminales.length === 0 && (
          <div className="vacio">
            <div className="vacio-icono"><IconoTerminal /></div>
            <strong>Sin terminales abiertas</strong>
            <span>Elige un proyecto en la barra lateral o crea una terminal nueva.</span>
          </div>
        )}
        {terminales.map((t) => {
          const visible = rejilla || t.id === activa
          return (
            <div
              key={t.id}
              className={`panel${t.id === activa ? ' activa' : ''}${moviendo === t.id ? ' en-mano' : ''}`}
              style={{ display: visible ? 'flex' : 'none', ...estiloPanel(t.id) }}
            >
              {rejilla && (
                <div
                  className="panel-barra"
                  title="Arrastra sobre otra terminal para intercambiarlas"
                  onPointerDown={(e) => empezar(e, { tipo: 'mover', id: t.id })}
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
                <div className="panel-vista" role="group" aria-label="Contenido de la celda">
                  <button className={t.vista !== 'asistente' ? 'on' : ''} onClick={() => onVista(t.id, 'terminal')}>
                    <IconoTerminal /> Terminal
                  </button>
                  <button className={t.vista === 'asistente' ? 'on' : ''} onClick={() => onVista(t.id, 'asistente')} title="Asistente integrado: conversa con el agente en este proyecto (la terminal sigue viva)">
                    <IconoChispa /> Asistente
                  </button>
                </div>
              )}
              {t.proyectoId && conAsistente.has(t.id) && (
                <div className="panel-asistente" style={{ display: t.vista === 'asistente' ? 'flex' : 'none' }}>
                  <AsistenteCelda proyecto={{ id: t.proyectoId, nombre: t.titulo }} />
                </div>
              )}
              <div className="panel-terminal" style={{ display: t.vista === 'asistente' ? 'none' : 'flex' }}>
                <TerminalPanel
                  id={t.id}
                  cwd={t.cwd}
                  proveedorId={t.proveedorId}
                  proyectoId={t.proyectoId}
                  ptyExistente={t.ptyId}
                  onPty={onPty}
                  visible={visible && t.vista !== 'asistente'}
                  activa={t.id === activa && t.vista !== 'asistente'}
                  onActivar={onActivar}
                />
              </div>
            </div>
          )
        })}
        {rejilla &&
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
    </div>
  )
}
