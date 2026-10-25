/** Dispositivos Android por USB (adb): tipos y lógica pura (la comparten main y tests). */

export type EstadoDispositivo = 'listo' | 'sin_autorizar' | 'sin_permiso_usb' | 'desconectado' | 'otro'

export interface DispositivoAdb {
  serie: string
  /** Estado tal como lo da adb (`device`, `unauthorized`, `offline`, `no permissions`…). */
  crudo: string
  estado: EstadoDispositivo
  modelo?: string
  producto?: string
  usb?: string
  /** Conectado por red (adb tcpip / emparejado), no por cable. */
  red: boolean
  emulador: boolean
}

/** Analiza `adb devices -l`. */
export function analizarDispositivos(salida: string): DispositivoAdb[] {
  const lista: DispositivoAdb[] = []
  for (const linea of salida.split(/\r?\n/)) {
    const t = linea.trim()
    if (!t || t.startsWith('List of devices') || t.startsWith('*') || t.startsWith('adb server')) continue
    const m = /^(\S+)\s+(no permissions.*?|unauthorized|device|offline|recovery|sideload|bootloader|authorizing|connecting|host|rescue|unknown)(?:\s+(.*))?$/.exec(t)
    if (!m) continue
    const [, serie, crudoTodo, resto = ''] = m
    const crudo = crudoTodo!.startsWith('no permissions') ? 'no permissions' : crudoTodo!
    const campos = Object.fromEntries([...resto.matchAll(/(\w+):(\S+)/g)].map((x) => [x[1], x[2]]))
    const estado: EstadoDispositivo =
      crudo === 'device' ? 'listo' : crudo === 'unauthorized' || crudo === 'authorizing' ? 'sin_autorizar' : crudo === 'no permissions' ? 'sin_permiso_usb' : crudo === 'offline' ? 'desconectado' : 'otro'
    lista.push({
      serie: serie!,
      crudo,
      estado,
      ...(campos.model ? { modelo: campos.model.replace(/_/g, ' ') } : {}),
      ...(campos.product ? { producto: campos.product } : {}),
      ...(campos.usb ? { usb: campos.usb } : {}),
      red: /:\d+$/.test(serie!) || serie!.includes('._adb-tls-connect.'),
      emulador: serie!.startsWith('emulator-')
    })
  }
  return lista
}

/** Qué hacer para que un dispositivo quede listo (la autorización siempre la da la persona en el teléfono). */
export function ayudaEstado(d: Pick<DispositivoAdb, 'estado' | 'crudo'>, plataforma: string = 'linux'): string {
  switch (d.estado) {
    case 'listo':
      return ''
    case 'sin_autorizar':
      return 'Desbloquea el teléfono y acepta el aviso «¿Permitir depuración USB?» (marca «Permitir siempre desde este ordenador»). Si no aparece: Opciones de desarrollador → «Revocar autorizaciones de depuración USB», desconecta y vuelve a conectar el cable.'
    case 'sin_permiso_usb':
      return plataforma === 'linux'
        ? 'Linux no deja a tu usuario abrir el dispositivo USB: faltan reglas udev. En Ubuntu/Debian: `sudo apt install android-sdk-platform-tools-common` (o una regla en /etc/udev/rules.d/51-android.rules) y añade tu usuario al grupo plugdev (`sudo usermod -aG plugdev $USER`); luego cierra sesión y reconecta el cable. Esto lo tienes que hacer tú: Odesk no ejecuta sudo.'
        : 'El sistema no da permiso para abrir el dispositivo USB: instala el controlador USB del fabricante y reconecta el cable.'
    case 'desconectado':
      return 'adb lo ve pero no responde (offline): desconecta y vuelve a conectar el cable, desbloquea el teléfono y comprueba que la depuración USB sigue activada.'
    default:
      return d.crudo === 'recovery' || d.crudo === 'sideload' || d.crudo === 'bootloader' || d.crudo === 'rescue'
        ? `El teléfono está en modo ${d.crudo}: reinícialo normalmente para poder probar apps.`
        : `Estado «${d.crudo}»: espera unos segundos o reconecta el cable.`
  }
}

