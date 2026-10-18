import { useMemo } from 'react'
import type { BloqueDiff, LineaDiff, ResultadoDiff } from '@shared/diff'

interface Props {
  diff: ResultadoDiff
  modo: 'unificado' | 'dividido'
  /** Con esto, cada bloque lleva una casilla para elegirlo (restaurar solo esos cambios). */
  seleccion?: ReadonlySet<number>
  onSeleccion?: (id: number, marcado: boolean) => void
  /** Texto de la casilla de cada bloque. */
  etiquetaBloque?: string
}

const MAX_FILAS = 4000

/** Qué línea de la pareja (quitada ↔ agregada) corresponde a cada línea modificada de un bloque. */
function parejas(lineas: LineaDiff[]): Map<number, number> {
  const m = new Map<number, number>()
  for (let i = 0; i < lineas.length; ) {
    if (lineas[i]!.tipo === 'igual') {
      i++
      continue
    }
    let j = i
    while (j < lineas.length && lineas[j]!.tipo !== 'igual') j++
    const q: number[] = []
    const g: number[] = []
    for (let k = i; k < j; k++) {
      const l = lineas[k]!
      if (l.modificada) (l.tipo === 'quitada' ? q : g).push(k)
    }
    q.forEach((k, n) => {
      if (g[n] !== undefined) {
        m.set(k, g[n]!)
        m.set(g[n]!, k)
      }
    })
    i = j
  }
  return m
}

/** Parte de una línea modificada que cambió: se quita lo común al principio y al final. */
function partes(texto: string, otra: string): { antes: string; medio: string; despues: string } {
  let ini = 0
  while (ini < texto.length && ini < otra.length && texto[ini] === otra[ini]) ini++
  let fin = 0
  while (fin < texto.length - ini && fin < otra.length - ini && texto[texto.length - 1 - fin] === otra[otra.length - 1 - fin]) fin++
  return { antes: texto.slice(0, ini), medio: texto.slice(ini, texto.length - fin), despues: texto.slice(texto.length - fin) }
}

function Texto({ linea, pareja }: { linea: LineaDiff; pareja?: LineaDiff }) {
  if (!linea.modificada || !pareja) return <>{linea.texto || ' '}</>
  const p = partes(linea.texto, pareja.texto)
  return (
    <>
      {p.antes}
      {p.medio && <mark>{p.medio}</mark>}
      {p.despues || (!p.antes && !p.medio ? ' ' : '')}
    </>
  )
}

interface Fila {
  izq?: LineaDiff
  der?: LineaDiff
  parIzq?: LineaDiff
  parDer?: LineaDiff
}

/** Filas del modo dividido: lo quitado a la izquierda y lo agregado a la derecha, emparejadas. */
function filasDivididas(b: BloqueDiff): Fila[] {
  const filas: Fila[] = []
  const l = b.lineas
  for (let i = 0; i < l.length; ) {
    if (l[i]!.tipo === 'igual') {
      filas.push({ izq: l[i], der: l[i] })
      i++
      continue
    }
    let j = i
    while (j < l.length && l[j]!.tipo !== 'igual') j++
    const q = l.slice(i, j).filter((x) => x.tipo === 'quitada')
    const g = l.slice(i, j).filter((x) => x.tipo === 'agregada')
    for (let k = 0; k < Math.max(q.length, g.length); k++) {
      const izq = q[k]
      const der = g[k]
      filas.push({ izq, der, parIzq: izq && der ? der : undefined, parDer: izq && der ? izq : undefined })
    }
    i = j
  }
  return filas
}

function Cabecera({ b, seleccion, onSeleccion, etiqueta }: { b: BloqueDiff; seleccion?: ReadonlySet<number>; onSeleccion?: (id: number, marcado: boolean) => void; etiqueta: string }) {
  return (
    <div className="hd-cab">
      {seleccion && (
        <label className="hd-casilla">
          <input type="checkbox" checked={seleccion.has(b.id)} onChange={(e) => onSeleccion?.(b.id, e.target.checked)} />
          <span>{etiqueta}</span>
        </label>
      )}
      <span className="mono hd-pos">
        línea {b.aInicio}
      </span>
      {b.agregadas > 0 && <span className="hd-mas">+{b.agregadas}</span>}
      {b.quitadas > 0 && <span className="hd-menos">−{b.quitadas}</span>}
      {b.modificadas > 0 && <span className="hd-mod">~{b.modificadas}</span>}
    </div>
  )
}

/**
 * Diferencias entre dos versiones de un archivo: líneas agregadas (verde), quitadas (rojo) y modificadas (se resalta lo que cambió dentro
 * de la línea), en una columna o en dos. Con `seleccion`, cada bloque se puede marcar para restaurarlo por separado.
 */
export function VisorDiff({ diff, modo, seleccion, onSeleccion, etiquetaBloque = 'Restaurar este bloque' }: Props) {
  const total = useMemo(() => diff.bloques.reduce((n, b) => n + b.lineas.length, 0), [diff])
  if (diff.iguales) return <p className="tareas-vacio">Sin diferencias: las dos versiones son iguales.</p>
  let restantes = MAX_FILAS
  return (
    <div className="hd" role="table" aria-label="Diferencias">
      {diff.aproximado && <p className="vc-nota hd-aviso">El archivo es muy grande o cambió casi por completo: se muestra por bloques enteros, sin detalle línea a línea.</p>}
      {diff.bloques.map((b) => {
        if (restantes <= 0) return null
        const par = parejas(b.lineas)
        const recorte = b.lineas.slice(0, restantes)
        restantes -= recorte.length
        return (
          <section key={b.id} className={`hd-bloque${seleccion?.has(b.id) ? ' marcado' : ''}`}>
            <Cabecera b={b} seleccion={seleccion} onSeleccion={onSeleccion} etiqueta={etiquetaBloque} />
            {modo === 'unificado'
              ? recorte.map((l, i) => (
                  <div key={i} className={`hd-l hd-${l.tipo}${l.modificada ? ' mod' : ''}`} role="row">
                    <span className="hd-n">{l.a ?? ''}</span>
                    <span className="hd-n">{l.b ?? ''}</span>
                    <span className="hd-signo">{l.tipo === 'agregada' ? '+' : l.tipo === 'quitada' ? '−' : ''}</span>
                    <span className="hd-t">
                      <Texto linea={l} pareja={par.has(i) ? b.lineas[par.get(i)!] : undefined} />
                    </span>
                  </div>
                ))
              : filasDivididas(b).map((f, i) => (
                  <div key={i} className="hd-f" role="row">
                    <div className={`hd-mitad hd-${f.izq?.tipo ?? 'vacio'}${f.izq?.modificada ? ' mod' : ''}`}>
                      <span className="hd-n">{f.izq?.a ?? ''}</span>
                      <span className="hd-t">{f.izq ? <Texto linea={f.izq} pareja={f.parIzq} /> : ''}</span>
                    </div>
                    <div className={`hd-mitad hd-${f.der?.tipo ?? 'vacio'}${f.der?.modificada ? ' mod' : ''}`}>
                      <span className="hd-n">{f.der?.b ?? ''}</span>
                      <span className="hd-t">{f.der ? <Texto linea={f.der} pareja={f.parDer} /> : ''}</span>
                    </div>
                  </div>
                ))}
          </section>
        )
      })}
      {total > MAX_FILAS && <p className="tareas-vacio">Diferencia muy grande: se muestra solo el principio.</p>}
    </div>
  )
}
