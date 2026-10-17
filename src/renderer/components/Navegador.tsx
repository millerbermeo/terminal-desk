import { useCallback, useEffect, useState } from 'react'
import { normalizarUrl, type ServidorLocal } from '@shared/navegador'
import { mensajeDe } from '../tareas/useTareas'
import { EstadoVacio } from './EstadoVacio'
import { IconoGlobo, IconoReiniciar } from './Iconos'

const CLAVE_RECIENTES = 'navegador:recientes'
const CLAVE_FAVORITOS = 'navegador:favoritos'
const MAX_RECIENTES = 8

const leer = (clave: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(clave) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const guardar = (clave: string, v: string[]): void => {
  try {
    localStorage.setItem(clave, JSON.stringify(v))
  } catch {
    /* sin almacenamiento: no se recuerdan */
  }
}

/** Lanzador del navegador integrado: abre una dirección en una ventana propia o en el navegador del sistema, y detecta los servidores locales en marcha. */
export function Navegador({ visible }: { visible: boolean }) {
  const [texto, setTexto] = useState('')
  const [servidores, setServidores] = useState<ServidorLocal[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const [recientes, setRecientes] = useState<string[]>(() => leer(CLAVE_RECIENTES))
  const [favoritos, setFavoritos] = useState<string[]>(() => leer(CLAVE_FAVORITOS))

  const buscar = useCallback(async (): Promise<void> => {
    setBuscando(true)
    try {
      setServidores(await window.api.navegador.puertos())
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setBuscando(false)
    }
  }, [])
  // Se vuelve a buscar al mostrar la vista y cada pocos segundos mientras está visible.
  useEffect(() => {
    if (!visible) return
    void buscar()
    const t = window.setInterval(() => void buscar(), 6000)
    return () => window.clearInterval(t)
  }, [visible, buscar])

  const recordar = (url: string): void => {
    const nuevos = [url, ...recientes.filter((r) => r !== url)].slice(0, MAX_RECIENTES)
    setRecientes(nuevos)
    guardar(CLAVE_RECIENTES, nuevos)
  }
  const abrir = async (entrada: string, enSistema = false): Promise<void> => {
    const n = normalizarUrl(entrada)
    if ('error' in n) return setError(n.error)
    try {
      if (enSistema) await window.api.navegador.externo(n.url)
      else await window.api.navegador.abrir(n.url)
      setError('')
      recordar(n.url)
    } catch (e) {
      setError(mensajeDe(e))
    }
  }
  const alternarFavorito = (url: string): void => {
    const nuevos = favoritos.includes(url) ? favoritos.filter((f) => f !== url) : [url, ...favoritos].slice(0, 20)
    setFavoritos(nuevos)
    guardar(CLAVE_FAVORITOS, nuevos)
  }

  const fila = (url: string, titulo?: string, extra?: React.ReactNode) => (
    <div className="cfg-proyecto vc-rama-fila nav-fila" key={url}>
      <IconoGlobo />
      <strong className="vc-rama-nombre">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</strong>
      {titulo && <span className="rec-desc">{titulo}</span>}
      {!titulo && <span className="rec-desc" />}
      {extra}
      <span className="vc-acciones visibles">
        <button className="icono" onClick={() => alternarFavorito(url)} title={favoritos.includes(url) ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-label="Favorito">
          {favoritos.includes(url) ? '★' : '☆'}
        </button>
        <button onClick={() => void abrir(url, true)} title="Abrir en el navegador del sistema">
          En el sistema
        </button>
        <button className="primario" onClick={() => void abrir(url)}>
          Abrir
        </button>
      </span>
    </div>
  )

  return (
    <main className="navegador" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="vc-pagina">
        <header className="cfg-cab">
          <h2>Navegador</h2>
        </header>
        <p className="cfg-intro">Abre lo que estás desarrollando en una ventana propia, con barra de direcciones y herramientas de desarrollo, sin salir de la aplicación. También puedes abrirlo en tu navegador de siempre.</p>
        <form
          className="nav-lanzador"
          onSubmit={(e) => {
            e.preventDefault()
            void abrir(texto)
          }}
        >
          <input value={texto} onChange={(e) => (setTexto(e.target.value), setError(''))} placeholder="localhost:3000, 5173 o ejemplo.com" spellCheck={false} aria-label="Dirección" />
          <button className="primario" type="submit" disabled={!texto.trim()}>
            Abrir en ventana
          </button>
          <button type="button" disabled={!texto.trim()} onClick={() => void abrir(texto, true)}>
            En el navegador del sistema
          </button>
        </form>
        {error && <p className="tareas-error-texto" role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

        <section className="cfg-grupo">
          <div className="cfg-grupo-cab">
            <h3>
              Servidores locales <small>{servidores?.length ?? 0}</small>
            </h3>
            <button className="icono" onClick={() => void buscar()} disabled={buscando} title="Buscar de nuevo" aria-label="Buscar de nuevo">
              <IconoReiniciar />
            </button>
          </div>
          {servidores === null ? (
            <p className="tareas-vacio">Buscando…</p>
          ) : servidores.length === 0 ? (
            <EstadoVacio variante="compacto" icono={<IconoGlobo />} titulo="No hay servidores en marcha" texto="Arranca tu proyecto (por ejemplo, pnpm dev en una terminal) y aparecerá aquí en unos segundos. Se buscan los puertos habituales: 3000, 4200, 5173, 8000, 8080…" />
          ) : (
            servidores.map((s) => fila(s.url, s.titulo, <span className="chip chip-ok">en marcha</span>))
          )}
        </section>

        {favoritos.length > 0 && (
          <section className="cfg-grupo">
            <div className="cfg-grupo-cab">
              <h3>
                Favoritos <small>{favoritos.length}</small>
              </h3>
            </div>
            {favoritos.map((u) => fila(u))}
          </section>
        )}
        {recientes.length > 0 && (
          <section className="cfg-grupo">
            <div className="cfg-grupo-cab">
              <h3>Recientes</h3>
              <button
                className="peligro"
                onClick={() => {
                  setRecientes([])
                  guardar(CLAVE_RECIENTES, [])
                }}
              >
                Borrar
              </button>
            </div>
            {recientes.map((u) => fila(u))}
          </section>
        )}
      </div>
    </main>
  )
}
