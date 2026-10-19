import { useEffect, useMemo, useRef, useState } from 'react'
import { contarConflictos, decisionAuto, fusion3, lineasDeDecision, type DatosArchivoFusion, type Decision, type Trozo } from '@shared/fusion'

interface Props {
  datos: DatosArchivoFusion
  /** Rama de la que vienen los cambios (panel izquierdo) y rama en la que se integra (panel derecho). */
  origen: string
  actual: string
  /** Decisiones ya tomadas en una visita anterior a este archivo. */
  inicial?: ReadonlyMap<number, Decision>
  onCambio: (decisiones: Map<number, Decision>) => void
  onGuardar: (texto: string, decisiones: Map<number, Decision>) => void
  onCerrar: () => void
}

const PLEGAR_DESDE = 10 // tramos comunes más largos se pliegan
const VISIBLES = 3

type Cambiable = Exclude<Trozo, { tipo: 'comun' }>

/** Texto de las líneas de un panel, con su numeración. */
function Lineas({ lineas, desde, clase }: { lineas: string[]; desde: number | null; clase?: string }) {
  if (lineas.length === 0) return <div className={`ef-vacio ${clase ?? ''}`}>— sin líneas —</div>
  return (
    <>
      {lineas.map((l, i) => (
        <div key={i} className={`ef-l ${clase ?? ''}`}>
          <span className="ef-n">{desde === null ? '' : desde + i}</span>
          <span className="ef-t">{l || ' '}</span>
        </div>
      ))}
    </>
  )
}

function Comun({ lineas, desdeO, desdeR, desdeA }: { lineas: string[]; desdeO: number; desdeR: number; desdeA: number }) {
  const [abierto, setAbierto] = useState(false)
  const plegado = !abierto && lineas.length > PLEGAR_DESDE
  const celda = (desde: number): React.ReactNode =>
    plegado ? (
      <>
        <Lineas lineas={lineas.slice(0, VISIBLES)} desde={desde} />
        <button className="ef-plegado" onClick={() => setAbierto(true)} title="Mostrar las líneas sin cambios">
          ⋯ {lineas.length - 2 * VISIBLES} líneas sin cambios
        </button>
        <Lineas lineas={lineas.slice(-VISIBLES)} desde={desde + lineas.length - VISIBLES} />
      </>
    ) : (
      <Lineas lineas={lineas} desde={desde} />
    )
  return (
    <div className="ef-fila ef-comun">
      <div className="ef-celda">{celda(desdeO)}</div>
      <div className="ef-celda ef-centro">{celda(desdeR)}</div>
      <div className="ef-celda">{celda(desdeA)}</div>
    </div>
  )
}

function Cambio({
  t,
  indice,
  decision,
  desdeO,
  desdeR,
  desdeA,
  elegir,
  alEditar
}: {
  t: Cambiable
  indice: number
  decision: Decision | undefined
  desdeO: number
  desdeR: number
  desdeA: number
  elegir: (d: Decision) => void
  alEditar: () => void
}) {
  const sinResolver = decision === undefined
  const resultado = sinResolver ? t.base : lineasDeDecision(t, decision)
  const dif = (l: string[]): boolean => l.join('\n') !== t.base.join('\n')
  const marca = (d: Decision): string => (decision === d ? ' on' : '')
  return (
    <div className={`ef-fila ef-cambio ${t.tipo}${sinResolver ? ' sin-resolver' : ''}`} data-trozo={indice} data-pendiente={sinResolver ? '1' : undefined}>
      <div className="ef-celda ef-izq">
        <Lineas lineas={t.origen} desde={t.origen.length ? desdeO : null} clase={dif(t.origen) ? 'mod' : ''} />
      </div>
      <div className="ef-celda ef-centro">
        <div className="ef-acciones" role="group" aria-label="Elegir qué conservar">
          <button className={`ef-btn${marca('origen')}`} onClick={() => elegir('origen')} title={`Tomar lo de «${t.tipo === 'conflicto' ? 'la rama de origen' : 'origen'}» (izquierda)`}>
            « origen
          </button>
          <button className={`ef-btn${marca('actual-origen')}`} onClick={() => elegir('actual-origen')} title="Las dos versiones: primero la actual y luego la de origen">
            actual + origen
          </button>
          <button className={`ef-btn${marca('origen-actual')}`} onClick={() => elegir('origen-actual')} title="Las dos versiones: primero la de origen y luego la actual">
            origen + actual
          </button>
          <button className={`ef-btn${marca('base')}`} onClick={() => elegir('base')} title="Volver a como estaba antes de los dos cambios">
            base
          </button>
          <button className={`ef-btn${marca('actual')}`} onClick={() => elegir('actual')} title="Tomar lo de la rama actual (derecha)">
            actual »
          </button>
          <button className={`ef-btn${typeof decision === 'object' ? ' on' : ''}`} onClick={alEditar} title="Escribir el resultado a mano">
            ✎ editar
          </button>
        </div>
        {sinResolver && <div className="ef-aviso">⚠ Conflicto sin resolver: elige una opción</div>}
        {typeof decision === 'object' ? (
          <textarea className="ef-editar" value={decision.texto} spellCheck={false} rows={Math.max(2, decision.texto.split('\n').length)} onChange={(e) => elegir({ texto: e.target.value })} aria-label="Resultado editado a mano" autoFocus />
        ) : (
          <Lineas lineas={resultado} desde={resultado.length && !sinResolver ? desdeR : null} clase={sinResolver ? 'tenue' : 'ok'} />
        )}
      </div>
      <div className="ef-celda ef-der">
        <Lineas lineas={t.actual} desde={t.actual.length ? desdeA : null} clase={dif(t.actual) ? 'mod' : ''} />
      </div>
    </div>
  )
}

