import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { IconoCerrar, IconoTerminal } from './Iconos'
import { TerminalPanel } from './TerminalPanel'
import type { TerminalInfo } from '../App'
import { GRID, aplicarArrastre, reconciliar, type Asa, type Rect, type Rects } from '../layout'

export type Modo = 'rejilla' | 'pestanas'

interface Props {
  terminales: TerminalInfo[]
  activa: string | null
  modo: Modo
  reiniciarLayout: number // cambia para volver a la cuadrícula automática
  onPersonalizado: (v: boolean) => void
  onActivar: (id: string) => void
  onCerrar: (id: string) => void
}

const MIN_ANCHO = 260 // px
const MIN_ALTO = 150 // px
const MARGEN = 4 // px a cada lado de un panel (8 px entre paneles)

const ASAS: { clase: string; asa: Asa }[] = [
  { clase: 'n', asa: { t: true } },
  { clase: 's', asa: { b: true } },
  { clase: 'e', asa: { r: true } },
  { clase: 'w', asa: { l: true } },
  { clase: 'ne', asa: { t: true, r: true } },
  { clase: 'nw', asa: { t: true, l: true } },
  { clase: 'se', asa: { b: true, r: true } },
  { clase: 'sw', asa: { b: true, l: true } }
]

interface Arrastre {
  id: string
  tipo: 'mover' | Asa
  x0: number
  y0: number
  rect0: Rect
  unidadX: number // px por unidad de cuadrícula
  unidadY: number
}

export function TerminalGrid({ terminales, activa, modo, reiniciarLayout, onPersonalizado, onActivar, onCerrar }: Props) {
  const ids = terminales.map((t) => t.id)
  const [estado, setEstado] = useState<{ rects: Rects; personalizado: boolean }>({ rects: {}, personalizado: false })
  const contenedor = useRef<HTMLDivElement>(null)
  const arrastre = useRef<Arrastre | null>(null)
  const [moviendo, setMoviendo] = useState<string | null>(null)

  // Layout efectivo: se calcula en el render (sin parpadeo) y se guarda en el efecto.
  const efectivo = reconciliar(estado.rects, ids, estado.personalizado)
  const clave = ids.join('|')
  useEffect(() => {
    setEstado(efectivo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  useEffect(() => {
    if (reiniciarLayout > 0) setEstado({ rects: {}, personalizado: false })
  }, [reiniciarLayout])

  useEffect(() => onPersonalizado(efectivo.personalizado), [efectivo.personalizado, onPersonalizado])

  const empezar = (e: PointerEvent<HTMLElement>, id: string, tipo: 'mover' | Asa): void => {
    const caja = contenedor.current?.getBoundingClientRect()
    const rect0 = efectivo.rects[id]
    if (!caja || !rect0) return
    arrastre.current = { id, tipo, x0: e.clientX, y0: e.clientY, rect0, unidadX: caja.width / GRID, unidadY: caja.height / GRID }
    setMoviendo(id)
    onActivar(id)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const arrastrar = (e: PointerEvent<HTMLElement>): void => {
    const a = arrastre.current
    if (!a) return
    const dx = Math.round((e.clientX - a.x0) / a.unidadX)
    const dy = Math.round((e.clientY - a.y0) / a.unidadY)
    const otros = Object.entries(efectivo.rects).filter(([k]) => k !== a.id).map(([, r]) => r)
    const minW = Math.min(GRID, Math.ceil(MIN_ANCHO / a.unidadX))
    const minH = Math.min(GRID, Math.ceil(MIN_ALTO / a.unidadY))
    const nuevo = aplicarArrastre(a.rect0, a.tipo, dx, dy, otros, minW, minH)
    const actual = efectivo.rects[a.id]
    if (nuevo.x === actual.x && nuevo.y === actual.y && nuevo.w === actual.w && nuevo.h === actual.h) return
    setEstado({ rects: { ...efectivo.rects, [a.id]: nuevo }, personalizado: true })
  }

  const terminar = (): void => {
    arrastre.current = null
    setMoviendo(null)
  }

  const eventosArrastre = (id: string, tipo: 'mover' | Asa) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => empezar(e, id, tipo),
    onPointerMove: arrastrar,
    onPointerUp: terminar,
    onPointerCancel: terminar
  })

  const rejilla = modo === 'rejilla'
  const estiloPanel = (id: string): CSSProperties => {
    const r = efectivo.rects[id]
    if (!rejilla || !r) return {}
    return {
      left: `calc(${(r.x / GRID) * 100}% + ${MARGEN}px)`,
      top: `calc(${(r.y / GRID) * 100}% + ${MARGEN}px)`,
      width: `calc(${(r.w / GRID) * 100}% - ${2 * MARGEN}px)`,
      height: `calc(${(r.h / GRID) * 100}% - ${2 * MARGEN}px)`
    }
  }

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
      <div ref={contenedor} className={`paneles ${modo}${moviendo ? ' arrastrando' : ''}`}>
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
                <div className="panel-barra" title="Arrastra para mover" {...eventosArrastre(t.id, 'mover')}>
                  <span className="panel-titulo">
                    <IconoTerminal /> {t.titulo}
                  </span>
                  <button className="cerrar" title="Cerrar" onPointerDown={(e) => e.stopPropagation()} onClick={() => onCerrar(t.id)}>
                    <IconoCerrar />
                  </button>
                </div>
              )}
              <TerminalPanel
                id={t.id}
                cwd={t.cwd}
                proveedorId={t.proveedorId}
                visible={visible}
                activa={t.id === activa}
                onActivar={onActivar}
              />
              {rejilla &&
                ASAS.map(({ clase, asa }) => (
                  <div key={clase} className={`asa asa-${clase}`} {...eventosArrastre(t.id, asa)} />
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
