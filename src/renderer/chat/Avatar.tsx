import type { UsuarioChat } from '@shared/chat'

/** Pares de degradado (claro → oscuro) al estilo de los contactos de Apple. */
const COLORES: [string, string][] = [
  ['#ff8a8a', '#e5484d'],
  ['#ffb36b', '#f76b15'],
  ['#f5d76e', '#d4a20b'],
  ['#6fdba0', '#28935f'],
  ['#7ab6ff', '#3070e0'],
  ['#c49bff', '#7d45c4'],
  ['#ff8fcf', '#cc3d95'],
  ['#5fd6d3', '#0e9592']
]

/** Círculo con la inicial; el color sale del id, así una persona siempre se ve igual. */
export function Avatar({ usuario, tam = 36, enLinea }: { usuario: Pick<UsuarioChat, 'id' | 'nombre'>; tam?: number; enLinea?: boolean }) {
  let h = 0
  for (const c of usuario.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const [a, b] = COLORES[h % COLORES.length]!
  const inicial = [...(usuario.nombre.trim() || '?')][0]!.toUpperCase()
  return (
    <span className="ch-avatar" style={{ width: tam, height: tam, background: `linear-gradient(160deg, ${a}, ${b})`, fontSize: Math.round(tam * 0.42) }} aria-hidden>
      {inicial}
      {enLinea && <span className="ch-avatar-linea" />}
    </span>
  )
}

/** Color principal del avatar de alguien (fondo de la pantalla de llamada). */
export function colorDe(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORES[h % COLORES.length]![1]
}
