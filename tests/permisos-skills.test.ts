import { describe, expect, it } from 'vitest'
import type { EventoAgente } from '@shared/core/agente'
import { explicarDenegacion } from '../src/renderer/agente/permisos-denegados'
import { construirTrabajo } from '../src/renderer/agente/trabajo'

describe('explicarDenegacion', () => {
  it('permisos del sistema sobre un archivo: dice qué permiso falta', () => {
    const d = explicarDenegacion({ herramienta: 'Read', entrada: { file_path: '/srv/datos/x.log' }, texto: "EACCES: permission denied, open '/srv/datos/x.log'" })
    expect(d).toMatchObject({ tipo: 'sistema', titulo: 'No tienes permisos sobre este archivo', objetivo: '/srv/datos/x.log' })
    expect(d!.permiso).toContain('lectura (r)')
  })

  it('escribir pide permiso de escritura', () => {
    const d = explicarDenegacion({ herramienta: 'Write', entrada: { file_path: '/etc/x' }, texto: 'EACCES: permission denied, open /etc/x' })
    expect(d!.permiso).toContain('escritura (w)')
  })

  it('reglas, rechazo del usuario, modo autónomo y CLI', () => {
    expect(explicarDenegacion({ texto: 'Una regla de permisos de este proyecto lo deniega.' })!.tipo).toBe('regla')
    expect(explicarDenegacion({ texto: 'El usuario rechazó esta acción.' })!.tipo).toBe('usuario')
    expect(explicarDenegacion({ herramienta: 'Bash', entrada: { command: 'rm -rf /' }, texto: 'Bloqueado en modo autónomo: borra la raíz del sistema. No lo intentes de otra forma.' })).toMatchObject({ tipo: 'autonomo', porque: expect.stringContaining('borra la raíz') })
    expect(explicarDenegacion({ texto: "Claude requested permissions to use Edit, but you haven't granted it yet." })!.permiso).toContain('Ediciones')
  })

  it('guardrails: ruta protegida; los avisos que solo informan no son denegación', () => {
    expect(explicarDenegacion({ herramienta: 'Write', texto: 'no se puede escribir en «.git/config» (metadatos de git)', guardrail: true })).toMatchObject({ tipo: 'guardrail', objetivo: '.git/config' })
    expect(explicarDenegacion({ herramienta: 'Read', texto: 'acceso a credenciales permitido (ya autorizado en esta conversación): leer «.env»', guardrail: true })).toBeNull()
  })

  it('un error cualquiera no es una denegación', () => {
    expect(explicarDenegacion({ herramienta: 'Bash', texto: 'npm ERR! missing script: test' })).toBeNull()
  })
})

describe('skills en el trabajo', () => {
  const ev = (e: Record<string, unknown>): EventoAgente => ({ ejecucionId: 'e', agente: 'asistente', profundidad: 0, ...e }) as EventoAgente
  it('detecta la herramienta Skill (cargando y luego en uso) y la lectura de un SKILL.md sin duplicar', () => {
    const eventos = [
      ev({ tipo: 'inicio', prompt: 'x' }),
      ev({ tipo: 'herramienta_inicio', llamada: { id: 's1', nombre: 'Skill', entrada: { skill: 'nestjs-endpoint', args: 'users' } } }),
      ev({ tipo: 'herramienta_inicio', llamada: { id: 'r1', nombre: 'Read', entrada: { file_path: '/p/.claude/skills/nestjs-endpoint/SKILL.md' } } })
    ]
    let tr = construirTrabajo({ eventos, prompt: 'x', raiz: 'asistente', enCurso: true })
    expect(tr.skills).toHaveLength(1)
    expect(tr.skills[0]).toMatchObject({ nombre: 'nestjs-endpoint', argumentos: 'users', via: 'skill' })
    expect(tr.skills[0]!.fin).toBeUndefined()

    tr = construirTrabajo({ eventos: [...eventos, ev({ tipo: 'herramienta_fin', llamada: { id: 's1', nombre: 'Skill', entrada: {} }, resultado: { texto: '---\nname: x\n---\nCrea un endpoint…' } })], prompt: 'x', raiz: 'asistente', enCurso: true })
    expect(tr.skills[0]!.fin).toBeDefined()
    expect(tr.skills[0]!.resumen).toBe('Crea un endpoint…')
  })

  it('leer el SKILL.md de otra skill cuenta como skill por archivo', () => {
    const tr = construirTrabajo({ eventos: [ev({ tipo: 'herramienta_inicio', llamada: { id: 'r', nombre: 'Read', entrada: { file_path: '/p/skills/db-migracion-segura/SKILL.md' } } })], prompt: 'x', raiz: 'a', enCurso: false })
    expect(tr.skills).toEqual([expect.objectContaining({ nombre: 'db-migracion-segura', via: 'archivo' })])
  })
})
