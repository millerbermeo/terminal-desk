/**
 * Qué es un archivo según sus primeros bytes. Con cifrado de extremo a extremo el servidor ya no puede mirarlo: lo comprueba el
 * equipo que lo recibe, tras descifrarlo (copia de `detectar` de `terminal-desk-api/src/chat/archivos.service.ts`). El audio y el
 * video comparten contenedor (webm, mp4): ahí se respeta lo declarado si es de la misma familia.
 */
export function detectarTipo(b: Uint8Array, declarado: string): { mime: string; seguro: boolean } {
  const decl = declarado.toLowerCase().split(';')[0].trim()
  const audio = decl.startsWith('audio/')
  const empieza = (...bytes: number[]): boolean => bytes.every((v, i) => b[i] === v)
  const texto = (desde: number, s: string): boolean => b.length >= desde + s.length && [...s].every((c, i) => b[desde + i] === c.charCodeAt(0))
  if (empieza(0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', seguro: true }
  if (empieza(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', seguro: true }
  if (texto(0, 'GIF8')) return { mime: 'image/gif', seguro: true }
  if (texto(0, 'RIFF') && texto(8, 'WEBP')) return { mime: 'image/webp', seguro: true }
  if (texto(0, 'RIFF') && texto(8, 'WAVE')) return { mime: 'audio/wav', seguro: true }
  if (texto(0, 'OggS')) return { mime: decl === 'video/ogg' ? 'video/ogg' : 'audio/ogg', seguro: true }
  if (empieza(0x1a, 0x45, 0xdf, 0xa3)) return { mime: audio ? 'audio/webm' : 'video/webm', seguro: true }
  if (texto(4, 'ftyp')) return { mime: audio ? 'audio/mp4' : 'video/mp4', seguro: true }
  if (texto(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', seguro: true }
  if (texto(0, '%PDF')) return { mime: 'application/pdf', seguro: false }
  return { mime: 'application/octet-stream', seguro: false }
}
