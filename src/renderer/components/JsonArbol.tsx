import { useState } from 'react'

const PAGINA = 100
const MAX_TEXTO = 300

const copiar = (t: string): void => void navigator.clipboard.writeText(t).catch(() => undefined)

const ruta = (padre: string, clave: string | number): string => (typeof clave === 'number' ? `${padre}[${clave}]` : /^[A-Za-z_$][\w$]*$/.test(clave) ? `${padre}.${clave}` : `${padre}[${JSON.stringify(clave)}]`)

function Primitivo({ valor }: { valor: unknown }) {
  const [largo, setLargo] = useState(false)
  if (valor === null) return <span className="json-nulo">null</span>
  if (typeof valor === 'boolean') return <span className="json-bool">{String(valor)}</span>
  if (typeof valor === 'number') return <span className="json-num">{String(valor)}</span>
  const t = String(valor)
  const recortado = t.length > MAX_TEXTO && !largo
  return (
    <span className="json-cad">
      “{recortado ? t.slice(0, MAX_TEXTO) : t}”
      {t.length > MAX_TEXTO && (
        <button className="enlace" onClick={() => setLargo(!largo)}>
          {largo ? ' ver menos' : ` … ver más (${t.length} caracteres)`}
        </button>
      )}
    </span>
  )
}

interface NodoProps {
  clave?: string | number
  valor: unknown
  ruta: string
  profundidad: number
  abiertoHasta: number
  esUltimo: boolean
}

function Nodo({ clave, valor, ruta: r, profundidad, abiertoHasta, esUltimo }: NodoProps) {
  const [abierto, setAbierto] = useState(profundidad < abiertoHasta)
  const [mostrar, setMostrar] = useState(PAGINA)
  const compuesto = valor !== null && typeof valor === 'object'
  const coma = esUltimo ? '' : ','
  const etiquetaClave = clave === undefined ? null : typeof clave === 'number' ? <span className="json-indice">{clave}</span> : <span className="json-clave">“{clave}”</span>
  const acciones = (
    <span className="json-acciones">
      <button className="icono" onClick={() => copiar(compuesto ? JSON.stringify(valor, null, 2) : typeof valor === 'string' ? valor : String(valor))} title="Copiar valor" aria-label="Copiar valor">
        ⧉
      </button>
      <button className="icono" onClick={() => copiar(r)} title={`Copiar ruta (${r})`} aria-label="Copiar ruta">
        $
      </button>
    </span>
  )
  if (!compuesto) {
    return (
      <div className="json-fila">
        {etiquetaClave}
        {etiquetaClave && <span className="json-punt">: </span>}
        <Primitivo valor={valor} />
        <span className="json-punt">{coma}</span>
        {acciones}
      </div>
    )
  }
  const esLista = Array.isArray(valor)
  const entradas: [string | number, unknown][] = esLista ? (valor as unknown[]).map((v, i) => [i, v]) : Object.entries(valor as Record<string, unknown>)
  const [abre, cierra] = esLista ? ['[', ']'] : ['{', '}']
  if (entradas.length === 0) {
    return (
      <div className="json-fila">
        {etiquetaClave}
        {etiquetaClave && <span className="json-punt">: </span>}
        <span className="json-punt">
          {abre}
          {cierra}
          {coma}
        </span>
      </div>
    )
  }
  return (
    <div className="json-nodo">
      <div className="json-fila">
        <button className="json-flecha" onClick={() => setAbierto(!abierto)} aria-expanded={abierto} aria-label={abierto ? 'Contraer' : 'Expandir'}>
          {abierto ? '▾' : '▸'}
        </button>
        {etiquetaClave}
        {etiquetaClave && <span className="json-punt">: </span>}
        <span className="json-punt">{abre}</span>
        {!abierto && (
          <>
            <span className="json-resumen">
              {' '}
              {entradas.length} {esLista ? (entradas.length === 1 ? 'elemento' : 'elementos') : entradas.length === 1 ? 'clave' : 'claves'}{' '}
            </span>
            <span className="json-punt">
              {cierra}
              {coma}
            </span>
          </>
        )}
        {acciones}
      </div>
      {abierto && (
        <>
          <div className="json-hijos">
            {entradas.slice(0, mostrar).map(([k, v], i) => (
              <Nodo key={k} clave={k} valor={v} ruta={ruta(r, k)} profundidad={profundidad + 1} abiertoHasta={abiertoHasta} esUltimo={i === Math.min(entradas.length, mostrar) - 1 && mostrar >= entradas.length} />
            ))}
            {entradas.length > mostrar && (
              <button className="enlace json-mas" onClick={() => setMostrar(mostrar + PAGINA)}>
                Mostrar {Math.min(PAGINA, entradas.length - mostrar)} más ({entradas.length - mostrar} restantes)
              </button>
            )}
          </div>
          <div className="json-fila">
            <span className="json-punt">
              {cierra}
              {coma}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/** Visor JSON en árbol: nodos que se pliegan, colores por tipo, copiar valor o ruta (`$.datos[0].id`) y paginación de las listas largas. */
export function JsonArbol({ valor, abiertoHasta = 2 }: { valor: unknown; abiertoHasta?: number }) {
  return (
    <div className="json-arbol" role="tree" aria-label="JSON">
      <Nodo valor={valor} ruta="$" profundidad={0} abiertoHasta={abiertoHasta} esUltimo />
    </div>
  )
}
