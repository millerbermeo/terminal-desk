import type { BloqueContenido, Mensaje } from '@shared/core/agente'
import type { HerramientaDef } from '@shared/core/herramientas'

// Sin tokenizador local: estimación conservadora (~3,5 caracteres por token en español/código).
const CARACTERES_POR_TOKEN = 3.5
const SOBRECOSTE_MENSAJE = 4

export const estimarTokens = (texto: string): number => Math.ceil(texto.length / CARACTERES_POR_TOKEN)

export function tokensBloque(b: BloqueContenido): number {
  switch (b.tipo) {
    case 'texto':
      return estimarTokens(b.texto)
    case 'herramienta_uso':
      return estimarTokens(b.nombre + JSON.stringify(b.entrada))
    case 'herramienta_resultado':
      return estimarTokens(b.texto)
    case 'imagen':
    case 'documento':
      return b.tokens
  }
}

export const tokensMensaje = (m: Mensaje): number => m.contenido.reduce((s, b) => s + tokensBloque(b), SOBRECOSTE_MENSAJE)

export const tokensMensajes = (ms: readonly Mensaje[]): number => ms.reduce((s, m) => s + tokensMensaje(m), 0)

export const tokensHerramientas = (hs: readonly HerramientaDef[]): number => estimarTokens(JSON.stringify(hs))
