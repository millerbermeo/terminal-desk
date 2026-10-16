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
