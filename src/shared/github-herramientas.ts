import type { DefHerramientaTareas } from './tareas-herramientas'

const t = (description: string): { type: string; description: string } => ({ type: 'string', description })
const PROYECTO = t('Id del proyecto (usa listar_proyectos). Si se omite, el proyecto de esta conversación')
const ESTADO = { type: 'string', description: 'Qué estado (por defecto open)', enum: ['open', 'closed', 'all'] }

/**
 * Herramientas de GitHub para la IA (necesitan que el usuario haya conectado su cuenta en Versiones → GitHub). Fusionar pull requests,
 * cerrar incidencias y borrar repositorios no están: eso es del usuario. Todo lo que publica pide confirmación explícita.
 */
export const HERRAMIENTAS_GITHUB: readonly DefHerramientaTareas[] = [
  {
    nombre: 'github_estado',
    descripcion: 'Si hay una cuenta de GitHub conectada y a qué repositorio de GitHub apunta el proyecto (propietario/repo, privado o público, rama por defecto).',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'github_listar_prs',
    descripcion: 'Pull requests del repositorio del proyecto (número, título, autor, rama, si es borrador).',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, estado: ESTADO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'github_listar_issues',
    descripcion: 'Incidencias (issues) del repositorio del proyecto, sin contar los pull requests.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, estado: ESTADO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'github_estado_ci',
    descripcion: 'Estado de las comprobaciones automáticas (CI) de una rama o commit: éxito, fallo o pendiente, con cada check. Por defecto, la rama actual.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, ref: t('Rama, etiqueta o commit (por defecto, la rama actual)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'github_crear_pr',
    descripcion:
      'Abre un pull request de la rama actual hacia la rama base (por defecto, la del repositorio). Antes revisa los commits de la rama (git_historial) para redactar un título claro y una descripción útil. Si la rama no está en GitHub, la envía primero. No fusiona.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, titulo: t('Título del pull request'), cuerpo: t('Descripción (markdown): qué cambia y por qué, y cómo probarlo'), base: t('Rama de destino'), borrador: { type: 'boolean', description: 'Abrirlo como borrador' } }, required: ['titulo'] },
    riesgo: 'ejecucion'
  },
  {
    nombre: 'github_crear_issue',
    descripcion: 'Crea una incidencia en el repositorio del proyecto.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, titulo: t('Título'), cuerpo: t('Descripción (markdown)'), etiquetas: { type: 'array', description: 'Etiquetas que ya existen en el repositorio', items: { type: 'string' } } }, required: ['titulo'] },
    riesgo: 'ejecucion'
  },
  {
    nombre: 'github_comentar',
    descripcion: 'Añade un comentario a una incidencia o a un pull request (por su número).',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, numero: { type: 'integer', description: 'Número de la incidencia o del pull request' }, texto: t('Comentario (markdown)') }, required: ['numero', 'texto'] },
    riesgo: 'ejecucion'
  },
  {
    nombre: 'github_crear_repo',
    descripcion: 'Crea un repositorio en GitHub para este proyecto, lo enlaza como origin y envía la rama actual. Necesita al menos un commit. Por defecto es privado.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, nombre: t('Nombre del repositorio'), descripcion: t('Descripción corta'), privado: { type: 'boolean', description: 'Privado (por defecto true)' }, organizacion: t('Crearlo en una organización en vez de en tu cuenta') }, required: ['nombre'] },
    riesgo: 'ejecucion'
  }
]
