import { useMemo, useState } from 'react'
import { analizarJson, colorEstado, formatearTamano, type RespuestaApi } from '@shared/api'
import { EstadoVacio } from './EstadoVacio'
import { IconoActividad } from './Iconos'
import { JsonArbol } from './JsonArbol'

type Pestana = 'cuerpo' | 'cabeceras' | 'info'
type Vista = 'arbol' | 'bonito' | 'crudo'

interface Props {
  respuesta?: RespuestaApi | undefined
  error?: string | undefined
  enviando: boolean
  onCancelar: () => void
  onGuardar: () => void
}

/** Respuesta de la última petición: estado, tiempo y tamaño; cuerpo como árbol JSON, texto bonito o crudo; cabeceras y detalles. */
export function ApiRespuesta({ respuesta, error, enviando, onCancelar, onGuardar }: Props) {
  if (enviando) {
    return (
      <div className="api-resp api-resp-centro">
        <span className="spinner" />
        <p>Enviando…</p>
        <button onClick={onCancelar}>Cancelar</button>
      </div>
    )
  }
  if (error) {
    return (
      <div className="api-resp">
        <div className="vc-banner error" role="alert" style={{ margin: 16 }}>
          <span className="vc-error-texto">{error}</span>
        </div>
      </div>
    )
  }
  if (!respuesta) {
    return (
      <div className="api-resp api-resp-centro">
        <EstadoVacio variante="compacto" icono={<IconoActividad />} titulo="Aún no hay respuesta" texto="Escribe una URL y pulsa Enviar (Ctrl+Enter). Aquí verás el estado, el tiempo y el cuerpo, con el JSON en árbol." />
      </div>
    )
  }
  return <Detalle key={respuesta.envioId} r={respuesta} onGuardar={onGuardar} />
}

function Detalle({ r, onGuardar }: { r: RespuestaApi; onGuardar: () => void }) {
  const [pestana, setPestana] = useState<Pestana>('cuerpo')
  const texto = r.cuerpo.tipo === 'texto' ? (r.cuerpo.texto ?? '') : ''
  const json = useMemo(() => (r.cuerpo.truncado ? undefined : analizarJson(texto)), [texto, r.cuerpo.truncado])
  const [vista, setVista] = useState<Vista>(json ? 'arbol' : 'crudo')
  const [nivel, setNivel] = useState<{ n: number; k: number }>({ n: 2, k: 0 })
  const bonito = useMemo(() => (json ? JSON.stringify(json.valor, null, 2) : texto), [json, texto])
  const color = colorEstado(r.estado)

  return (
    <div className="api-resp">
      <div className="api-resp-cab">
        <span className={`api-estado api-estado-${color}`} title={`Código de estado HTTP ${r.estado}`}>
          {r.estado} {r.texto}
        </span>
        <span className="chip" title="Tiempo total">
          {r.ms} ms
        </span>
        <span className="chip" title="Tamaño del cuerpo (descomprimido)">
          {formatearTamano(r.bytes)}
        </span>
        {r.redirecciones.length > 0 && (
          <span className="chip chip-aviso" title={`${r.redirecciones.join(' → ')} → ${r.urlFinal}`}>
            {r.redirecciones.length} redirección{r.redirecciones.length === 1 ? '' : 'es'}
          </span>
        )}
        {r.cuerpo.truncado && <span className="chip chip-aviso">cuerpo cortado</span>}
        <span className="ag-espacio" />
        {r.cuerpo.tipo === 'texto' && (
          <button onClick={() => void navigator.clipboard.writeText(vista === 'bonito' ? bonito : texto)} title="Copiar el cuerpo">
            Copiar
          </button>
        )}
        <button onClick={onGuardar} title="Guardar el cuerpo en un archivo">
          Guardar…
        </button>
      </div>
      <div className="vc-tabs api-sub">
        <div className="segmentado" role="tablist">
          <button role="tab" aria-selected={pestana === 'cuerpo'} className={pestana === 'cuerpo' ? 'on' : ''} onClick={() => setPestana('cuerpo')}>
            Cuerpo
          </button>
          <button role="tab" aria-selected={pestana === 'cabeceras'} className={pestana === 'cabeceras' ? 'on' : ''} onClick={() => setPestana('cabeceras')}>
            Cabeceras <span className="vc-cuenta">{r.cabeceras.length}</span>
          </button>
          <button role="tab" aria-selected={pestana === 'info'} className={pestana === 'info' ? 'on' : ''} onClick={() => setPestana('info')}>
            Detalles
          </button>
        </div>
        {pestana === 'cuerpo' && r.cuerpo.tipo === 'texto' && (
          <div className="api-vista-opc">
            <div className="segmentado" role="group" aria-label="Vista del cuerpo">
              {json && (
                <button className={vista === 'arbol' ? 'on' : ''} onClick={() => setVista('arbol')}>
                  Árbol
                </button>
              )}
              {json && (
                <button className={vista === 'bonito' ? 'on' : ''} onClick={() => setVista('bonito')}>
                  Formateado
                </button>
              )}
              <button className={vista === 'crudo' ? 'on' : ''} onClick={() => setVista('crudo')}>
                Crudo
              </button>
            </div>
            {json && vista === 'arbol' && (
              <>
                <button onClick={() => setNivel({ n: 99, k: nivel.k + 1 })}>Expandir</button>
                <button onClick={() => setNivel({ n: 1, k: nivel.k + 1 })}>Contraer</button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="api-resp-cuerpo">
        {pestana === 'cuerpo' &&
          (r.cuerpo.tipo === 'imagen' ? (
            <div className="api-imagen">
              <img src={`data:${r.tipoContenido.split(';')[0]};base64,${r.cuerpo.base64}`} alt="Respuesta" />
            </div>
          ) : r.cuerpo.tipo === 'binario' ? (
            <EstadoVacio variante="compacto" icono={<IconoActividad />} titulo="Contenido binario" texto={`${r.tipoContenido || 'Sin tipo'} · ${formatearTamano(r.bytes)}. Guárdalo en un archivo para abrirlo.`} accion={<button className="primario" onClick={onGuardar}>Guardar…</button>} />
          ) : texto === '' ? (
            <p className="tareas-vacio">La respuesta no tiene cuerpo.</p>
          ) : json && vista === 'arbol' ? (
            <JsonArbol key={nivel.k} valor={json.valor} abiertoHasta={nivel.n} />
          ) : (
            <pre className="api-pre">{vista === 'bonito' ? bonito : texto}</pre>
          ))}
        {pestana === 'cabeceras' && (
          <table className="api-tabla">
            <tbody>
              {r.cabeceras.map(([k, v], i) => (
                <tr key={`${k}${i}`}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pestana === 'info' && (
          <table className="api-tabla">
            <tbody>
              <tr><th scope="row">URL final</th><td>{r.urlFinal}</td></tr>
              {r.redirecciones.length > 0 && <tr><th scope="row">Redirecciones</th><td>{r.redirecciones.map((u, i) => <div key={i}>{u}</div>)}</td></tr>}
              <tr><th scope="row">Estado</th><td>{r.estado} {r.texto}</td></tr>
              <tr><th scope="row">Tipo de contenido</th><td>{r.tipoContenido || '—'}</td></tr>
              <tr><th scope="row">Tamaño</th><td>{formatearTamano(r.bytes)} ({r.bytes.toLocaleString()} bytes)</td></tr>
              <tr><th scope="row">Tiempo</th><td>{r.ms} ms</td></tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
