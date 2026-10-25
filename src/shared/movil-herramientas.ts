import type { DefHerramientaTareas } from './tareas-herramientas'

/**
 * Herramientas de la IA para probar apps en dispositivos Android físicos conectados por USB (adb), al estilo del navegador integrado:
 * ver la pantalla como árbol con refs, tocar, escribir, deslizar, abrir/instalar apps, registros y capturas como evidencia.
 */
const t = (description: string): { type: string; description: string } => ({ type: 'string', description })
const n = (description: string): { type: string; description: string } => ({ type: 'number', description })
const b = (description: string): { type: string; description: string } => ({ type: 'boolean', description })
const DISPOSITIVO = t('Número de serie del dispositivo (movil_dispositivos). Si se omite, el único conectado o el último que usaste')
const REF = t('Referencia del elemento tal como sale en movil_instantanea (p. ej. e7)')
const PAQUETE = t('Paquete de la app, p. ej. com.miempresa.miapp')

export const HERRAMIENTAS_MOVIL: readonly DefHerramientaTareas[] = [
  {
    nombre: 'movil_dispositivos',
    descripcion:
      'Lista los dispositivos Android conectados por USB (adb) con su estado: listo, sin autorizar (hay que aceptar el aviso de depuración en el teléfono), sin permiso USB del sistema, desconectado. Explica qué falta en cada caso. Úsala primero cuando haya que probar una app móvil en un teléfono real.',
    esquema: { type: 'object', properties: {} },
    riesgo: 'lectura'
  },
  {
    nombre: 'movil_info',
    descripcion: 'Información del dispositivo: modelo, fabricante, versión de Android y SDK, tamaño y densidad de pantalla, batería, arquitectura y app en primer plano.',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'movil_instantanea',
    descripcion:
      'Describe la pantalla actual como árbol (textos, botones, campos con su valor, casillas, listas desplazables) con una ref para cada elemento tocable. Es la forma de «ver» la app: pídela tras abrirla y después de acciones que cambian la pantalla. Las refs valen hasta la siguiente instantánea.',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO } },
    riesgo: 'lectura'
  },
  {
    nombre: 'movil_tocar',
    descripcion: 'Toca un elemento (por ref de la instantánea o por su texto visible) o unas coordenadas reales de la pantalla. Con largo: true, pulsación larga.',
    esquema: {
      type: 'object',
      properties: {
        dispositivo: DISPOSITIVO,
        ref: REF,
        texto: t('En vez de ref: texto o descripción visible del elemento'),
        x: n('En vez de ref: coordenada X en píxeles reales del dispositivo'),
        y: n('Coordenada Y en píxeles reales del dispositivo'),
        largo: b('Pulsación larga')
      }
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'movil_escribir',
    descripcion: 'Escribe texto en un campo (lo toca antes si das ref; si no, en el campo enfocado). Con limpiar: true borra antes lo que hubiera; con enviar: true pulsa Intro. Solo caracteres ASCII.',
    esquema: {
      type: 'object',
      properties: { dispositivo: DISPOSITIVO, ref: REF, texto: t('Texto a escribir'), limpiar: b('Borrar antes el contenido del campo'), enviar: b('Pulsar Intro al final') },
      required: ['texto']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'movil_tecla',
    descripcion: 'Pulsa una tecla del sistema: atras, inicio, recientes, enter, borrar, tab, menu, arriba/abajo/izquierda/derecha, subir_volumen, despertar… (o un KEYCODE).',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO, tecla: t('Nombre de la tecla o KEYCODE_*') }, required: ['tecla'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'movil_deslizar',
    descripcion: 'Desliza el dedo por la pantalla (o dentro de un elemento desplazable): «arriba» hace avanzar una lista hacia abajo, como con el dedo. O de un punto a otro.',
    esquema: {
      type: 'object',
      properties: {
        dispositivo: DISPOSITIVO,
        direccion: { type: 'string', description: 'Hacia dónde se mueve el dedo', enum: ['arriba', 'abajo', 'izquierda', 'derecha'] },
        ref: t('Deslizar dentro de este elemento (opcional)'),
        x1: n('Inicio X (en vez de dirección)'),
        y1: n('Inicio Y'),
        x2: n('Fin X'),
        y2: n('Fin Y'),
        ms: n('Duración en milisegundos (por defecto 300)')
      }
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'movil_esperar',
    descripcion: 'Espera a que aparezca (o desaparezca) un texto en la pantalla, o unos segundos. Máximo 60 s.',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO, texto: t('Texto que debe aparecer'), desaparece: t('Texto que debe desaparecer'), segundos: n('Segundos (o tope de la espera)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'movil_captura',
    descripcion: 'Captura de pantalla del dispositivo (imagen). Se guarda además como evidencia en el equipo (la ruta va en la respuesta). Para leer o tocar, mejor la instantánea.',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO, nombre: t('Nombre para el archivo de evidencia (opcional)') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'movil_apps',
    descripcion: 'Lista las apps instaladas por el usuario (no las del sistema salvo que se pida), con filtro opcional. Con paquete, da su versión, permisos concedidos/denegados y actividad principal.',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO, filtro: t('Solo paquetes que contengan este texto'), sistema: b('Incluir apps del sistema'), paquete: t('Detalle de una app concreta') } },
    riesgo: 'lectura'
  },
  {
    nombre: 'movil_abrir_app',
    descripcion: 'Abre una app por su paquete (su pantalla principal, una actividad concreta o un enlace profundo). Informa de la app en primer plano al terminar y de si se cerró sola (crash).',
    esquema: {
      type: 'object',
      properties: { dispositivo: DISPOSITIVO, paquete: PAQUETE, actividad: t('Actividad concreta, p. ej. .LoginActivity (opcional)'), enlace: t('Enlace profundo a abrir (miapp://ruta o https://…), opcional') }
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'movil_cerrar_app',
    descripcion: 'Fuerza el cierre de una app (am force-stop), p. ej. para empezar una prueba desde cero.',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO, paquete: PAQUETE }, required: ['paquete'] },
    riesgo: 'escritura'
  },
  {
    nombre: 'movil_instalar',
    descripcion:
      'Instala (o actualiza) un APK del equipo en el dispositivo. La ruta puede ser relativa a la carpeta del proyecto (p. ej. android/app/build/outputs/apk/debug/app-debug.apk). Los permisos de la app NO se conceden solos salvo que pidas conceder_permisos.',
    esquema: {
      type: 'object',
      properties: {
        dispositivo: DISPOSITIVO,
        apk: t('Ruta del archivo .apk'),
        conceder_permisos: b('Conceder todos los permisos de ejecución que declara la app (adb install -g), solo para pruebas'),
        proyecto_id: t('Proyecto para resolver rutas relativas (si se omite, el de esta conversación)')
      },
      required: ['apk']
    },
    riesgo: 'escritura'
  },
  {
    nombre: 'movil_logcat',
    descripcion: 'Registros del sistema (logcat): de toda la máquina o solo de una app, solo errores, o solo los cierres inesperados (crash). Útil para encontrar la causa de un fallo. Con guardar: true queda como evidencia.',
    esquema: {
      type: 'object',
      properties: {
        dispositivo: DISPOSITIVO,
        paquete: t('Solo los registros de esta app (debe estar en marcha)'),
        solo_errores: b('Solo errores (nivel E y F)'),
        fallos: b('Solo el registro de cierres inesperados (buffer crash)'),
        lineas: n('Cuántas líneas recientes (por defecto 200, máximo 2000)'),
        filtro: t('Solo líneas que contengan este texto'),
        limpiar: b('Vaciar el registro después de leerlo (para medir solo lo que pase a continuación)'),
        guardar: b('Guardar el registro completo como evidencia')
      }
    },
    riesgo: 'lectura'
  },
  {
    nombre: 'movil_shell',
    descripcion:
      'Ejecuta un comando en el shell del dispositivo (usuario shell de adb, sin root): dumpsys, getprop, am, pm, settings get, cmd… Para lo que no cubren las demás herramientas. No eleva privilegios.',
    esquema: { type: 'object', properties: { dispositivo: DISPOSITIVO, comando: t('Comando, p. ej. dumpsys battery o getprop ro.build.version.release') }, required: ['comando'] },
    riesgo: 'ejecucion'
  }
]
