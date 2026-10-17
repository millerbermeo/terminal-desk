import { par, type ParClave } from '@shared/api'

interface Props {
  filas: ParClave[]
  onCambio: (filas: ParClave[]) => void
  textoClave?: string
  textoValor?: string
  /** Sugerencias para el campo de clave (cabeceras habituales). */
  sugerencias?: readonly string[]
  etiqueta: string
}

/**
 * Tabla editable de pares clave/valor con casilla para activarlos. Siempre hay una fila vacía al final: al escribir en ella se crea
 * una fila nueva, sin botones de «añadir».
 */
export function TablaClaveValor({ filas, onCambio, textoClave = 'Clave', textoValor = 'Valor', sugerencias, etiqueta }: Props) {
  const cambiar = (id: string, parche: Partial<ParClave>): void => onCambio(filas.map((f) => (f.id === id ? { ...f, ...parche } : f)))
  const lista = sugerencias ? `sug-${etiqueta.replace(/\W/g, '')}` : undefined
  return (
    <div className="kv" role="table" aria-label={etiqueta}>
      {sugerencias && (
        <datalist id={lista}>
          {sugerencias.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {filas.map((f) => (
        <div className={`kv-fila${f.activo ? '' : ' apagada'}`} key={f.id} role="row">
          <input type="checkbox" checked={f.activo} onChange={(e) => cambiar(f.id, { activo: e.target.checked })} aria-label="Activar fila" title="Activar o desactivar sin borrar" />
          <input value={f.clave} placeholder={textoClave} {...(lista ? { list: lista } : {})} onChange={(e) => cambiar(f.id, { clave: e.target.value })} aria-label={textoClave} spellCheck={false} />
          <input value={f.valor} placeholder={textoValor} onChange={(e) => cambiar(f.id, { valor: e.target.value })} aria-label={textoValor} spellCheck={false} />
          <button className="icono" onClick={() => onCambio(filas.filter((x) => x.id !== f.id))} aria-label="Quitar fila" title="Quitar">
            ✕
          </button>
        </div>
      ))}
      <div className="kv-fila fantasma" role="row">
        <input type="checkbox" disabled aria-hidden="true" tabIndex={-1} />
        <input value="" placeholder={textoClave} {...(lista ? { list: lista } : {})} onChange={(e) => onCambio([...filas, par(e.target.value, '')])} aria-label={`${textoClave} (nueva fila)`} spellCheck={false} />
        <input value="" placeholder={textoValor} onChange={(e) => onCambio([...filas, par('', e.target.value)])} aria-label={`${textoValor} (nueva fila)`} spellCheck={false} />
        <span />
      </div>
    </div>
  )
}
