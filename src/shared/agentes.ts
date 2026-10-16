import type { BibliotecaAgentes, Proyecto, Recurso } from './modelos'

export type OrigenActivo = 'individual' | 'grupo' | 'proyecto'

/** Nombre en kebab-case válido para un subagente / skill de Claude Code. */
export function slug(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Recursos que se aplican a un proyecto y por qué: individuales + compartidos activados por grupo o por proyecto. */
export function activosDe(b: BibliotecaAgentes, proyecto: Proyecto): { recurso: Recurso; origen: OrigenActivo }[] {
  const porGrupo = new Set((proyecto.grupo && b.activaciones.grupos[proyecto.grupo]) || [])
  const porProyecto = new Set(b.activaciones.proyectos[proyecto.id] ?? [])
  const salida: { recurso: Recurso; origen: OrigenActivo }[] = []
  for (const r of b.recursos) {
    if (r.ambito === 'proyecto') {
      if (r.proyectoId === proyecto.id) salida.push({ recurso: r, origen: 'individual' })
    } else if (porProyecto.has(r.id)) salida.push({ recurso: r, origen: 'proyecto' })
    else if (porGrupo.has(r.id)) salida.push({ recurso: r, origen: 'grupo' })
  }
  return salida
}
