import { describe, expect, it } from 'vitest'
import { textoNotificacion } from '../src/renderer/agente/notificaciones'
import type { Turno } from '../src/renderer/agente/useAgente'

const turno = (extra: Partial<Turno>): Turno => ({ clave: 'c', prompt: 'p', modo: 'chat', destino: 'Tienda', raiz: 'asistente', eventos: [], parcial: '', estado: 'completado', ...extra }) as Turno
const fin = (texto: string) => ({ tipo: 'fin', ejecucionId: 'e', agente: 'asistente', profundidad: 0, resultado: { estado: 'completado', texto, mensajes: [], uso: { tokensEntrada: 0, tokensSalida: 0 }, pasos: 1 } }) as Turno['eventos'][number]

describe('notificación al terminar el Asistente', () => {
  it('lleva el destino y el principio de la respuesta, sin marcas de markdown', () => {
    const n = textoNotificacion(turno({ eventos: [fin('## Listo\n**Migré** las imágenes. ' + 'x'.repeat(400))] }))!
    expect(n.titulo).toBe('Asistente · Tienda')
    expect(n.cuerpo.startsWith('Listo Migré las imágenes.')).toBe(true)
    expect(n.cuerpo.length).toBeLessThanOrEqual(180)
  })

  it('un error se anuncia como tal; lo cancelado, lo lateral y lo que sigue en curso no avisan', () => {
    expect(textoNotificacion(turno({ estado: 'error', error: 'Sin sesión' }))).toEqual({ titulo: 'Asistente: no terminó · Tienda', cuerpo: 'Sin sesión' })
    expect(textoNotificacion(turno({ estado: 'cancelado' }))).toBeNull()
    expect(textoNotificacion(turno({ lateral: true }))).toBeNull()
    expect(textoNotificacion(turno({ estado: 'en_curso' }))).toBeNull()
  })
})
