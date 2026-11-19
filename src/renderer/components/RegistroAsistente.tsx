import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ayudaCausa, diagnosticar, entradaSinCache, ETIQUETA_CAUSA, informeMarkdown, resumir, type EntradaBitacora, type EntradaFallo, type EntradaTurno } from '@shared/bitacora-asistente'

const PERIODOS = [
  { dias: 1, texto: 'Hoy' },
  { dias: 7, texto: '7 días' },
  { dias: 30, texto: '30 días' }
]
const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)} k` : String(Math.round(n)))
const hora = (ts: number): string => new Date(ts).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const modeloCorto = (m: string): string => m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
const seg = (ms: number): string => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')} s`)

/**
 * Registro del Asistente: cuánto envía y recibe cada mensaje (tokens, caché, contexto) con un diagnóstico de si el consumo es normal,
 * y por qué falló lo que falló. Todo local (`~/.odesk-agent/consumo/`); no incluye el contenido de las conversaciones.
 */
export function RegistroAsistente({ onCerrar }: { onCerrar: () => void }) {
  const [dias, setDias] = useState(7)
  const [pestana, setPestana] = useState<'consumo' | 'errores'>('consumo')
  const [datos, setDatos] = useState<EntradaBitacora[] | null>(null)
  const [pesados, setPesados] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback((d: number): void => void window.api.core.bitacora(d).then(setDatos).catch(() => setDatos([])), [])
  useEffect(() => cargar(dias), [dias, cargar])
  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])

  const entradas = datos ?? []
  const turnos = useMemo(() => entradas.filter((e): e is EntradaTurno => e.tipo === 'turno'), [entradas])
  const fallos = useMemo(() => entradas.filter((e): e is EntradaFallo => e.tipo === 'fallo'), [entradas])
  const r = useMemo(() => resumir(entradas), [entradas])
  const hallazgos = useMemo(() => diagnosticar(entradas), [entradas])
  const filas = useMemo(() => (pesados ? [...turnos].sort((a, b) => entradaSinCache(b) - entradaSinCache(a)) : turnos).slice(0, 200), [turnos, pesados])
  const periodo = PERIODOS.find((p) => p.dias === dias)!.texto

  const copiar = (): void => {
    void navigator.clipboard.writeText(informeMarkdown(entradas, periodo)).then(() => {
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1800)
    })
  }

  return createPortal(
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="modal rga" role="dialog" aria-modal="true" aria-label="Registro del Asistente">
        <header className="rga-cab">
          <div>
            <h3>Registro del Asistente</h3>
            <p>Qué consume cada mensaje y por qué falla lo que falla. Solo en este equipo, sin el contenido de tus chats.</p>
          </div>
          <div className="rga-acciones">
            <div className="segmentado" role="tablist" aria-label="Periodo">
              {PERIODOS.map((p) => (
                <button key={p.dias} role="tab" aria-selected={dias === p.dias} className={dias === p.dias ? 'on' : ''} onClick={() => setDias(p.dias)}>
                  {p.texto}
                </button>
              ))}
            </div>
            <button onClick={copiar} title="Copia un informe en Markdown (sin contenido de chats) para pegarlo donde quieras">
              {copiado ? '✓ Copiado' : 'Copiar informe'}
            </button>
            <button onClick={() => void window.api.core.bitacoraCarpeta()} title="Abre la carpeta con los archivos del registro">
              Abrir carpeta
            </button>
            <button className="icono" onClick={onCerrar} aria-label="Cerrar">
              ✕
            </button>
          </div>
        </header>

        <div className="rga-pestanas" role="tablist">
          <button role="tab" aria-selected={pestana === 'consumo'} className={pestana === 'consumo' ? 'on' : ''} onClick={() => setPestana('consumo')}>
            Consumo <span className="contador">{turnos.length}</span>
          </button>
          <button role="tab" aria-selected={pestana === 'errores'} className={pestana === 'errores' ? 'on' : ''} onClick={() => setPestana('errores')}>
            Errores <span className={`contador${fallos.length ? ' rojo' : ''}`}>{fallos.length}</span>
          </button>
        </div>

        <div className="rga-cuerpo">
          {datos === null ? (
            <p className="rga-vacio">Cargando…</p>
          ) : pestana === 'consumo' ? (
            <>
              <ul className="rga-diag" aria-label="Diagnóstico">
                {hallazgos.map((h, i) => (
                  <li key={i} className={`g-${h.gravedad}`}>
                    <strong>{h.titulo}</strong>
                    <span>{h.detalle}</span>
                  </li>
                ))}
              </ul>
              {turnos.length > 0 && (
                <>
                  <dl className="rga-kpis">
                    <div><dt>Mensajes</dt><dd>{r.turnos}</dd></div>
                    <div><dt>Enviado</dt><dd>{k(r.entrada)}</dd></div>
                    <div><dt>Recibido</dt><dd>{k(r.salida)}</dd></div>
                    <div><dt>Caché</dt><dd>{Math.round(r.aciertoCache * 100)} %</dd></div>
                    <div><dt>Contexto medio</dt><dd>{k(r.contextoMedio)}</dd></div>
                    <div><dt>Pasos medios</dt><dd>{r.pasosMedios.toFixed(1)}</dd></div>
                  </dl>
                  <div className="rga-orden">
                    <label>
                      <input type="checkbox" checked={pesados} onChange={(e) => setPesados(e.target.checked)} /> Más pesados primero (entrada sin caché)
                    </label>
                  </div>
                  <div className="rga-tabla-caja">
                    <table className="rga-tabla">
                      <thead>
                        <tr>
                          <th>Hora</th>
                          <th>Mensaje</th>
                          <th>Modelo</th>
                          <th className="n" title="Tokens que se enviaron en total (incluye lo leído de caché)">Enviado</th>
                          <th className="n" title="Lo que NO vino de caché: es lo que más pesa en el cupo">Sin caché</th>
                          <th className="n">Recibido</th>
                          <th className="n" title="Tamaño del contexto al terminar: se reenvía en el siguiente mensaje">Contexto</th>
                          <th className="n">Pasos</th>
                          <th className="n">Tiempo</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filas.map((t, i) => (
                          <tr key={`${t.ts}-${i}`} className={`${entradaSinCache(t) > 80_000 ? 'pesado' : ''}${t.estado === 'error' ? ' fallo' : ''}`}>
                            <td>{hora(t.ts)}</td>
                            <td className="msg" title={t.mensaje}>{t.mensaje || '—'}{t.proyecto && <small> · {t.proyecto}</small>}</td>
                            <td>{modeloCorto(t.modelo)}</td>
                            <td className="n">{k(t.entrada)}</td>
                            <td className="n">{k(entradaSinCache(t))}</td>
                            <td className="n">{k(t.salida)}</td>
                            <td className="n">{k(t.contexto)}</td>
                            <td className="n">{t.pasos}</td>
                            <td className="n">{seg(t.duracionMs)}</td>
                            <td>
                              {t.estado}
                              {t.rotacion && <span className="rga-etq" title="El contexto se resumió y siguió en una sesión nueva">resumido</span>}
                              {t.limite && <span className="rga-etq rojo">límite</span>}
                              {!t.reanudada && <span className="rga-etq" title="Primer mensaje de la conversación: la caché empieza en frío">nueva</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          ) : fallos.length === 0 ? (
            <p className="rga-vacio">Sin errores en este periodo.</p>
          ) : (
            <ol className="rga-fallos">
              {fallos.map((f, i) => (
                <li key={`${f.ts}-${i}`}>
                  <div className="rga-fallo-cab">
                    <span className="rga-etq rojo">{ETIQUETA_CAUSA[f.causa]}</span>
                    <time>{hora(f.ts)}</time>
                    {f.modelo && <span>{modeloCorto(f.modelo)}</span>}
                    {f.proyecto && <span>{f.proyecto}</span>}
                  </div>
                  <p className="rga-fallo-msg" title={f.mensaje}>Al enviar: «{f.mensaje || '—'}»</p>
                  <p className="rga-fallo-ayuda">{ayudaCausa(f.causa)}</p>
                  <details>
                    <summary>Motivo exacto</summary>
                    <pre>{f.error}</pre>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
