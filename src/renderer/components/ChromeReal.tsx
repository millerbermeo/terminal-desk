import { useEffect, useState } from 'react'
import type { EstadoChrome, NombreOperacionChrome, OperacionesChrome } from '@shared/chrome'
import { Esqueletos } from './Cargando'
import { IconoAlerta, IconoBasura, IconoCarpetaAbierta, IconoCheck, IconoCopiar, IconoGlobo } from './Iconos'
import { EstadoFila, Monograma, SeccionAjustes, rutaCorta } from './SeccionAjustes'

/** Cuánto falta para que caduque el código, «4:32». */
const restante = (expira: number, ahora: number): string => {
  const s = Math.max(0, Math.round((expira - ahora) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Chrome real del usuario controlado por la IA (herramientas `chrome_*`, también desde los asistentes conectados por MCP): instalar la
 * extensión, emparejarla con un código, apagarlo, y ver/quitar los sitios autorizados. Ver `docs/chrome.md`.
 */
export function ChromeReal() {
  const [estado, setEstado] = useState<EstadoChrome | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [ahora, setAhora] = useState(Date.now())
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    void window.api.chrome.operar('estado', undefined).then(setEstado).catch((e: Error) => setError(e.message))
    return window.api.chrome.onEstado(setEstado)
  }, [])

  // Cuenta atrás del código (y que desaparezca al caducar).
  useEffect(() => {
    if (!estado?.codigo) return
    const id = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(id)
  }, [estado?.codigo])

  const operar = <K extends NombreOperacionChrome>(op: K, entrada: OperacionesChrome[K]['entrada']): void => {
    setOcupado(true)
    setError('')
    void window.api.chrome
      .operar(op, entrada)
      .then((e) => setEstado(e as EstadoChrome))
      .catch((e: Error) => setError(e.message))
      .finally(() => setOcupado(false))
  }

  const copiarDireccion = (): void => {
    void navigator.clipboard.writeText('chrome://extensions').then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    })
  }

  const codigo = estado?.codigo && estado.codigo.expira > ahora ? estado.codigo : undefined
  const emparejada = (estado?.emparejadas.length ?? 0) > 0

  return (
    <SeccionAjustes
      icono={<IconoGlobo />}
      titulo="Chrome: tu navegador real"
      texto={
        <>
          Con la extensión «Odesk Code · Chrome», el Asistente (y los asistentes conectados a Odesk) pueden usar tu Chrome con tus sesiones iniciadas: solo en las pestañas del
          grupo morado «Odesk», cada sitio nuevo se autoriza aquí y ejecutar JavaScript, comprar, pagar, publicar o borrar se confirma antes. Lo que la IA lee de una web se envía
          al modelo.
        </>
      }
      resumen={estado && (estado.conectado ? (estado.pausado ? 'En pausa' : 'Conectado') : emparejada ? 'Emparejado, sin conexión' : 'Sin configurar')}
    >
      {!estado && !error && <Esqueletos cuantos={3} />}
      {estado && (
        <>
          <div className="prov-fila">
            <Monograma nombre="Chrome" />
            <div className="prov-texto">
              <strong>Permitir que la IA use Chrome</strong>
              <span className="prov-detalle prov-nota">
                {estado.conectado
                  ? `${estado.navegador ?? 'Chrome'} · ${estado.pestanas.length === 1 ? '1 pestaña' : `${estado.pestanas.length} pestañas`} en el grupo «Odesk»${estado.pausado ? ' · pausado desde la extensión' : ''}`
                  : emparejada
                    ? 'Abre Chrome: la extensión se conecta sola en unos segundos.'
                    : 'Instala la extensión y emparéjala (pasos abajo).'}
              </span>
            </div>
            <EstadoFila
              tipo={estado.conectado && !estado.pausado && estado.activo ? 'ok' : estado.conectado || emparejada ? 'aviso' : 'neutro'}
              texto={!estado.activo ? 'Apagado' : estado.conectado ? (estado.pausado ? 'En pausa' : 'Conectado') : emparejada ? 'Sin conexión' : 'Sin emparejar'}
            />
            <div className="prov-acciones visible">
              <button className={`prov-btn${estado.activo ? '' : ' acento'}`} disabled={ocupado} onClick={() => operar('activar', { activo: !estado.activo })} title={estado.activo ? 'Las herramientas chrome_* responderán que está apagado' : 'Volver a permitirlo'}>
                {estado.activo ? 'Apagar' : 'Activar'}
              </button>
            </div>
          </div>

          <div className="prov-fila">
            <Monograma nombre="1" />
            <div className="prov-texto">
              <strong>1. Instala la extensión</strong>
              <span className="prov-detalle prov-nota">
                En Chrome abre <code>chrome://extensions</code>, activa «Modo de desarrollador», pulsa «Cargar descomprimida» y elige{' '}
                <code title={estado.carpetaExtension}>{rutaCorta(estado.carpetaExtension)}</code>. También vale en Edge, Brave y otros navegadores basados en Chromium.
              </span>
            </div>
            <div className="prov-acciones visible">
              <button className={`prov-btn${copiado ? ' hecho' : ''}`} onClick={copiarDireccion} aria-live="polite" title="Copia chrome://extensions para pegarlo en la barra de direcciones">
                {copiado ? <IconoCheck /> : <IconoCopiar />}
                {copiado ? 'Copiado' : 'Copiar dirección'}
              </button>
              <button className="prov-btn" disabled={ocupado} onClick={() => operar('abrirCarpeta', undefined)} title="Abre la carpeta de la extensión">
                <IconoCarpetaAbierta /> Carpeta
              </button>
            </div>
          </div>

          <div className="prov-fila">
            <Monograma nombre="2" />
            <div className="prov-texto">
              <strong>2. Empareja la extensión</strong>
              <span className="prov-detalle prov-nota">
                {codigo ? (
                  <>
                    Escribe este código en la extensión (botón de Odesk en la barra de Chrome):{' '}
                    <code className="chrome-codigo" aria-label={`Código ${codigo.codigo.split('').join(' ')}`}>
                      {codigo.codigo.slice(0, 3)} {codigo.codigo.slice(3)}
                    </code>{' '}
                    · caduca en {restante(codigo.expira, ahora)}
                  </>
                ) : emparejada ? (
                  `Emparejada con ${estado.emparejadas.map((x) => x.nombre).join(', ')}.`
                ) : (
                  'Genera un código y escríbelo en la extensión. Solo hace falta una vez por navegador.'
                )}
              </span>
            </div>
            <div className="prov-acciones visible">
              {codigo ? (
                <button className="prov-btn" disabled={ocupado} onClick={() => operar('cancelarEmparejar', undefined)}>
                  Cancelar
                </button>
              ) : (
                <button className={`prov-btn${emparejada ? '' : ' acento'}`} disabled={ocupado || estado.puerto === null} onClick={() => operar('emparejar', undefined)}>
                  {emparejada ? 'Emparejar otro' : 'Emparejar'}
                </button>
              )}
              {emparejada && !codigo && (
                <button className="prov-btn" disabled={ocupado} onClick={() => operar('olvidar', {})} title="El token deja de valer y la extensión se desconecta">
                  Desemparejar
                </button>
              )}
            </div>
          </div>

          {estado.sitios.length > 0 && (
            <div className="prov-fila chrome-sitios">
              <Monograma nombre="Sitios" />
              <div className="prov-texto">
                <strong>Sitios autorizados siempre</strong>
                <ul className="chrome-lista">
                  {estado.sitios.map((s) => (
                    <li key={s}>
                      <code>{s}</code>
                      <button className="prov-btn" disabled={ocupado} onClick={() => operar('quitarSitio', { origen: s })} title="La próxima vez se volverá a preguntar" aria-label={`Quitar ${s}`}>
                        <IconoBasura />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {estado.error && (
            <div className="prov-alerta" role="alert">
              <IconoAlerta />
              {estado.error}
            </div>
          )}
        </>
      )}
      {error && (
        <div className="prov-alerta" role="alert">
          <IconoAlerta />
          {error}
        </div>
      )}
    </SeccionAjustes>
  )
}