export const AYUDA_SIN_DISPOSITIVOS =
  'No hay ningún dispositivo Android conectado. Para usar uno: 1) Ajustes → Acerca del teléfono → toca 7 veces «Número de compilación» (activa las Opciones de desarrollador); 2) Opciones de desarrollador → activa «Depuración USB» (en Xiaomi también «Depuración USB (ajustes de seguridad)» para poder tocar la pantalla); 3) conecta el cable USB (de datos, no solo de carga) y, si pregunta, elige «Transferencia de archivos»; 4) acepta en el teléfono el aviso de depuración USB.'

/** Traduce los errores típicos de adb a algo que explique qué hacer. */
export function explicarErrorAdb(texto: string): string {
  const t = texto.trim()
  if (/device unauthorized|unauthorized/i.test(t)) return ayudaEstado({ estado: 'sin_autorizar', crudo: 'unauthorized' })
  if (/no permissions|insufficient permissions/i.test(t)) return ayudaEstado({ estado: 'sin_permiso_usb', crudo: 'no permissions' }, process.platform)
  if (/device offline/i.test(t)) return ayudaEstado({ estado: 'desconectado', crudo: 'offline' })
  if (/device '.*' not found|no devices\/emulators found|device not found/i.test(t)) return 'El dispositivo se desconectó (o cambió de modo USB). Reconecta el cable y usa movil_dispositivos.'
  if (/INJECT_EVENTS/i.test(t))
    return 'Android no deja simular toques: en Xiaomi/Redmi/POCO activa «Depuración USB (ajustes de seguridad)» en Opciones de desarrollador (pide cuenta Mi y SIM); en otros fabricantes revisa opciones parecidas.'
  if (/INSTALL_FAILED_USER_RESTRICTED/i.test(t)) return 'El teléfono bloqueó la instalación por USB: acepta el aviso en pantalla o activa «Instalar vía USB» en Opciones de desarrollador.'
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE/i.test(t))
    return `${t}\nYa hay instalada una versión firmada con otra clave o más nueva: desinstálala tú primero (Ajustes → Apps) si quieres instalar esta.`
  if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(t)) return 'No hay espacio en el teléfono para instalar el APK.'
  if (/INSTALL_PARSE_FAILED|INSTALL_FAILED_INVALID_APK/i.test(t)) return `${t}\nEl APK no es válido (¿compilación incompleta o de otra arquitectura?).`
  if (/INSTALL_FAILED_NO_MATCHING_ABIS/i.test(t)) return 'El APK no trae librerías para la arquitectura de este teléfono (ABI).'
  return t
}

/** Nodo del volcado de `uiautomator dump`. */
export interface NodoUi {
  clase: string
  texto: string
  descripcion: string
  id: string
  paquete: string
  limites: { x1: number; y1: number; x2: number; y2: number }
  clicable: boolean
  pulsacionLarga: boolean
  marcable: boolean
  marcado: boolean
  activado: boolean
  enfocable: boolean
  enfocado: boolean
  desplazable: boolean
  seleccionado: boolean
  contrasena: boolean
  hijos: NodoUi[]
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodificar = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (todo, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTIDADES[e] ?? todo)
  )

