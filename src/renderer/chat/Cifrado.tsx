import { useEffect, useState, type FormEvent } from 'react'
import type { CifradoContacto, EstadoCifrado, UsuarioChat } from '@shared/chat'
import { almacenChat } from './almacen'
import { IAlerta, ICandado, ICerrar, IEscudo } from './Iconos'

const FRASE_MIN = 12

const mensaje = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Problema de la frase antes de enviarla (main lo vuelve a comprobar). */
function problemaFrase(frase: string, repetida: string): string {
  if ([...frase.normalize('NFKC')].length < FRASE_MIN) return `Usa al menos ${FRASE_MIN} caracteres (mejor varias palabras).`
  if (new Set(frase.toLowerCase()).size < 5) return 'La frase es demasiado simple.'
  if (frase !== repetida) return 'Las dos frases no coinciden.'
  return ''
}

/** Campo de frase con botón para mostrarla. */
function CampoFrase({ id, valor, cambiar, etiqueta, nueva }: { id: string; valor: string; cambiar: (v: string) => void; etiqueta: string; nueva?: boolean }) {
  const [ver, setVer] = useState(false)
  return (
    <label className="ch-cifrado-campo" htmlFor={id}>
      <span>{etiqueta}</span>
      <div>
        <input id={id} type={ver ? 'text' : 'password'} value={valor} onChange={(e) => cambiar(e.target.value)} autoComplete={nueva ? 'new-password' : 'current-password'} spellCheck={false} maxLength={200} />
        <button type="button" className="ch-cifrado-ver" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Ocultar frase' : 'Mostrar frase'}>
          {ver ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </label>
  )
}

/**
 * Pantalla que ocupa el chat hasta que este equipo tiene las claves abiertas: crearlas (primera vez), abrirlas con la frase (otro
 * equipo o tras reinstalar) o, si se olvidó la frase, crear unas nuevas sabiendo lo que se pierde.
 */
export function ConfigurarCifrado({ estado }: { estado: EstadoCifrado }) {
  const [modo, setModo] = useState<'normal' | 'olvido'>('normal')
  const [frase, setFrase] = useState('')
  const [repetida, setRepetida] = useState('')
  const [entendido, setEntendido] = useState(false)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const crear = estado.estado === 'sin-claves' || modo === 'olvido'

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    if (crear) {
      const p = problemaFrase(frase, repetida)
      if (p) return setError(p)
      if (!entendido) return setError('Confirma que guardarás la frase en un lugar seguro.')
    }
    setOcupado(true)
    try {
      await almacenChat.claves(modo === 'olvido' ? 'cifradoRestablecer' : crear ? 'cifradoCrear' : 'cifradoDesbloquear', frase)
      setFrase('')
      setRepetida('')
    } catch (err) {
      setError(mensaje(err))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="ch-cifrado">
      <form className="ch-cifrado-tarjeta" onSubmit={(e) => void enviar(e)}>
        <div className="ch-cifrado-icono" aria-hidden>
          {modo === 'olvido' ? <IAlerta tam={30} /> : <ICandado tam={30} />}
        </div>
        {modo === 'olvido' ? (
          <>
            <h2>Crear claves nuevas</h2>
            <p>
              Sin tu frase nadie puede abrir tus claves actuales, tampoco nosotros. Si creas unas nuevas, <strong>los mensajes cifrados anteriores dejarán de poder leerse</strong> en los equipos que no
              tengan tu clave, y tus contactos verán que tu clave de seguridad cambió.
            </p>
          </>
        ) : crear ? (
          <>
            <h2>Cifrado de extremo a extremo</h2>
            <p>
              Tus mensajes, archivos, llamadas y videollamadas se cifran en este equipo y solo los puede abrir la otra persona. El servidor guarda una copia de tu clave cerrada con una{' '}
              <strong>frase de seguridad</strong> que solo tú conoces: la necesitarás para leer tus chats en otro equipo.
            </p>
          </>
        ) : (
          <>
            <h2>Abre tus chats cifrados</h2>
            <p>
              {estado.cambioEnOtroEquipo
                ? 'Tu clave de cifrado cambió desde otro equipo. Escribe tu frase de seguridad para usar la nueva aquí.'
                : 'Escribe tu frase de seguridad para abrir tus claves en este equipo.'}
            </p>
          </>
        )}

        <CampoFrase id="ch-frase" valor={frase} cambiar={setFrase} etiqueta={crear ? 'Frase de seguridad nueva' : 'Frase de seguridad'} nueva={crear} />
        {crear && (
          <>
            <CampoFrase id="ch-frase-2" valor={repetida} cambiar={setRepetida} etiqueta="Repite la frase" nueva />
            <label className="ch-check">
              <input type="checkbox" checked={entendido} onChange={(e) => setEntendido(e.target.checked)} />
              Entiendo que si la olvido no hay forma de recuperarla.
            </label>
          </>
        )}
        {!estado.llaveroSeguro && <p className="ch-cifrado-nota">Este equipo no tiene un llavero seguro del sistema: la clave no se guardará en disco y tendrás que escribir la frase cada vez que abras la app.</p>}
        {error && (
          <p className="ch-cifrado-error" role="alert">
            {error}
          </p>
        )}
        <button className="primario" type="submit" disabled={ocupado || !frase}>
          {ocupado ? 'Un momento…' : modo === 'olvido' ? 'Crear claves nuevas' : crear ? 'Activar cifrado' : 'Abrir'}
        </button>
        {estado.estado === 'bloqueado' && (
          <button
            type="button"
            className="ch-cifrado-enlace"
            onClick={() => {
              setModo((m) => (m === 'olvido' ? 'normal' : 'olvido'))
              setError('')
              setFrase('')
              setRepetida('')
            }}
          >
            {modo === 'olvido' ? 'Volver: recuerdo mi frase' : 'Olvidé mi frase'}
          </button>
        )}
      </form>
    </div>
  )
}

/** Estado del cifrado con un contacto; se vuelve a pedir cuando alguien publica claves nuevas. */
export function useCifradoContacto(usuarioId: string, version: number, miClave: string | undefined): [CifradoContacto | null, (c: CifradoContacto) => void] {
  const [c, setC] = useState<CifradoContacto | null>(null)
  useEffect(() => {
    let vivo = true
    almacenChat
      .cifradoContacto(usuarioId)
      .then((r) => vivo && setC(r))
      .catch(() => vivo && setC(null))
    return () => {
      vivo = false
    }
  }, [usuarioId, version, miClave])
  return [c, setC]
}

/** 60 cifras en 12 grupos de 5, como se leen en voz alta. */
function Numero({ numero }: { numero: string }) {
  const grupos = numero.match(/\d{5}/g) ?? []
  return (
    <div className="ch-cifrado-numero" aria-label="Número de seguridad">
      {grupos.map((g, i) => (
        <code key={i}>{g}</code>
      ))}
    </div>
  )
}

/** Aviso bajo la cabecera del hilo cuando no se puede escribir con seguridad (clave nueva o sin claves). */
export function AvisoCifrado({ otro, estado, alRevisar }: { otro: UsuarioChat; estado: CifradoContacto | null; alRevisar: () => void }) {
  if (!estado || estado.estado === 'confiable' || estado.estado === 'verificada') return null
  return (
    <div className={`ch-confirmar ch-cifrado-aviso ${estado.estado}`} role="status">
      <IAlerta tam={16} />
      <span>
        {estado.estado === 'nueva'
          ? `La clave de seguridad de ${otro.nombre} cambió (reinstaló la app, cambió de equipo… o alguien intenta hacerse pasar por esa persona). No se enviará nada hasta que la revises.`
          : `${otro.nombre} aún no activó el cifrado de extremo a extremo: no podrás escribirle ni llamarle hasta que actualice la app.`}
      </span>
      {estado.estado === 'nueva' && <button onClick={alRevisar}>Revisar</button>}
    </div>
  )
}

/** Panel «Cifrado» de un chat: número de seguridad para comparar, marcar como verificado y aceptar una clave nueva. */
export function PanelSeguridad({ otro, estado, cambiar, cerrar }: { otro: UsuarioChat; estado: CifradoContacto | null; cambiar: (c: CifradoContacto) => void; cerrar: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  const hacer = async (f: () => Promise<CifradoContacto | undefined>): Promise<void> => {
    setOcupado(true)
    try {
      const r = await f()
      if (r) cambiar(r)
    } finally {
      setOcupado(false)
    }
  }
  return (
    <div className="ch-cifrado-panel" role="dialog" aria-label={`Cifrado con ${otro.nombre}`}>
      <header>
        <IEscudo tam={18} />
        <strong>Cifrado de extremo a extremo</strong>
        <button className="icono" onClick={cerrar} aria-label="Cerrar">
          <ICerrar tam={14} />
        </button>
      </header>
      {!estado ? (
        <p>Comprobando…</p>
      ) : estado.estado === 'sin-claves' ? (
        <p>{otro.nombre} aún no activó el cifrado. Cuando actualice la app y cree su frase de seguridad podréis escribiros.</p>
      ) : (
        <>
          <p>
            Los mensajes, archivos, llamadas y videollamadas con {otro.nombre} solo los podéis abrir vosotros. Para descartar que alguien (incluido el servidor) se haya colado en medio, comparad
            este número en persona o por otro medio: tiene que ser idéntico en los dos equipos.
          </p>
          {estado.numero && <Numero numero={estado.numero} />}
          {estado.estado === 'nueva' ? (
            <>
              <p className="ch-cifrado-error">La clave de {otro.nombre} cambió desde la última vez. Comprueba el número antes de aceptarla.</p>
              <button className="primario" disabled={ocupado} onClick={() => void hacer(() => almacenChat.aceptarClave(otro.id))}>
                Aceptar la clave nueva
              </button>
            </>
          ) : (
            <label className="ch-check">
              <input type="checkbox" checked={estado.estado === 'verificada'} disabled={ocupado} onChange={(e) => void hacer(() => almacenChat.verificarContacto(otro.id, e.target.checked))} />
              Comprobé que el número coincide
            </label>
          )}
        </>
      )}
    </div>
  )
}

/** En el perfil: estado del cifrado propio y cambiar la frase de seguridad. */
export function AjustesCifrado({ estado }: { estado: EstadoCifrado | null }) {
  const [abierto, setAbierto] = useState(false)
  const [frase, setFrase] = useState('')
  const [repetida, setRepetida] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  if (!estado || estado.estado !== 'listo') return null
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const p = problemaFrase(frase, repetida)
    if (p) return setAviso(p)
    setOcupado(true)
    try {
      await almacenChat.cambiarFrase(frase)
      setAviso('Frase cambiada. Úsala a partir de ahora en tus otros equipos.')
      setFrase('')
      setRepetida('')
      setAbierto(false)
    } catch (err) {
      setAviso(mensaje(err))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <div className="ch-cifrado-ajustes">
      <p className="ch-nada">
        <ICandado tam={13} /> Chats cifrados de extremo a extremo. Tu clave: <code>{estado.claveId?.slice(0, 16).replace(/(.{4})(?!$)/g, '$1 ')}</code>
      </p>
      {abierto ? (
        <form onSubmit={(e) => void enviar(e)}>
          <CampoFrase id="ch-frase-nueva" valor={frase} cambiar={setFrase} etiqueta="Frase nueva" nueva />
          <CampoFrase id="ch-frase-nueva-2" valor={repetida} cambiar={setRepetida} etiqueta="Repite la frase" nueva />
          <div>
            <button type="button" onClick={() => (setAbierto(false), setAviso(''))}>
              Cancelar
            </button>
            <button className="primario" type="submit" disabled={ocupado || !frase}>
              {ocupado ? 'Un momento…' : 'Cambiar frase'}
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => (setAbierto(true), setAviso(''))}>Cambiar frase de seguridad</button>
      )}
      {aviso && <p className="ch-nada">{aviso}</p>}
    </div>
  )
}
