export interface Grupo {
  id: string
  nombre: string
}

export interface Proyecto {
  id: string
  nombre: string
  ruta: string
  grupo?: string // id de Grupo
  /** Proyecto solo de este equipo: sin id en el servidor, sin `.odesk/project.json`, sin sincronización ni seguimiento remoto. */
  local?: boolean
}

export interface DatosProyectos {
  grupos: Grupo[]
  proyectos: Proyecto[]
}

/** Proveedor de IA = CLI que se lanza dentro de una terminal. */
export interface Proveedor {
  id: string
  nombre: string
  comando: string // línea de comando tal como se escribiría en la terminal, ej. "claude --model sonnet"
  env: Record<string, string> // variables de entorno extra para la terminal
}

export interface ProveedorEstado extends Proveedor {
  disponible: boolean // el ejecutable se encontró en el PATH
}

/** Recursos de Claude Code que la app inyecta al abrir una terminal con Claude. */
export type TipoRecurso = 'agente' | 'skill'

export interface Recurso {
  id: string
  tipo: TipoRecurso
  nombre: string // se usa como nombre del subagente / skill (en kebab-case)
  descripcion: string // cuándo debe usarlo Claude
  contenido: string // prompt del subagente / instrucciones de la skill (markdown)
  herramientas?: string[] // solo agentes; vacío = todas
  modelo?: string // solo agentes; vacío = hereda el de la sesión
  ambito: 'compartido' | 'proyecto'
  proyectoId?: string // si ámbito = proyecto
}

export interface Activaciones {
  proyectos: Record<string, string[]> // id de proyecto -> ids de recursos compartidos activos
  grupos: Record<string, string[]> // id de grupo -> ids de recursos compartidos activos
}

export interface BibliotecaAgentes {
  recursos: Recurso[]
  activaciones: Activaciones
}

/** Clave para comparar nombres de proyecto: sin mayúsculas ni espacios de más. */
export const claveNombre = (n: string): string => n.trim().replace(/\s+/g, ' ').toLowerCase()

/** Ids de los proyectos cuyo nombre lo comparte otro proyecto. */
export function proyectosConNombreRepetido(proyectos: { id: string; nombre: string }[]): Set<string> {
  const por = new Map<string, string[]>()
  for (const p of proyectos) por.set(claveNombre(p.nombre), [...(por.get(claveNombre(p.nombre)) ?? []), p.id])
  return new Set([...por.values()].filter((ids) => ids.length > 1).flat())
}
