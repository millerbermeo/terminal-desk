export interface Grupo {
  id: string
  nombre: string
}

export interface Proyecto {
  id: string
  nombre: string
  ruta: string
  grupo?: string // id de Grupo
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
