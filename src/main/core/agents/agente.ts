/** Definición declarativa de un agente. Los subagentes son agentes que el padre puede delegar. */
export interface AgenteDef {
  nombre: string // identificador (también el valor que el padre usa al delegar)
  descripcion: string // cuándo delegar en él
  sistema: string // prompt de sistema
  modelo?: string
  /** Nombres de herramientas permitidas; undefined = todas las del registro. */
  herramientas?: readonly string[]
  subagentes?: readonly AgenteDef[]
  maxPasos?: number
}

const NOMBRE = /^[a-z0-9][a-z0-9_-]{0,39}$/

export class Agente {
  readonly subagentes: ReadonlyMap<string, Agente>

  constructor(readonly def: AgenteDef) {
    if (!NOMBRE.test(def.nombre)) throw new Error(`Nombre de agente inválido: ${def.nombre}`)
    const hijos = new Map<string, Agente>()
    for (const s of def.subagentes ?? []) {
      if (hijos.has(s.nombre)) throw new Error(`Subagente duplicado: ${s.nombre}`)
      hijos.set(s.nombre, new Agente(s))
    }
    this.subagentes = hijos
  }

  get nombre(): string {
    return this.def.nombre
  }
}