/**
 * Editor de fusión de tres paneles (como el de PhpStorm): a la izquierda la rama con los cambios que se quieren integrar, a la derecha la
 * rama actual, y en el centro el resultado. Cada cambio se resuelve tomando un lado, los dos, la base o escribiéndolo a mano.
 */
export function EditorFusion({ datos, origen, actual, inicial, onCambio, onGuardar, onCerrar }: Props) {
  const trozos = useMemo(() => fusion3(datos.base, datos.actual, datos.origen), [datos])
  const [decisiones, setDecisiones] = useState<Map<number, Decision>>(() => new Map(inicial))
  const cuerpo = useRef<HTMLDivElement>(null)

  const decision = (i: number): Decision | undefined => decisiones.get(i) ?? decisionAuto(trozos[i]!)
  const conflictos = contarConflictos(trozos)
  const sinResolver = trozos.reduce((n, t, i) => n + (t.tipo === 'conflicto' && decision(i) === undefined ? 1 : 0), 0)

  const poner = (i: number, d: Decision): void =>
    setDecisiones((m) => {
      const n = new Map(m).set(i, d)
      onCambio(n)
      return n
    })
  const todos = (d: 'origen' | 'actual'): void =>
    setDecisiones(() => {
      const n = new Map<number, Decision>()
      trozos.forEach((t, i) => t.tipo !== 'comun' && n.set(i, d))
      onCambio(n)
      return n
    })
  const siguiente = (): void => {
    const el = cuerpo.current?.querySelector<HTMLElement>('[data-pendiente="1"]')
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  useEffect(() => {
    if (sinResolver > 0) siguiente()
    // solo al abrir el archivo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Numeración de cada panel: avanza según lo que lleva cada trozo.
  let nO = 1
  let nR = 1
  let nA = 1
  const filas = trozos.map((t, i) => {
    const desde = { o: nO, r: nR, a: nA }
    if (t.tipo === 'comun') {
      nO += t.lineas.length
      nR += t.lineas.length
      nA += t.lineas.length
      return <Comun key={i} lineas={t.lineas} desdeO={desde.o} desdeR={desde.r} desdeA={desde.a} />
    }
    const d = decision(i)
    nO += t.origen.length
    nA += t.actual.length
    nR += d === undefined ? 0 : lineasDeDecision(t, d).length
    return (
      <Cambio
        key={i}
        t={t}
        indice={i}
        decision={d}
        desdeO={desde.o}
        desdeR={desde.r}
        desdeA={desde.a}
        elegir={(x) => poner(i, x)}
        alEditar={() => poner(i, { texto: (d === undefined ? t.base : lineasDeDecision(t, d)).join('\n') })}
      />
    )
  })

  const resultado = (): string => {
    const salida: string[] = []
    trozos.forEach((t, i) => (t.tipo === 'comun' ? salida.push(...t.lineas) : salida.push(...lineasDeDecision(t, decision(i) ?? 'actual'))))
    return salida.join('\n')
  }

  return (
    <div className="ef" role="region" aria-label={`Fusión de ${datos.ruta}`}>
      <header className="ef-barra">
        <strong className="mono ef-ruta" title={datos.ruta}>
          {datos.ruta}
        </strong>
        <span className={`chip ${sinResolver > 0 ? 'chip-aviso' : 'chip-ok'}`}>
          {conflictos === 0 ? 'Sin conflictos' : sinResolver > 0 ? `${sinResolver} de ${conflictos} conflicto${conflictos === 1 ? '' : 's'} sin resolver` : 'Todos los conflictos resueltos'}
        </span>
        <span className="ag-espacio" />
        <button onClick={() => todos('origen')} title="Quedarte con la versión de origen en todos los cambios">
          « Todo de origen
        </button>
        <button onClick={() => todos('actual')} title="Quedarte con la versión actual en todos los cambios">
          Todo de la actual »
        </button>
        <button onClick={siguiente} disabled={sinResolver === 0}>
          Siguiente conflicto ▾
        </button>
        <button onClick={onCerrar}>Cerrar</button>
        <button className="primario" disabled={sinResolver > 0} onClick={() => onGuardar(resultado(), decisiones)} title={sinResolver > 0 ? 'Resuelve primero todos los conflictos' : 'Guardar esta resolución (se aplica al fusionar)'}>
          Guardar resolución
        </button>
      </header>
      <div className="ef-cabecera">
        <span title="Rama con los cambios que quieres integrar">
          « <b>{origen}</b> <small>(origen)</small>
        </span>
        <span>Resultado</span>
        <span title="Rama en la que se integra">
          <b>{actual}</b> <small>(actual)</small> »
        </span>
      </div>
      <div className="ef-cuerpo" ref={cuerpo}>
        {filas}
      </div>
    </div>
  )
}