/** Convierte el XML de `uiautomator dump` en un árbol (sin dependencias: el formato es siempre el mismo, `<node …>` anidados). */
export function analizarVolcadoUi(xml: string): NodoUi[] {
  const raiz: NodoUi[] = []
  const pila: NodoUi[] = []
  for (const m of xml.matchAll(/<(\/?)node\b([^>]*?)(\/?)>/g)) {
    if (m[1]) {
      pila.pop()
      continue
    }
    const a: Record<string, string> = {}
    for (const x of m[2]!.matchAll(/([\w:-]+)="([^"]*)"/g)) a[x[1]!] = decodificar(x[2]!)
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(a.bounds ?? '')
    const nodo: NodoUi = {
      clase: a.class ?? '',
      texto: a.text ?? '',
      descripcion: a['content-desc'] ?? '',
      id: a['resource-id'] ?? '',
      paquete: a.package ?? '',
      limites: b ? { x1: Number(b[1]), y1: Number(b[2]), x2: Number(b[3]), y2: Number(b[4]) } : { x1: 0, y1: 0, x2: 0, y2: 0 },
      clicable: a.clickable === 'true',
      pulsacionLarga: a['long-clickable'] === 'true',
      marcable: a.checkable === 'true',
      marcado: a.checked === 'true',
      activado: a.enabled !== 'false',
      enfocable: a.focusable === 'true',
      enfocado: a.focused === 'true',
      desplazable: a.scrollable === 'true',
      seleccionado: a.selected === 'true',
      contrasena: a.password === 'true',
      hijos: []
    }
    ;(pila.length ? pila[pila.length - 1]!.hijos : raiz).push(nodo)
    if (!m[3]) pila.push(nodo)
  }
  return raiz
}

function rolDe(n: NodoUi): string {
  const c = n.clase.split('.').pop() ?? ''
  if (/EditText|TextField|AutoComplete/i.test(c)) return 'textbox'
  if (/Switch|Toggle/i.test(c)) return 'switch'
  if (/CheckBox/i.test(c)) return 'checkbox'
  if (/RadioButton/i.test(c)) return 'radio'
  if (/Button/i.test(c)) return 'button'
  if (/Spinner/i.test(c)) return 'combobox'
  if (/SeekBar|Slider/i.test(c)) return 'slider'
  if (/Tab/i.test(c) && n.clicable) return 'tab'
  if (/Image/i.test(c)) return n.clicable ? 'button' : 'img'
  if (/RecyclerView|ListView|ScrollView|GridView|ViewPager|LazyColumn|LazyRow/i.test(c) || n.desplazable) return 'list'
  if (/WebView/i.test(c)) return 'webview'
  if (n.marcable) return 'checkbox'
  if (n.clicable || n.pulsacionLarga) return 'clicable'
  if (/TextView|Text$/i.test(c)) return 'text'
  return ''
}

export interface ElementoMovil {
  ref: string
  x: number
  y: number
  limites: NodoUi['limites']
  desc: string
}

export interface InstantaneaMovil {
  texto: string
  elementos: Map<string, ElementoMovil>
}

