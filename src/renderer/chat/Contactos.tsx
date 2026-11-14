import { useState, type FormEvent } from 'react'
import type { ContactoChat } from '@shared/chat'
import { almacenChat, type VistaChat } from './almacen'
import { Avatar } from './Avatar'
import { confirmar } from '../confirmar'
import { controlLlamada } from './llamadas'

function Fila({ c, children, alAbrir }: { c: ContactoChat; children: React.ReactNode; alAbrir?: () => void }) {
  return (
    <li className="ch-contacto">
      <button className="ch-contacto-datos" onClick={alAbrir} disabled={!alAbrir} aria-label={alAbrir ? `Abrir chat con ${c.usuario.nombre}` : c.usuario.nombre}>
        <Avatar usuario={c.usuario} enLinea={c.usuario.enLinea} />
        <span className="ch-contacto-nombre">
          <strong>{c.usuario.nombre}</strong>
          <span>{c.usuario.email}</span>
        </span>
      </button>
      <span className="ch-contacto-acciones">{children}</span>
    </li>
  )
}

export function Contactos({ vista, alAbrirChat }: { vista: VistaChat; alAbrirChat: (conversacionId: string) => void }) {
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [nombre, setNombre] = useState<string | null>(null)
  const recibidas = vista.contactos.filter((c) => c.estado === 'recibida')
  const enviadas = vista.contactos.filter((c) => c.estado === 'enviada')
  const aceptados = vista.contactos.filter((c) => c.estado === 'aceptado')

  const solicitar = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const v = email.trim()
    if (!v || enviando) return
    setEnviando(true)
    setAviso('')
    const r = await almacenChat.solicitar(v)
    setEnviando(false)
    if (!r) return // el error ya se muestra arriba
    setEmail('')
    setAviso(r === 'ya_contacto' ? 'Esa persona ya es tu contacto.' : 'Solicitud enviada. Si esa persona tiene cuenta la verá en su chat; si no, le llegó una invitación por correo.')
  }

  const abrir = async (usuarioId: string): Promise<void> => {
    const id = await almacenChat.abrirCon(usuarioId)
    if (id) alAbrirChat(id)
  }

  return (
    <div className="ch-contactos">
      <form className="ch-agregar" onSubmit={(e) => void solicitar(e)}>
        <label htmlFor="ch-email">Agregar contacto por correo</label>
        <div>
          <input id="ch-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@correo.com" autoComplete="off" maxLength={254} required />
          <button className="primario" type="submit" disabled={enviando || !email.trim()}>
            {enviando ? 'Enviando…' : 'Invitar'}
          </button>
        </div>
        {aviso && (
          <p className="ch-aviso" role="status">
            {aviso}
          </p>
        )}
      </form>

      {recibidas.length > 0 && (
        <section aria-label="Solicitudes recibidas">
          <h3>Solicitudes ({recibidas.length})</h3>
          <ul>
            {recibidas.map((c) => (
              <Fila key={c.id} c={c}>
                <button className="primario" onClick={() => void almacenChat.responder(c.id, true)}>
                  Aceptar
                </button>
                <button onClick={() => void almacenChat.responder(c.id, false)}>Rechazar</button>
                <button className="peligro" title="Bloquear" onClick={() => void almacenChat.bloquear(c.usuario.id, true)} aria-label={`Bloquear a ${c.usuario.nombre}`}>
                  ⛔
                </button>
              </Fila>
            ))}
          </ul>
        </section>
      )}

      {enviadas.length > 0 && (
        <section aria-label="Solicitudes enviadas">
          <h3>Pendientes de respuesta</h3>
          <ul>
            {enviadas.map((c) => (
              <Fila key={c.id} c={c}>
                <button onClick={() => void almacenChat.eliminarContacto(c.id)}>Cancelar</button>
              </Fila>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Contactos">
        <h3>Contactos ({aceptados.length})</h3>
        {aceptados.length === 0 ? (
          <p className="ch-nada">Aún no tienes contactos. Invita a alguien con su correo: cuando acepte, podrán chatear y llamarse.</p>
        ) : (
          <ul>
            {aceptados.map((c) => (
              <Fila key={c.id} c={c} alAbrir={() => void abrir(c.usuario.id)}>
                <button className="icono" title="Llamada de voz" aria-label={`Llamar a ${c.usuario.nombre}`} disabled={vista.conexion !== 'conectado'} onClick={() => void controlLlamada.llamar(c.usuario, false)}>
                  📞
                </button>
                <button className="icono" title="Videollamada" aria-label={`Videollamada con ${c.usuario.nombre}`} disabled={vista.conexion !== 'conectado'} onClick={() => void controlLlamada.llamar(c.usuario, true)}>
                  🎥
                </button>
                <button className="icono peligro" title="Eliminar contacto" aria-label={`Eliminar a ${c.usuario.nombre}`} onClick={() => void confirmar({ titulo: `¿Eliminar a ${c.usuario.nombre}?`, texto: 'Dejará de ser tu contacto: se conserva el historial, pero ya no podrán escribirse ni llamarse.', etiqueta: 'Eliminar', tono: 'peligro' }).then((si) => { if (si) void almacenChat.eliminarContacto(c.id) })}>
                  ✕
                </button>
              </Fila>
            ))}
          </ul>
        )}
      </section>

      {vista.bloqueados.length > 0 && (
        <section aria-label="Bloqueados">
          <h3>Bloqueados</h3>
          <ul>
            {vista.bloqueados.map((u) => (
              <Fila key={u.id} c={{ id: u.id, usuario: u, estado: 'aceptado', desde: '' }}>
                <button onClick={() => void almacenChat.bloquear(u.id, false)}>Desbloquear</button>
              </Fila>
            ))}
          </ul>
        </section>
      )}

      {vista.yo && (
        <section aria-label="Mi perfil" className="ch-perfil">
          <h3>Mi perfil en el chat</h3>
          <label htmlFor="ch-nombre">Nombre que ven tus contactos</label>
          <div>
            <input id="ch-nombre" value={nombre ?? vista.yo.nombrePropio ?? ''} onChange={(e) => setNombre(e.target.value)} placeholder={vista.yo.email.split('@')[0]} maxLength={60} />
            <button
              disabled={nombre === null || nombre === (vista.yo.nombrePropio ?? '')}
              onClick={() => void almacenChat.guardarPerfil({ nombre: nombre!.trim() || null }).then(() => setNombre(null))}
            >
              Guardar
            </button>
          </div>
          <label className="ch-check">
            <input type="checkbox" checked={vista.yo.mostrarPresencia} onChange={(e) => void almacenChat.guardarPerfil({ mostrarPresencia: e.target.checked })} />
            Mostrar cuándo estoy en línea y mi última conexión
          </label>
          <p className="ch-nada">Tu correo ({vista.yo.email}) lo ven las personas a las que invitas o que te invitan.</p>
        </section>
      )}
    </div>
  )
}
