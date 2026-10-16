import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { IconoCerrar, IconoTerminal } from './Iconos'
import { TerminalPanel } from './TerminalPanel'
import type { TerminalInfo } from '../App'

export type Modo = 'rejilla' | 'pestanas'

interface Props {
  terminales: TerminalInfo[]
  activa: string | null
  modo: Modo
  onActivar: (id: string) => void
  onCerrar: (id: string) => void
}

const GAP = 8 // separación entre paneles y margen del contenedor (px)
const ASA = 10 // grosor de la zona de agarre del divisor
const MIN_ANCHO = 260
const MIN_ALTO = 150
const PASO_TECLADO = 24

type Eje = 'col' | 'fila'

const iguales = (n: number): number[] => Array<number>(n).fill(1)
const suma = (a: number[]): number => a.reduce((x, y) => x + y, 0)

interface Arrastre {
  eje: Eje
  i: number
  inicio: number // coordenada del puntero al empezar
  base: number[] // fracciones al empezar
  disponible: number // px repartibles entre las pistas
}

export function TerminalGrid({ terminales, activa, modo, onActivar, onCerrar }: Props) {
  const n = terminales.length
  const nCols = Math.ceil(Math.sqrt(n)) || 1
  const nFilas = Math.ceil(n / nCols) || 1
  const enLaUltima = n - nCols * (nFilas - 1) // paneles en la última fila (1..nCols)

  // Proporciones de columnas/filas. Al cambiar la forma de la rejilla vuelven a ser iguales.
  const [anchos, setAnchos] = useState<number[] | null>(null)
  const [altos, setAltos] = useState<number[] | null>(null)
  useEffect(() => {
    setAnchos(null)
    setAltos(null)
  }, [nCols, nFilas])
  const cols = anchos?.length === nCols ? anchos : iguales(nCols)
  const filas = altos?.length === nFilas ? altos : iguales(nFilas)

  const contenedor = useRef<HTMLDivElement>(null)
  const arrastre = useRef<Arrastre | null>(null)
  const [arrastrando, setArrastrando] = useState<Eje | null>(null)

  const preparar = (eje: Eje, i: number, inicio: number): Arrastre | null => {
    const r = contenedor.current?.getBoundingClientRect()
    if (!r) return null
    const base = eje === 'col' ? cols : filas
    const total = eje === 'col' ? r.width : r.height
    return { eje, i, inicio, base, disponible: total - 2 * GAP - GAP * (base.length - 1) }
  }

  /** Mueve el divisor `i` por `delta` px: una pista crece, la vecina decrece, ninguna baja del mínimo. */
  const mover = (a: Arrastre, delta: number): void => {
    const s = suma(a.base)
    const px = a.base.map((f) => (a.disponible * f) / s)
    const minimo = Math.min(a.eje === 'col' ? MIN_ANCHO : MIN_ALTO, a.disponible / a.base.length)
    const d = Math.max(minimo - px[a.i], Math.min(delta, px[a.i + 1] - minimo))
    px[a.i] += d
    px[a.i + 1] -= d
    const nuevo = px.map((p) => (p * s) / a.disponible)
    if (a.eje === 'col') setAnchos(nuevo)
    else setAltos(nuevo)
  }

  const alPresionar = (e: PointerEvent<HTMLDivElement>, eje: Eje, i: number): void => {
    const a = preparar(eje, i, eje === 'col' ? e.clientX : e.clientY)
    if (!a) return
    arrastre.current = a
    setArrastrando(eje)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const alMover = (e: PointerEvent<HTMLDivElement>): void => {
    const a = arrastre.current
    if (a) mover(a, (a.eje === 'col' ? e.clientX : e.clientY) - a.inicio)
  }
  const alSoltar = (): void => {
    arrastre.current = null
    setArrastrando(null)
  }
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>, eje: Eje, i: number): void => {
    const signo = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key]
    if (!signo || (eje === 'col') !== (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
    e.preventDefault()
    const a = preparar(eje, i, 0)
    if (a) mover(a, signo * PASO_TECLADO)
  }

  // Posición CSS de un divisor: borde entre pistas hasta `i`, centrado en el hueco.
  const posicion = (fr: number[], i: number): string => {
    const acumulado = suma(fr.slice(0, i + 1)) / suma(fr)
    return `calc(${GAP}px + (100% - ${2 * GAP + GAP * (fr.length - 1)}px) * ${acumulado} + ${GAP * i + GAP / 2 - ASA / 2}px)`
  }

  const divisor = (eje: Eje, i: number) => {
    const col = eje === 'col'
    const estilo: CSSProperties = col
      ? { left: posicion(cols, i), width: ASA, top: GAP, bottom: GAP }
      : { top: posicion(filas, i), height: ASA, left: GAP, right: GAP }
    // si la última fila está incompleta, su panel final ocupa varias columnas: el divisor no la cruza
    if (col && nFilas > 1 && i >= enLaUltima - 1 && enLaUltima < nCols) {
      const ultima = filas[nFilas - 1] / suma(filas)
      estilo.bottom = `calc(${GAP}px + (100% - ${2 * GAP + GAP * (nFilas - 1)}px) * ${ultima} + ${GAP}px)`
    }
    return (
      <div
        key={`${eje}${i}`}
        className={`divisor divisor-${eje}${arrastrando === eje ? ' activo' : ''}`}
        style={estilo}
        role="separator"
        aria-orientation={col ? 'vertical' : 'horizontal'}
        tabIndex={0}
        title="Arrastra para redimensionar · doble clic para igualar"
        onPointerDown={(e) => alPresionar(e, eje, i)}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onDoubleClick={() => (col ? setAnchos(null) : setAltos(null))}
        onKeyDown={(e) => alTeclear(e, eje, i)}
      />
    )
  }

  const rejilla = modo === 'rejilla'

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
      <div
        ref={contenedor}
        className={`paneles ${modo}${arrastrando ? ` arrastrando-${arrastrando}` : ''}`}
        style={
          rejilla
            ? {
                gridTemplateColumns: cols.map((f) => `minmax(0, ${f}fr)`).join(' '),
                gridTemplateRows: filas.map((f) => `minmax(0, ${f}fr)`).join(' '),
                gap: GAP,
                padding: GAP
              }
            : undefined
        }
      >
        {n === 0 && (
          <div className="vacio">
            <div className="vacio-icono"><IconoTerminal /></div>
            <strong>Sin terminales abiertas</strong>
            <span>Elige un proyecto en la barra lateral o crea una terminal nueva.</span>
          </div>
        )}
        {terminales.map((t, idx) => {
          const visible = rejilla || t.id === activa
          // el último panel de una fila incompleta ocupa las columnas libres
          const ocupa = rejilla && idx === n - 1 && enLaUltima < nCols ? nCols - enLaUltima + 1 : 1
          return (
            <div
              key={t.id}
              className={`panel${t.id === activa ? ' activa' : ''}`}
              style={{ display: visible ? 'flex' : 'none', gridColumn: ocupa > 1 ? `span ${ocupa}` : undefined }}
            >
              {rejilla && (
                <div className="panel-barra">
                  <span className="panel-titulo">
                    <IconoTerminal /> {t.titulo}
                  </span>
                  <button className="cerrar" title="Cerrar" onClick={() => onCerrar(t.id)}>
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
                onFoco={() => onActivar(t.id)}
              />
            </div>
          )
        })}
        {rejilla && Array.from({ length: nCols - 1 }, (_, i) => divisor('col', i))}
        {rejilla && Array.from({ length: nFilas - 1 }, (_, i) => divisor('fila', i))}
      </div>
    </div>
  )
}
