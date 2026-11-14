import type { Proyecto } from '@shared/modelos'

/**
 * La «Terminal general» registra la carpeta raíz común de un grupo como proyecto local de ese grupo.
 * Esa raíz no es un proyecto más: no se lista en el grupo ni se abre con él.
 * Es raíz si su carpeta contiene la de otro proyecto del mismo grupo.
 */
export const esRaizDeGrupo = (p: Proyecto, proyectos: Proyecto[]): boolean => {
  const base = p.ruta.replace(/\/+$/, '') + '/'
  return proyectos.some((o) => o.id !== p.id && o.grupo === p.grupo && o.ruta.startsWith(base))
}

/** Proyectos de un grupo sin su carpeta raíz. */
export const sinRaiz = (proyectos: Proyecto[]): Proyecto[] => proyectos.filter((p) => !esRaizDeGrupo(p, proyectos))
