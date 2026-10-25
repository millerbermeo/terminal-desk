import type { DefHerramientaTareas } from './tareas-herramientas'

/**
 * Herramientas de la IA para manejar el navegador integrado de Odesk (ventanas visibles: el usuario ve en tiempo real lo que hace).
 * Varias ventanas a la vez, cada una con su id. Los elementos se señalan por la `ref` que da `navegador_instantanea`.
 */
const t = (description: string): { type: string; description: string } => ({ type: 'string', description })
const n = (description: string): { type: string; description: string } => ({ type: 'number', description })
const b = (description: string): { type: string; description: string } => ({ type: 'boolean', description })
const VENTANA = n('Id de la ventana (navegador_ventanas). Si se omite, la última que usaste o abriste')
const REF = t('Referencia del elemento tal como sale en navegador_instantanea (p. ej. e12)')

export const PREFIJO_NAVEGADOR = 'navegador_'

export const HERRAMIENTAS_NAVEGADOR: readonly DefHerramientaTareas[] = [
  {
    nombre: 'navegador_abrir',
    descripcion:
      'Abre una ventana NUEVA del navegador integrado de Odesk (visible para el usuario, que ve en directo lo que haces) y carga la dirección. Úsalo para probar los proyectos en el navegador: localhost:3000, 5173, https://… Puedes tener varias ventanas a la vez (p. ej. dos usuarios distintos o móvil y escritorio). Devuelve el id de la ventana. Después usa navegador_instantanea para ver la página.',
    esquema: {
      type: 'object',
      properties: { url: t('Dirección: localhost:3000, 5173, ejemplo.com, http://…'), ancho: n('Ancho de la página en px (opcional, p. ej. 390 para móvil)'), alto: n('Alto de la página en px (opcional)') },
      required: ['url']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_ventanas',
    descripcion: 'Lista las ventanas del navegador integrado abiertas (id, dirección, título, si la abrió la IA). Incluye las que abrió el usuario: también puedes manejarlas.',
    esquema: { type: 'object', properties: {} },
    riesgo: 'lectura'
  },
  {
    nombre: 'navegador_ir',
    descripcion: 'Navega en una ventana existente: a una dirección, o atrás / adelante / recargar.',
    esquema: {
      type: 'object',
      properties: { ventana: VENTANA, url: t('Dirección a cargar'), accion: { type: 'string', description: 'En vez de url: moverse por el historial o recargar', enum: ['atras', 'adelante', 'recargar'] } }
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_instantanea',
    descripcion:
      'Describe la página como árbol de accesibilidad (encabezados, textos, enlaces, botones, campos con su valor…) con una ref para cada elemento con el que se puede interactuar. Es la forma de «ver» la página: pídela tras navegar o después de acciones que cambian la página. Las refs se usan en clic/escribir/seleccionar.',
    esquema: { type: 'object', properties: { ventana: VENTANA } },
    riesgo: 'lectura'
  },
  {
    nombre: 'navegador_clic',
    descripcion: 'Hace clic (ratón real, el usuario lo ve marcado en la página) sobre un elemento de la instantánea. Falla si otro elemento lo tapa o está deshabilitado.',
    esquema: {
      type: 'object',
      properties: { ventana: VENTANA, ref: REF, doble: b('Doble clic'), boton: { type: 'string', description: 'Botón del ratón (por defecto izquierdo)', enum: ['izquierdo', 'derecho', 'central'] } },
      required: ['ref']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_escribir',
    descripcion: 'Escribe en un campo de texto (input, textarea o editable). Por defecto borra lo que hubiera. Con enviar: true pulsa Intro al terminar.',
    esquema: {
      type: 'object',
      properties: { ventana: VENTANA, ref: REF, texto: t('Texto a escribir'), enviar: b('Pulsar Intro al final'), limpiar: b('Borrar antes el contenido (por defecto true)') },
      required: ['ref', 'texto']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_tecla',
    descripcion: 'Pulsa una tecla o combinación en el elemento enfocado: Enter, Tab, Escape, Backspace, ArrowDown, PageDown, Control+a, Shift+Tab…',
    esquema: { type: 'object', properties: { ventana: VENTANA, tecla: t('Tecla o combinación, p. ej. Enter, Escape, Control+a') }, required: ['tecla'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_seleccionar',
    descripcion: 'Elige una o varias opciones de un desplegable <select> (por su valor o su texto visible).',
    esquema: { type: 'object', properties: { ventana: VENTANA, ref: REF, valores: { type: 'array', description: 'Valores o textos de las opciones', items: { type: 'string' } } }, required: ['ref', 'valores'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_pasar_raton',
    descripcion: 'Pasa el ratón por encima de un elemento (menús desplegables, tooltips).',
    esquema: { type: 'object', properties: { ventana: VENTANA, ref: REF }, required: ['ref'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_desplazar',
    descripcion: 'Desplaza la página: hasta un elemento (ref) o una cantidad de píxeles (positivo hacia abajo).',
    esquema: { type: 'object', properties: { ventana: VENTANA, ref: t('Elemento al que llevar la vista (opcional)'), pixeles: n('Píxeles a desplazar en vertical (por defecto, una pantalla)') } },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_esperar',
    descripcion: 'Espera a que aparezca (o desaparezca) un texto en la página, o unos segundos. Máximo 30 s.',
    esquema: { type: 'object', properties: { ventana: VENTANA, texto: t('Texto que debe aparecer'), desaparece: t('Texto que debe desaparecer'), segundos: n('Segundos a esperar (o tope de espera del texto)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'navegador_captura',
    descripcion: 'Captura de pantalla (imagen) de la ventana, de la página completa o de un elemento. Úsala para revisar el aspecto visual; para leer o actuar, mejor la instantánea.',
    esquema: { type: 'object', properties: { ventana: VENTANA, ref: t('Capturar solo este elemento (opcional)'), completa: b('Toda la página, no solo lo visible') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'navegador_consola',
    descripcion: 'Mensajes de la consola de la página (errores de JavaScript, avisos, console.log) desde que se abrió la ventana, del más antiguo al más nuevo.',
    esquema: { type: 'object', properties: { ventana: VENTANA, solo_errores: b('Solo errores y avisos'), limpiar: b('Vaciar la lista después de leerla') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'navegador_red',
    descripcion: 'Peticiones de red de la página (método, dirección, estado HTTP, tipo). Útil para ver llamadas a la API que fallan (4xx/5xx o sin respuesta).',
    esquema: { type: 'object', properties: { ventana: VENTANA, solo_fallos: b('Solo las que fallaron (≥400 o error de red)'), filtro: t('Solo direcciones que contengan este texto'), limpiar: b('Vaciar la lista después de leerla') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'navegador_evaluar',
    descripcion: 'Ejecuta JavaScript en la página (como la consola de DevTools) y devuelve el resultado en JSON. Puede ser una expresión o una función flecha sin argumentos; se espera a las promesas.',
    esquema: { type: 'object', properties: { ventana: VENTANA, codigo: t('Código, p. ej. document.title o () => localStorage.length') }, required: ['codigo'] },
    riesgo: 'ejecucion'
  },
  {
    nombre: 'navegador_tamano',
    descripcion: 'Cambia el tamaño de la página (responsive): p. ej. 390×844 móvil, 768×1024 tableta, 1440×900 escritorio.',
    esquema: { type: 'object', properties: { ventana: VENTANA, ancho: n('Ancho en px'), alto: n('Alto en px') }, required: ['ancho', 'alto'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'navegador_cerrar',
    descripcion: 'Cierra una ventana del navegador integrado.',
    esquema: { type: 'object', properties: { ventana: VENTANA } },
    riesgo: 'escritura'
  }
]
