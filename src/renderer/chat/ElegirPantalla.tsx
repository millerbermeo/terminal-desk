import { useCallback, useEffect, useRef, useState } from 'react'
import type { FuentePantalla } from '@shared/chat'
import { ICerrar, IPantalla } from './Iconos'
import { controlLlamada } from './llamadas'

type Pestana = 'pantalla' | 'ventana'

/**
 * Selector de qué compartir, como el de Meet: «Toda la pantalla» o «Una ventana», con miniaturas que se refrescan mientras está
 * abierto. Doble clic o Intro comparte; Esc cierra.
 */
export function ElegirPantalla({ alCerrar }: { alCerrar: () => void }) {
  const [fuentes, setFuentes] = useState<FuentePantalla[] | null>(null)
  const [error, setError] = useState('')
  const [pestana, setPestana] = useState<Pestana>('pantalla')
  const [elegida, setElegida] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)

  const cargar = useCallback(async (primera: boolean): Promise<boolean> => {
    try {
      const { fuentes: f, refrescar } = await controlLlamada.fuentesPantalla()
      setFuentes(f)
      if (primera) {
        // Con una sola pantalla se abre en «Una ventana» si hay ventanas (lo más común es compartir una); si no, en pantalla.
        const pantallas = f.filter((x) => x.tipo === 'pantalla')
        const tipo: Pestana = pantallas.length ? 'pantalla' : 'ventana'
        setPestana(tipo)
        setElegida(f.find((x) => x.tipo === tipo)?.id ?? null)
      }
      setError('')
      return refrescar
    } catch (err) {
      setError((err as Error).message || 'No se pudieron listar las pantallas.')
      if (primera) setFuentes([])
      return false
    }
  }, [])

  useEffect(() => {
    // Miniaturas vivas mientras se elige (salvo en Wayland, donde cada listado abre el diálogo del sistema).
    let t: number | undefined
    let vivo = true
    void cargar(true).then((refrescar) => {
      if (vivo && refrescar) t = window.setInterval(() => void cargar(false), 3000)
    })
    return () => {
      vivo = false
      window.clearInterval(t)
    }
  }, [cargar])

  useEffect(() => raiz.current?.focus(), [])

  const visibles = (fuentes ?? []).filter((f) => f.tipo === pestana)
  const cuenta = (t: Pestana): number => (fuentes ?? []).filter((f) => f.tipo === t).length

  const compartir = async (id = elegida): Promise<void> => {
    if (!id || enviando) return
    setEnviando(true)
    alCerrar()
    await controlLlamada.compartirPantalla(id)
  }

  return (
    <div
      className="ch-elegir-fondo"
      onClick={(e) => e.target === e.currentTarget && alCerrar()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          alCerrar()
        } else if (e.key === 'Enter' && elegida) void compartir()
      }}
    >
      <div className="ch-elegir" role="dialog" aria-modal="true" aria-labelledby="ch-elegir-titulo" tabIndex={-1} ref={raiz}>
        <header>
          <div>
            <h3 id="ch-elegir-titulo">Compartir pantalla</h3>
            <p>La otra persona verá lo que elijas hasta que dejes de compartir.</p>
          </div>
          <button className="ch-boton-redondo ch-boton-tenue" onClick={alCerrar} aria-label="Cerrar">
            <ICerrar />
          </button>
        </header>

        <div className="ch-elegir-pestanas" role="tablist">
          {(['pantalla', 'ventana'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={pestana === t}
              className={pestana === t ? 'activa' : ''}
              onClick={() => {
                setPestana(t)
                setElegida((fuentes ?? []).find((f) => f.tipo === t)?.id ?? null)
              }}
            >
              {t === 'pantalla' ? 'Toda la pantalla' : 'Una ventana'} <span>{cuenta(t)}</span>
            </button>
          ))}
        </div>

        <div className="ch-elegir-rejilla" role="listbox" aria-label={pestana === 'pantalla' ? 'Pantallas' : 'Ventanas'}>
          {fuentes === null ? (
            <span className="ch-giro ch-giro-grande" aria-label="Buscando pantallas" />
          ) : visibles.length === 0 ? (
            <p className="ch-elegir-vacio">{error || (pestana === 'pantalla' ? 'No se encontraron pantallas.' : 'No hay ventanas abiertas para compartir.')}</p>
          ) : (
            visibles.map((f) => (
              <button
                key={f.id}
                role="option"
                aria-selected={elegida === f.id}
                className={`ch-elegir-fuente${elegida === f.id ? ' elegida' : ''}`}
                onClick={() => setElegida(f.id)}
                onDoubleClick={() => void compartir(f.id)}
                title={f.nombre}
              >
                <span className="ch-elegir-mini">{f.miniatura ? <img src={f.miniatura} alt="" draggable={false} /> : <IPantalla tam={32} />}</span>
                <span className="ch-elegir-nombre">
                  {f.icono && <img src={f.icono} alt="" />}
                  <span>{f.nombre}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <footer>
          <button className="ch-boton-texto" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="ch-boton-primario" onClick={() => void compartir()} disabled={!elegida || enviando}>
            Compartir
          </button>
        </footer>
      </div>
    </div>
  )
}
