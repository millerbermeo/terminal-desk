import type { DefHerramientaTareas } from './tareas-herramientas'

const t = (description: string): { type: string; description: string } => ({ type: 'string', description })
const PROYECTO = t('Id del proyecto (usa listar_proyectos). Si se omite, el proyecto de esta conversación')

/**
 * Herramientas de git para la IA. Solo operaciones seguras: no hay descartar cambios, borrar ramas, reset ni push forzado (eso lo
 * decide el usuario en la pantalla «Versiones»). Enviar y traer salen de la máquina: piden la confirmación más estricta.
 */
export const HERRAMIENTAS_GIT: readonly DefHerramientaTareas[] = [
  {
    nombre: 'git_estado',
    descripcion: 'Estado de git del proyecto: rama, cambios (preparados, sin preparar, nuevos, en conflicto), commits por enviar o traer, operación en curso y remotos. Úsalo antes de confirmar o cambiar de rama.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'git_diff',
    descripcion: 'Diferencias de los archivos con cambios (texto, recortado si es muy largo). Sin ruta, las de todos los archivos ya conocidos por git; los archivos nuevos sin seguimiento se piden por su ruta. Revísalo antes de redactar un commit.',
    esquema: {
      type: 'object',
      properties: {
        proyecto_id: PROYECTO,
        ruta: t('Archivo concreto (ruta relativa a la raíz del repositorio)'),
        preparado: { type: 'boolean', description: 'true: lo que ya está preparado para el commit; false (por defecto): lo que falta por preparar' }
      }
    },
    riesgo: 'lectura'
  },
  {
    nombre: 'git_historial',
    descripcion: 'Últimos commits (hash, autor, fecha y asunto), de la rama actual o de un archivo. Úsalo para imitar el estilo de los mensajes del proyecto.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, limite: { type: 'integer', description: 'Cuántos commits (por defecto 15, máximo 100)' }, ruta: t('Solo los que tocan este archivo') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'git_ramas',
    descripcion: 'Ramas locales y remotas con la actual, lo que llevan por enviar o traer y su último commit.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'git_preparar',
    descripcion: 'Prepara archivos para el commit. Pasa las rutas de lo que corresponde a ESTE cambio (mejor que prepararlo todo). Se niega a preparar archivos que parecen secretos (.env, claves, credenciales).',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, rutas: { type: 'array', description: 'Rutas relativas a la raíz del repositorio', items: { type: 'string' } }, todo: { type: 'boolean', description: 'true: prepara todos los cambios (úsalo solo si todo es del mismo cambio)' } } },
    riesgo: 'escritura'
  },
  {
    nombre: 'git_commit',
    descripcion:
      'Confirma (commit) lo que está preparado. Antes mira git_estado, git_diff y git_historial; escribe un mensaje claro en el estilo del proyecto (asunto corto en imperativo y, si hace falta, una línea en blanco y el detalle). No confirma si hay conflictos ni si lo preparado incluye archivos que parecen secretos.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, mensaje: t('Mensaje del commit') }, required: ['mensaje'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'git_crear_rama',
    descripcion: 'Crea una rama nueva desde la actual (y por defecto se cambia a ella). Nombre sin espacios; usa prefijos como feat/ o fix/.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, nombre: t('Nombre de la rama'), cambiar: { type: 'boolean', description: 'Cambiar a la rama nueva (por defecto true)' } }, required: ['nombre'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'git_cambiar_rama',
    descripcion: 'Cambia a una rama existente. Falla si los cambios sin confirmar se perderían: en ese caso confírmalos o guárdalos antes.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO, nombre: t('Nombre de la rama') }, required: ['nombre'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'git_traer',
    descripcion: 'Trae y aplica los cambios del remoto a la rama actual sin mezclar (solo avance rápido). Si la rama divergió, lo explica: no resuelve conflictos por su cuenta.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO } },
    riesgo: 'ejecucion'
  },
  {
    nombre: 'git_enviar',
    descripcion: 'Envía los commits de la rama actual al remoto (push; si la rama es nueva la publica y la enlaza). Nunca fuerza el envío. Antes comprueba con git_estado qué se enviará.',
    esquema: { type: 'object', properties: { proyecto_id: PROYECTO } },
    riesgo: 'ejecucion'
  }
]