const limpio = (t: string, max = 120): string => {
  // Fuera los caracteres invisibles y los iconos de fuente (uso privado, p. ej. Material Icons): se verían como texto vacío.
  const s = t.replace(/[\u200b-\u200f\u2060\ufeff\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Describe la pantalla como árbol (como la instantánea del navegador): textos, botones, campos con su valor y estados, con una ref para
 * cada elemento tocable. Los contenedores sin nada que mostrar no añaden nivel.
 */
export function instantaneaMovil(raiz: NodoUi[], cabecera: string[] = []): InstantaneaMovil {
  const lineas: string[] = []
  const elementos = new Map<string, ElementoMovil>()
  let n = 0
  const recorrer = (nodo: NodoUi, nivel: number, dentroDeTocable: boolean): void => {
    const { x1, y1, x2, y2 } = nodo.limites
    const visible = x2 > x1 && y2 > y1
    const rol = rolDe(nodo)
    const tocable = nodo.clicable || nodo.pulsacionLarga || nodo.marcable || rol === 'textbox' || nodo.desplazable
    let nombre = limpio(nodo.descripcion || (rol === 'textbox' ? '' : nodo.texto))
    // Un botón hecho de un contenedor clicable con textos dentro: se nombra con esos textos y no se repiten debajo.
    if (tocable && !nombre && rol !== 'textbox' && rol !== 'list') nombre = limpio(textosDe(nodo).join(' '))
    const mostrar = visible && rol !== '' && (tocable || nombre !== '') && !(dentroDeTocable && !tocable && rol === 'text')
    let siguiente = nivel
    if (mostrar) {
      let linea = `${'  '.repeat(nivel)}- ${rol}${nombre ? ` ${JSON.stringify(nombre)}` : ''}`
      if (tocable) {
        const ref = `e${++n}`
        const desc = `${rol}${nombre ? ` «${nombre}»` : ''}`
        elementos.set(ref, { ref, x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), limites: nodo.limites, desc })
        linea += ` [ref=${ref}]`
      }
      if (rol === 'textbox') {
        const valor = nodo.contrasena && nodo.texto ? '•••' : nodo.texto
        if (valor) linea += ` valor=${JSON.stringify(limpio(valor))}`
      }
      const estados = [
        ...(!nodo.activado ? ['deshabilitado'] : []),
        ...(nodo.marcable ? [nodo.marcado ? 'marcado' : 'sin marcar'] : []),
        ...(nodo.seleccionado ? ['seleccionado'] : []),
        ...(nodo.enfocado ? ['enfocado'] : []),
        ...(nodo.desplazable ? ['desplazable'] : []),
        ...(nodo.pulsacionLarga && !nodo.clicable ? ['pulsación larga'] : [])
      ]
      if (estados.length) linea += ` (${estados.join(', ')})`
      const id = nodo.id.split(':id/').pop()
      if (id && tocable) linea += ` #${id}`
      lineas.push(linea)
      siguiente = nivel + 1
    }
    for (const h of nodo.hijos) recorrer(h, siguiente, dentroDeTocable || (mostrar && tocable && rol !== 'list'))
  }
  for (const r of raiz) recorrer(r, 0, false)
  return { texto: [...cabecera, ...(lineas.length ? lineas : ['- (pantalla sin elementos legibles: usa movil_captura)'])].join('\n'), elementos }
}

function textosDe(n: NodoUi): string[] {
  const propios = [n.texto, n.descripcion].filter((t) => t.trim())
  return [...propios, ...n.hijos.flatMap(textosDe)].slice(0, 6)
}

/** Busca un elemento por su texto o descripción (para tocar sin pedir antes una instantánea). Prioriza coincidencia exacta y tocable. */
export function buscarPorTexto(raiz: NodoUi[], buscado: string): NodoUi | undefined {
  const b = buscado.trim().toLowerCase()
  const todos: NodoUi[] = []
  const recorrer = (n: NodoUi): void => {
    todos.push(n)
    n.hijos.forEach(recorrer)
  }
  raiz.forEach(recorrer)
  const visibles = todos.filter((n) => n.limites.x2 > n.limites.x1 && n.limites.y2 > n.limites.y1)
  const textoDe = (n: NodoUi): string[] => [n.texto, n.descripcion].map((t) => t.trim().toLowerCase()).filter(Boolean)
  return (
    visibles.find((n) => textoDe(n).includes(b) && (n.clicable || n.marcable)) ??
    visibles.find((n) => textoDe(n).includes(b)) ??
    visibles.find((n) => textoDe(n).some((t) => t.includes(b)))
  )
}

/**
 * Texto para `input text` (se manda por `adb shell`, que lo pasa al shell del teléfono): espacios como %s y todo entre comillas simples.
 * `input text` solo admite ASCII imprimible.
 */
export function textoParaInput(texto: string): string {
  if (/[^\x20-\x7e]/.test(texto)) throw new Error('`input text` de Android solo escribe caracteres ASCII (sin tildes, ñ ni emojis). Escribe el texto sin ellos o pégalo a mano.')
  return `'${texto.replace(/%/g, '\\%').replace(/ /g, '%s').replace(/'/g, `'\\''`)}'`
}

const TECLAS_MOVIL: Record<string, number> = {
  atras: 4, back: 4, volver: 4, inicio: 3, home: 3, enter: 66, intro: 66, borrar: 67, backspace: 67, del: 67, tab: 61, recientes: 187,
  app_switch: 187, menu: 82, buscar: 84, search: 84, subir_volumen: 24, volume_up: 24, bajar_volumen: 25, volume_down: 25, encender: 26,
  power: 26, arriba: 19, up: 19, abajo: 20, down: 20, izquierda: 21, left: 21, derecha: 22, right: 22, escape: 111, esc: 111, suprimir: 112,
  delete: 112, espacio: 62, space: 62, despertar: 224, wakeup: 224, dormir: 223, sleep: 223
}

/** Código de tecla de Android: por nombre («atras», «enter»…), `KEYCODE_*` o número. */
export function codigoTecla(spec: string): number {
  const t = String(spec ?? '').trim()
  if (/^\d+$/.test(t)) return Number(t)
  const k = t.toLowerCase().replace(/^keycode_/, '').replace(/[\s-]/g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const c = TECLAS_MOVIL[k]
  if (c === undefined) throw new Error(`Tecla desconocida: «${spec}». Usa atras, inicio, enter, borrar, tab, recientes, menu, arriba/abajo/izquierda/derecha, subir_volumen… o un número de KEYCODE.`)
  return c
}

/** Tamaño de pantalla de `wm size` (prefiere el «Override» si lo hay). */
export function analizarTamano(salida: string): { ancho: number; alto: number } | undefined {
  const m = /Override size:\s*(\d+)x(\d+)/.exec(salida) ?? /Physical size:\s*(\d+)x(\d+)/.exec(salida)
  return m ? { ancho: Number(m[1]), alto: Number(m[2]) } : undefined
}

/** App en primer plano a partir de `dumpsys activity activities` (o `dumpsys window`). */
export function analizarPrimerPlano(salida: string): string | undefined {
  const m = /(?:topResumedActivity|mResumedActivity|ResumedActivity|mCurrentFocus|mFocusedApp)[^\n]*?\s([\w.]+\/[\w.$]+)/.exec(salida)
  return m?.[1]
}

/** Comandos de `movil_shell` que no se ejecutan: elevar privilegios o tocar la seguridad del sistema queda fuera (lo hace la persona). */
export function motivoShellBloqueado(comando: string): string | null {
  if (/(^|[\s;&|`(])(su|sudo|magisk|setenforce|resetprop)(\s|$|;)/.test(comando)) return 'No se eleva privilegios (su, sudo, magisk, setenforce, resetprop): si de verdad hace falta, hazlo tú en el dispositivo.'
  if (/(^|[\s;&|])(reboot\s+(bootloader|recovery|fastboot|edl)|fastboot|dd\s|mkfs|wipe|recovery\s+--wipe)/.test(comando)) return 'Ese comando puede dejar el teléfono inservible o borrarlo: no se ejecuta desde la IA.'
  if (/(^|[\s;&|])rm\s+-[a-z]*r[a-z]*\s+\/(\s|$|system|data|sdcard\/?(\s|$))/.test(comando)) return 'Borrado masivo del almacenamiento: no se ejecuta desde la IA.'
  // Como en git/GitHub, la IA no borra: ni datos de apps ni apps (eso lo hace la persona).
  if (/(^|[\s;&|])(pm|cmd\s+package)\s+(clear|uninstall|uninstall-system-updates)\b/.test(comando)) return 'Borrar los datos de una app o desinstalarla lo haces tú (Ajustes → Apps): la IA no tiene herramientas que borren.'
  if (/settings\s+put\s+(global|secure)\s+(adb_enabled|development_settings_enabled|package_verifier|verifier_verify_adb_installs)/.test(comando)) return 'No se cambian ajustes de seguridad o de depuración del sistema desde la IA.'
  return null
}
