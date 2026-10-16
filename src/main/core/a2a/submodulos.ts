import type { EventoAgente } from '@shared/core/agente'
import type { Proyecto } from '@shared/modelos'
import { Agente, type AgenteDef } from '../agents/agente'
import type { Harness } from '../agents/harness'
import type { BusA2A } from './bus'

const SOLO_LECTURA = ['leer_archivo', 'listar_directorio', 'ejecutar_comando', 'buscar_memoria'] as const

export const AGENTE_COORDINADOR = 'coordinador'

/** Nombre de agente válido y único a partir del nombre del proyecto. */
export function nombreAgente(nombre: string, usados: ReadonlySet<string>): string {
  const base =
    nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'modulo'
  let n = base === AGENTE_COORDINADOR ? `${base}-mod` : base
  for (let i = 2; usados.has(n); i++) n = `${base}-${i}`
  return n
}

function especialista(nombre: string, p: Proyecto): AgenteDef {
  return {
    nombre,
    descripcion: `Conoce el submódulo «${p.nombre}» (${p.ruta}): código, contratos, tipos y convenciones.`,
    sistema:
      `Eres el especialista del submódulo «${p.nombre}», ubicado en ${p.ruta}. Otros agentes te consultan sobre ESTE módulo ` +
      '(endpoints, contratos, tipos, convenciones). Lee el código antes de responder, cita rutas y responde de forma precisa y breve. ' +
      'Solo lectura: no modificas nada. Si te falta información de otro módulo, usa consultar_agente.',
    herramientas: SOLO_LECTURA,
    maxPasos: 12
  }
}

export interface Topologia {
  coordinador: Agente
  agentes: string[] // nombres de los especialistas registrados en el bus
}

export interface OpcionesTopologia {
  proyectos: readonly Proyecto[]
  harness: Harness
  bus: BusA2A
  ejecucionId: string
  alEvento: (e: EventoAgente) => void
}

/** Un especialista por proyecto del grupo, registrado en el bus, y un coordinador que puede consultarlos. */
export function crearTopologia(o: OpcionesTopologia): Topologia {
  const usados = new Set<string>()
  const nombres: string[] = []
  for (const p of o.proyectos) {
    const nombre = nombreAgente(p.nombre, usados)
    usados.add(nombre)
    nombres.push(nombre)
    const agente = new Agente(especialista(nombre, p))
    o.bus.registrar({
      nombre,
      descripcion: agente.def.descripcion,
      atender: async (peticion) => {
        const r = await o.harness.ejecutar(agente, {
          prompt: `Consulta del agente «${peticion.de}»:\n${peticion.pregunta}`,
          cwd: p.ruta,
          proyectoId: p.id,
          ejecucionId: o.ejecucionId,
          extras: [o.bus.herramientaConsultar(nombre, peticion.cadena, (m) => emitirA2A(o, m))],
          ...(peticion.senal ? { senal: peticion.senal } : {}),
          alEvento: o.alEvento
        })
        if (r.estado !== 'completado') throw new Error(`${nombre} no pudo responder (${r.estado}${r.error ? `: ${r.error}` : ''})`)
        return r.texto
      }
    })
  }
  const coordinador = new Agente({
    nombre: AGENTE_COORDINADOR,
    descripcion: 'Coordina a los especialistas de cada submódulo.',
    sistema:
      'Coordinas un proyecto con varios submódulos. Cada uno tiene un agente especialista al que puedes consultar con consultar_agente ' +
      `(${nombres.join(', ')}). No tienes acceso directo a archivos: obtén la información preguntando, en paralelo cuando las consultas sean ` +
      'independientes, y sintetiza una respuesta única y coherente en español señalando qué módulo aporta cada dato.',
    herramientas: ['buscar_memoria'],
    maxPasos: 12
  })
  return { coordinador, agentes: nombres }
}

function emitirA2A(o: OpcionesTopologia, m: { de: string; a: string; fase: 'envio' | 'respuesta'; texto: string }): void {
  o.alEvento({ ejecucionId: o.ejecucionId, agente: m.fase === 'envio' ? m.de : m.a, profundidad: 0, tipo: 'a2a', ...m })
}
