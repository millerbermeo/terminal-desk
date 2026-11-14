import type { UsuarioChat } from '@shared/chat'

const COLORES = ['#e5484d', '#f76b15', '#e2b714', '#30a46c', '#3e8ef7', '#8e4ec6', '#d6409f', '#0ea5a4']

/** Círculo con la inicial; el color sale del id, así una persona siempre se ve igual. */
export function Avatar({ usuario, tam = 36, enLinea }: { usuario: Pick<UsuarioChat, 'id' | 'nombre'>; tam?: number; enLinea?: boolean }) {
  let h = 0
  for (const c of usuario.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const inicial = [...(usuario.nombre.trim() || '?')][0]!.toUpperCase()
  return (
    <span className="ch-avatar" style={{ width: tam, height: tam, background: COLORES[h % COLORES.length], fontSize: Math.round(tam * 0.42) }} aria-hidden>
      {inicial}
      {enLinea && <span className="ch-avatar-linea" />}
    </span>
  )
}
