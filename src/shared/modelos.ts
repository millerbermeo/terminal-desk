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
