import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { nativeImage } from 'electron'
import type { ResultadoHerramienta } from '@shared/core/herramientas'
import {
  analizarDispositivos,
  analizarPrimerPlano,
  analizarTamano,
  analizarVolcadoUi,
  ayudaEstado,
  AYUDA_SIN_DISPOSITIVOS,
  buscarPorTexto,
  codigoTecla,
  explicarErrorAdb,
  instantaneaMovil,
  motivoShellBloqueado,
  textoParaInput,
  type DispositivoAdb,
  type ElementoMovil,
  type InstantaneaMovil,
  type NodoUi
} from '@shared/movil'
import type { ControlNavegador } from './core/herramientas-odesk'
import { cargarPathShell } from './core/suscripcion'

const WINDOWS = process.platform === 'win32'
const MAX_TEXTO = 30_000
/** Alto máximo de la imagen que recibe la IA (la evidencia guardada conserva el tamaño real). */
const ALTO_CAPTURA_IA = 1600
const MAX_ESPERA_MS = 60_000
const VOLCADO = '/data/local/tmp/odesk-ui.xml'
const PAQUETE_VALIDO = /^[a-zA-Z][\w]*(\.[\w]+)+$/

type E = Record<string, unknown>
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const recortar = (t: string): string => (t.length > MAX_TEXTO ? t.slice(0, MAX_TEXTO) + '\n[… recortado]' : t)
/** Argumento para el shell del teléfono (`adb shell` une todo en una línea que interpreta su sh). */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
const marcaTiempo = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

function paquete(v: unknown): string {
  const p = String(v ?? '').trim()
  if (!PAQUETE_VALIDO.test(p)) throw new Error(`«${p}» no parece un paquete de Android (p. ej. com.empresa.app). Usa movil_apps para verlos.`)
  return p
}

/** adb del SDK de Android: variable ODESK_ADB, el PATH del shell, ANDROID_HOME / ANDROID_SDK_ROOT o la carpeta por defecto del SDK. */
export function localizarAdb(entorno: NodeJS.ProcessEnv = process.env): string | undefined {
  const exe = WINDOWS ? 'adb.exe' : 'adb'
  const candidatas = [
    entorno.ODESK_ADB,
    ...(entorno.PATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, exe)),
    ...[entorno.ANDROID_HOME, entorno.ANDROID_SDK_ROOT].filter(Boolean).map((d) => join(d!, 'platform-tools', exe)),
    join(homedir(), 'Android', 'Sdk', 'platform-tools', exe),
    join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', exe),
    ...(entorno.LOCALAPPDATA ? [join(entorno.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', exe)] : [])
  ]
  return candidatas.find((c): c is string => !!c && existsSync(c))
}

interface SalidaAdb {
  stdout: Buffer
  stderr: string
}

/**
 * La IA prueba apps en teléfonos Android conectados por USB, con el adb del SDK (sin shell del equipo: `execFile` con argumentos).
 * Solo lo que permite la depuración USB que el usuario autorizó en el teléfono: sin root ni cambios de seguridad.
 */
export class MovilIA implements ControlNavegador {
  private adb?: string
  /** Último dispositivo usado: el de por defecto cuando hay varios. */
  private ultimo?: string
  /** Última instantánea de cada dispositivo: sus refs son las que entiende movil_tocar. */
  private readonly instantaneas = new Map<string, InstantaneaMovil>()
  private readonly tamanos = new Map<string, { ancho: number; alto: number }>()
  /** Una acción a la vez por dispositivo (dos conversaciones no se pisan los toques). */
  private readonly colas = new Map<string, Promise<unknown>>()

  constructor(private readonly dirEvidencias: string) {}

  async ejecutar(nombre: string, e: E): Promise<ResultadoHerramienta> {
    if (nombre === 'movil_dispositivos') return { texto: await this.listar() }
    const d = await this.dispositivo(e.dispositivo)
    const previa = this.colas.get(d.serie) ?? Promise.resolve()
    const actual = previa.catch(() => undefined).then(() => this.enDispositivo(nombre, d, e))
    this.colas.set(d.serie, actual)
    try {
      return await actual
    } catch (err) {
      // Si el teléfono se desconectó a mitad, las refs ya no valen.
      if (/desconect/i.test((err as Error).message)) this.instantaneas.delete(d.serie)
      throw err
    } finally {
      if (this.colas.get(d.serie) === actual) this.colas.delete(d.serie)
    }
  }

  // ── adb ─────────────────────────────────────────────────────────────────────────────────────────────

  private async binario(): Promise<string> {
    if (this.adb && existsSync(this.adb)) return this.adb
    await cargarPathShell().catch(() => undefined)
    const adb = localizarAdb()
    if (!adb)
      throw new Error(
        'No encuentro adb (Android SDK Platform-Tools). Instálalo desde Android Studio (SDK Manager → Platform-Tools) o de https://developer.android.com/tools/releases/platform-tools, y déjalo en el PATH o en ANDROID_HOME. También puedes indicar la ruta con la variable ODESK_ADB.'
      )
    this.adb = adb
    return adb
  }

  private async correr(args: string[], opciones: { serie?: string; timeoutMs?: number } = {}): Promise<SalidaAdb> {
    const adb = await this.binario()
    const completos = [...(opciones.serie ? ['-s', opciones.serie] : []), ...args]
    return new Promise((resolver, rechazar) => {
      execFile(adb, completos, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: opciones.timeoutMs ?? 30_000, windowsHide: true }, (err, stdout, stderr) => {
        const textoErr = stderr.toString('utf8')
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean }
          if (e.killed) return rechazar(new Error(`adb tardó demasiado (${Math.round((opciones.timeoutMs ?? 30_000) / 1000)} s) en: ${args.join(' ')}. ¿El teléfono está bloqueado o se desconectó?`))
          const detalle = (textoErr || stdout.toString('utf8') || e.message).trim()
          return rechazar(new Error(explicarErrorAdb(detalle)))
        }
        resolver({ stdout, stderr: textoErr })
      })
    })
  }

  /** Comando en el shell del teléfono (usuario `shell`). Devuelve stdout como texto. */
  private async shell(serie: string, comando: string, timeoutMs?: number): Promise<string> {
    const { stdout } = await this.correr(['shell', comando], { serie, ...(timeoutMs ? { timeoutMs } : {}) })
    return stdout.toString('utf8')
  }

  private async dispositivos(): Promise<DispositivoAdb[]> {
    const { stdout } = await this.correr(['devices', '-l'])
    return analizarDispositivos(stdout.toString('utf8'))
  }

  private async listar(): Promise<string> {
    const lista = await this.dispositivos()
    if (!lista.length) return AYUDA_SIN_DISPOSITIVOS
    const lineas = await Promise.all(
      lista.map(async (d) => {
        const conexion = d.emulador ? 'emulador' : d.red ? 'red (wifi)' : 'USB'
        if (d.estado !== 'listo') return `${d.serie} — ${d.modelo ?? 'dispositivo'} · ${conexion} · ${d.crudo.toUpperCase()}\n  → ${ayudaEstado(d, process.platform)}`
        const props = await this.shell(d.serie, 'getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk', 10_000).catch(() => '')
        const [fab, modelo, version, sdk] = props.split(/\r?\n/).map((x) => x.trim())
        return `${d.serie} — ${[fab, modelo || d.modelo].filter(Boolean).join(' ')} · Android ${version || '?'} (SDK ${sdk || '?'}) · ${conexion} · LISTO${d.serie === this.ultimo ? ' · el último que usaste' : ''}`
      })
    )
    return lineas.join('\n')
  }

  private async dispositivo(v: unknown): Promise<DispositivoAdb> {
    const lista = await this.dispositivos()
    const pedido = typeof v === 'string' && v.trim() ? v.trim() : undefined
    const comprobar = (d: DispositivoAdb): DispositivoAdb => {
      if (d.estado !== 'listo') throw new Error(`${d.serie} (${d.modelo ?? 'dispositivo'}) no está listo: ${d.crudo}.\n${ayudaEstado(d, process.platform)}`)
      this.ultimo = d.serie
      return d
    }
    if (pedido) {
      const d = lista.find((x) => x.serie === pedido)
      if (!d) throw new Error(`No hay ningún dispositivo ${pedido} conectado (¿se desconectó?).\n${lista.length ? await this.listar() : AYUDA_SIN_DISPOSITIVOS}`)
      return comprobar(d)
    }
    const ultimo = lista.find((x) => x.serie === this.ultimo && x.estado === 'listo')
    if (ultimo) return ultimo
    if (!lista.length) throw new Error(AYUDA_SIN_DISPOSITIVOS)
    const listos = lista.filter((x) => x.estado === 'listo')
    if (listos.length === 1) return comprobar(listos[0]!)
    if (!listos.length) return comprobar(lista[0]!) // explica qué le falta
    throw new Error(`Hay varios dispositivos listos: indica «dispositivo».\n${await this.listar()}`)
  }

  // ── pantalla ────────────────────────────────────────────────────────────────────────────────────────

  private async tamano(serie: string): Promise<{ ancho: number; alto: number }> {
    const guardado = this.tamanos.get(serie)
    if (guardado) return guardado
    const t = analizarTamano(await this.shell(serie, 'wm size')) ?? { ancho: 1080, alto: 1920 }
    this.tamanos.set(serie, t)
    return t
  }

  private async primerPlano(serie: string): Promise<string | undefined> {
    const salida = await this.shell(serie, "dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity' | head -n 2", 10_000).catch(() => '')
    return analizarPrimerPlano(salida) ?? analizarPrimerPlano(await this.shell(serie, "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -n 2", 10_000).catch(() => ''))
  }

  /** Volcado de la interfaz con uiautomator (reintenta: con animaciones en marcha a veces no llega a «reposo»). */
  private async volcado(serie: string): Promise<NodoUi[]> {
    let ultimoError = ''
    for (let intento = 0; intento < 3; intento++) {
      const salida = await this.shell(serie, `uiautomator dump ${VOLCADO} >/dev/null 2>&1; cat ${VOLCADO}; rm -f ${VOLCADO}`, 30_000).catch((err: Error) => ((ultimoError = err.message), ''))
      const inicio = salida.indexOf('<hierarchy')
      if (inicio >= 0) return analizarVolcadoUi(salida.slice(inicio))
      ultimoError ||= salida.trim()
      await espera(800)
    }
    if (/already registered|UiAutomationService/i.test(ultimoError))
      throw new Error('Otra herramienta (Appium, Maestro, un test de Espresso…) está usando UiAutomator en el teléfono: ciérrala o usa movil_captura y toques por coordenadas.')
    throw new Error(`No se pudo leer la pantalla (${ultimoError.slice(0, 200) || 'uiautomator no respondió'}). Si hay una animación continua o vídeo, usa movil_captura y toca por coordenadas.`)
  }

  private async instantanea(d: DispositivoAdb): Promise<InstantaneaMovil> {
    const [raiz, tam, frente] = await Promise.all([this.volcado(d.serie), this.tamano(d.serie), this.primerPlano(d.serie)])
    const r = instantaneaMovil(raiz, [`Dispositivo: ${d.modelo ?? 'Android'} (${d.serie}) · pantalla ${tam.ancho}×${tam.alto} px`, `Primer plano: ${frente ?? 'desconocido'}`])
    this.instantaneas.set(d.serie, r)
    return r
  }

  private elemento(serie: string, ref: unknown): ElementoMovil {
    const r = String(ref ?? '').replace(/^\[?ref=/, '').replace(/\]$/, '')
    const el = this.instantaneas.get(serie)?.elementos.get(r)
    if (!el) throw new Error(`No conozco la ref ${r} en este dispositivo: pide una movil_instantanea nueva (las refs cambian con cada una).`)
    return el
  }

  /** Dónde tocar: ref de la instantánea, texto visible (con un volcado nuevo) o coordenadas. */
  private async objetivo(d: DispositivoAdb, e: E): Promise<{ x: number; y: number; desc: string }> {
    if (typeof e.ref === 'string' && e.ref) return this.elemento(d.serie, e.ref)
    if (typeof e.texto === 'string' && e.texto) {
      const n = buscarPorTexto(await this.volcado(d.serie), e.texto)
      if (!n) throw new Error(`No veo «${e.texto}» en la pantalla. Pide una movil_instantanea para ver qué hay.`)
      const { x1, y1, x2, y2 } = n.limites
      return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), desc: `«${n.texto || n.descripcion}»` }
    }
    if (typeof e.x === 'number' && typeof e.y === 'number') {
      const t = await this.tamano(d.serie)
      if (e.x < 0 || e.y < 0 || e.x > t.ancho || e.y > t.alto) throw new Error(`(${e.x}, ${e.y}) está fuera de la pantalla (${t.ancho}×${t.alto}).`)
      return { x: Math.round(e.x), y: Math.round(e.y), desc: `(${Math.round(e.x)}, ${Math.round(e.y)})` }
    }
    throw new Error('Indica ref, texto o x/y.')
  }

  /** Tras actuar: la app en primer plano, y aviso si la app que estaba delante desapareció (posible cierre inesperado). */
  private async pie(serie: string, antes?: string): Promise<string> {
    await espera(500)
    const ahora = await this.primerPlano(serie)
    const paqAntes = antes?.split('/')[0]
    const paqAhora = ahora?.split('/')[0]
    let aviso = ''
    if (paqAntes && paqAhora && paqAntes !== paqAhora) {
      const crash = await this.shell(serie, 'logcat -b crash -d -t 40', 10_000).catch(() => '')
      aviso = crash.includes(paqAntes)
        ? `\n⚠ ${paqAntes} se cerró de forma inesperada (crash). Mira movil_logcat con fallos: true.`
        : `\nAhora delante: ${paqAhora} (antes ${paqAntes}).`
    }
    return `Primer plano: ${ahora ?? 'desconocido'}${aviso}`
  }

  // ── herramientas ───────────────────────────────────────────────────────────────────────────────────

  private async enDispositivo(nombre: string, d: DispositivoAdb, e: E): Promise<ResultadoHerramienta> {
    const s = d.serie
    switch (nombre) {
      case 'movil_info': {
        const props = await this.shell(
          s,
          'for p in ro.product.manufacturer ro.product.model ro.build.version.release ro.build.version.sdk ro.product.cpu.abi ro.build.fingerprint; do echo "$p=$(getprop $p)"; done; wm size; wm density; dumpsys battery | grep -E "level|status|AC powered|USB powered"'
        )
        return { texto: `Serie: ${s}\n${props.trim()}\nPrimer plano: ${(await this.primerPlano(s)) ?? 'desconocido'}` }
      }
      case 'movil_instantanea':
        return { texto: recortar((await this.instantanea(d)).texto) }
      case 'movil_tocar': {
        const antes = await this.primerPlano(s)
        const o = await this.objetivo(d, e)
        await this.shell(s, e.largo === true ? `input swipe ${o.x} ${o.y} ${o.x} ${o.y} 800` : `input tap ${o.x} ${o.y}`)
        return { texto: `${e.largo === true ? 'Pulsación larga' : 'Toque'} en ${o.desc}.\n${await this.pie(s, antes)}` }
      }
      case 'movil_escribir': {
        const texto = String(e.texto ?? '')
        const entrada = textoParaInput(texto) // valida antes de tocar nada
        if (typeof e.ref === 'string' && e.ref) {
          const el = this.elemento(s, e.ref)
          await this.shell(s, `input tap ${el.x} ${el.y}`)
          await espera(300)
        }
        if (e.limpiar === true) {
          // Al final del campo y borrar hacia atrás: funciona en todas las versiones (Ctrl+A no siempre llega a los campos).
          await this.shell(s, `input keyevent 123; input keyevent ${Array(80).fill(67).join(' ')}`)
        }
        if (texto) await this.shell(s, `input text ${entrada}`)
        if (e.enviar === true) await this.shell(s, 'input keyevent 66')
        return { texto: `Escrito${e.enviar === true ? ' y pulsado Intro' : ''}.\n${await this.pie(s)}` }
      }
      case 'movil_tecla': {
        const antes = await this.primerPlano(s)
        const codigo = codigoTecla(String(e.tecla))
        await this.shell(s, `input keyevent ${codigo}`)
        return { texto: `Tecla ${String(e.tecla)} (${codigo}).\n${await this.pie(s, antes)}` }
      }
      case 'movil_deslizar': {
        const ms = Math.min(Math.max(Number(e.ms) || 300, 50), 5000)
        let x1: number, y1: number, x2: number, y2: number
        if ([e.x1, e.y1, e.x2, e.y2].every((v) => typeof v === 'number')) [x1, y1, x2, y2] = [e.x1, e.y1, e.x2, e.y2].map((v) => Math.round(v as number)) as [number, number, number, number]
        else {
          const dir = String(e.direccion ?? '')
          if (!['arriba', 'abajo', 'izquierda', 'derecha'].includes(dir)) throw new Error('Indica direccion (arriba, abajo, izquierda, derecha) o x1/y1/x2/y2.')
          const t = await this.tamano(s)
          const zona = typeof e.ref === 'string' && e.ref ? this.elemento(s, e.ref).limites : { x1: 0, y1: 0, x2: t.ancho, y2: t.alto }
          const cx = Math.round((zona.x1 + zona.x2) / 2)
          const cy = Math.round((zona.y1 + zona.y2) / 2)
          const dx = Math.round((zona.x2 - zona.x1) * 0.3)
          const dy = Math.round((zona.y2 - zona.y1) * 0.3)
          ;[x1, y1, x2, y2] =
            dir === 'arriba' ? [cx, cy + dy, cx, cy - dy] : dir === 'abajo' ? [cx, cy - dy, cx, cy + dy] : dir === 'izquierda' ? [cx + dx, cy, cx - dx, cy] : [cx - dx, cy, cx + dx, cy]
        }
        await this.shell(s, `input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`)
        return { texto: `Deslizado de (${x1}, ${y1}) a (${x2}, ${y2}).\n${await this.pie(s)}` }
      }
      case 'movil_esperar': {
        const tope = Math.min(Math.max(Number(e.segundos) || 0, 0) * 1000 || (e.texto || e.desaparece ? 15_000 : 1000), MAX_ESPERA_MS)
        if (typeof e.texto !== 'string' && typeof e.desaparece !== 'string') {
          await espera(tope)
          return { texto: `Esperados ${Math.round(tope / 1000)} s.` }
        }
        const fin = Date.now() + tope
        for (;;) {
          const raiz = await this.volcado(s).catch(() => [] as NodoUi[])
          const aparece = typeof e.texto !== 'string' || !!buscarPorTexto(raiz, e.texto)
          const seFue = typeof e.desaparece !== 'string' || (raiz.length > 0 && !buscarPorTexto(raiz, e.desaparece))
          if (aparece && seFue) return { texto: `Listo${e.texto ? `: aparece «${String(e.texto)}»` : ''}${e.desaparece ? `${e.texto ? ' y' : ':'} ya no está «${String(e.desaparece)}»` : ''}.` }
          if (Date.now() > fin) throw new Error(`Pasaron ${Math.round(tope / 1000)} s y ${!aparece ? `no aparece «${String(e.texto)}»` : `sigue «${String(e.desaparece)}»`}.`)
          await espera(700)
        }
      }
      case 'movil_captura':
        return this.captura(d, e)
      case 'movil_apps': {
        if (typeof e.paquete === 'string' && e.paquete) {
          const p = paquete(e.paquete)
          const info = await this.shell(s, `dumpsys package ${q(p)}`)
          if (!info.includes(`Package [${p}]`)) throw new Error(`${p} no está instalada en ${s}.`)
          const version = /versionName=(\S+)/.exec(info)?.[1]
          const codigo = /versionCode=(\d+)/.exec(info)?.[1]
          const permisos = [...info.matchAll(/(android\.permission\.[A-Z_]+|[\w.]+\.permission\.[\w_]+): granted=(true|false)/g)]
          const concedidos = [...new Set(permisos.filter((m) => m[2] === 'true').map((m) => m[1]!.replace('android.permission.', '')))]
          const denegados = [...new Set(permisos.filter((m) => m[2] === 'false').map((m) => m[1]!.replace('android.permission.', '')))]
          const actividad = (await this.shell(s, `cmd package resolve-activity --brief ${q(p)}`).catch(() => '')).trim().split(/\r?\n/).pop()
          return {
            texto: [
              `${p} ${version ?? ''} (código ${codigo ?? '?'})`,
              `Actividad principal: ${actividad && actividad.includes('/') ? actividad : 'sin pantalla de inicio'}`,
              `Permisos concedidos: ${concedidos.join(', ') || 'ninguno'}`,
              `Permisos NO concedidos: ${denegados.join(', ') || 'ninguno'}${denegados.length ? ' (los concede la persona en Ajustes → Apps, o al aceptar el aviso de la app)' : ''}`
            ].join('\n')
          }
        }
        const lista = (await this.shell(s, e.sistema === true ? 'pm list packages' : 'pm list packages -3'))
          .split(/\r?\n/)
          .map((l) => l.replace(/^package:/, '').trim())
          .filter((l) => l && (typeof e.filtro !== 'string' || l.includes(e.filtro)))
          .sort()
        return { texto: lista.length ? recortar(lista.join('\n')) : 'No hay apps que coincidan.' }
      }
      case 'movil_abrir_app': {
        const enlace = typeof e.enlace === 'string' && e.enlace ? e.enlace : undefined
        const p = e.paquete !== undefined && e.paquete !== '' ? paquete(e.paquete) : undefined
        if (!p && !enlace) throw new Error('Indica paquete (o un enlace).')
        if (enlace && !/^[a-z][\w+.-]*:\/\/\S+$/i.test(enlace)) throw new Error('El enlace debe ser una URL, p. ej. miapp://perfil/1 o https://…')
        if (p && !(await this.shell(s, `pm path ${q(p)}`).catch(() => '')).includes('package:')) throw new Error(`${p} no está instalada en ${s}: instálala con movil_instalar.`)
        let salida: string
        if (enlace) salida = await this.shell(s, `am start -W -a android.intent.action.VIEW -d ${q(enlace)}${p ? ` ${q(p)}` : ''}`, 30_000)
        else if (typeof e.actividad === 'string' && e.actividad) {
          if (!/^[\w.$]+$/.test(e.actividad)) throw new Error('Actividad no válida.')
          salida = await this.shell(s, `am start -W -n ${q(`${p}/${e.actividad}`)}`, 30_000)
        } else salida = await this.shell(s, `monkey -p ${q(p!)} -c android.intent.category.LAUNCHER 1`, 30_000)
        if (/Error|No activities found|does not exist|aborted/i.test(salida)) throw new Error(`No se pudo abrir: ${salida.trim().split(/\r?\n/).slice(-3).join(' ')}`)
        await espera(1500)
        const frente = await this.primerPlano(s)
        const tiempo = /TotalTime:\s*(\d+)/.exec(salida)?.[1]
        let aviso = ''
        if (p && frente && !frente.startsWith(p + '/')) {
          const crash = await this.shell(s, 'logcat -b crash -d -t 40', 10_000).catch(() => '')
          aviso = crash.includes(p) ? `\n⚠ ${p} se cerró nada más abrirse (crash). Mira movil_logcat con fallos: true.` : `\nOjo: delante está ${frente}, no ${p}.`
        }
        this.instantaneas.delete(s)
        return { texto: `Abierta ${p ?? enlace}${tiempo ? ` (arranque ${tiempo} ms)` : ''}.\nPrimer plano: ${frente ?? 'desconocido'}${aviso}` }
      }
      case 'movil_cerrar_app': {
        const p = paquete(e.paquete)
        await this.shell(s, `am force-stop ${q(p)}`)
        return { texto: `${p} cerrada.` }
      }
      case 'movil_instalar': {
        const apk = String(e.apk)
        if (!/\.apk$/i.test(apk)) throw new Error('Solo se instalan archivos .apk (para .aab genera antes un APK, p. ej. con bundletool o ./gradlew assembleDebug).')
        if (!existsSync(apk) || !statSync(apk).isFile()) throw new Error(`No existe el archivo ${apk}. ¿Lo compilaste? (Android: ./gradlew assembleDebug → app/build/outputs/apk/debug/)`)
        const { stdout } = await this.correr(['install', '-r', ...(e.conceder_permisos === true ? ['-g'] : []), apk], { serie: s, timeoutMs: 5 * 60_000 })
        const salida = stdout.toString('utf8')
        if (!/Success/.test(salida)) throw new Error(explicarErrorAdb(salida))
        return { texto: `Instalado ${apk} en ${s}${e.conceder_permisos === true ? ' (con todos sus permisos de ejecución concedidos)' : ''}.` }
      }
      case 'movil_logcat':
        return this.logcat(s, e)
      case 'movil_shell': {
        const comando = String(e.comando ?? '').trim()
        if (!comando) throw new Error('Indica el comando.')
        const bloqueo = motivoShellBloqueado(comando)
        if (bloqueo) throw new Error(bloqueo)
        const salida = await this.shell(s, comando, 60_000)
        return { texto: recortar(salida.trim() || '(sin salida)') }
      }
    }
    throw new Error(`Herramienta de móvil desconocida: ${nombre}`)
  }

  private async carpetaEvidencias(serie: string): Promise<string> {
    const dir = join(this.dirEvidencias, serie.replace(/[^\w.-]/g, '_'))
    await mkdir(dir, { recursive: true })
    return dir
  }

  private async captura(d: DispositivoAdb, e: E): Promise<ResultadoHerramienta> {
    const { stdout } = await this.correr(['exec-out', 'screencap', '-p'], { serie: d.serie, timeoutMs: 30_000 })
    let img = nativeImage.createFromBuffer(stdout)
    if (img.isEmpty()) throw new Error('La captura salió vacía (¿pantalla apagada o app que bloquea capturas, FLAG_SECURE?). Prueba movil_tecla despertar.')
    const real = img.getSize()
    const nombre = typeof e.nombre === 'string' && e.nombre ? e.nombre.replace(/[^\w.-]+/g, '-').slice(0, 60) : 'captura'
    const archivo = join(await this.carpetaEvidencias(d.serie), `${marcaTiempo()}-${nombre}.png`)
    await writeFile(archivo, stdout)
    if (real.height > ALTO_CAPTURA_IA) img = img.resize({ height: ALTO_CAPTURA_IA, quality: 'good' })
    const { width, height } = img.getSize()
    const escala = width / real.width
    return {
      texto: `Captura de ${d.serie} (${real.width}×${real.height} px reales${escala < 1 ? `; la imagen va reducida a ${width}×${height}: para tocar por coordenadas divide entre ${escala.toFixed(3)}` : ''}).\nEvidencia: ${archivo}`,
      imagen: { datos: img.toJPEG(80).toString('base64'), tipo: 'image/jpeg' }
    }
  }

  private async logcat(s: string, e: E): Promise<ResultadoHerramienta> {
    const lineas = Math.min(Math.max(Number(e.lineas) || 200, 10), 2000)
    const args = ['logcat', '-d', '-v', 'time']
    if (e.fallos === true) args.push('-b', 'crash')
    let nota = ''
    let filtroPaquete: string | undefined
    if (typeof e.paquete === 'string' && e.paquete && e.fallos !== true) {
      const p = paquete(e.paquete)
      const pid = (await this.shell(s, `pidof ${q(p)}`).catch(() => '')).trim().split(/\s+/)[0]
      if (pid && /^\d+$/.test(pid)) args.push(`--pid=${pid}`)
      else {
        filtroPaquete = p
        nota = `(${p} no está en marcha: se muestran las líneas que la mencionan)\n`
      }
    }
    // `-t N` corta ANTES de filtrar por nivel: con filtros se piden muchas más y se recorta aquí.
    const filtrando = !!filtroPaquete || e.solo_errores === true || (typeof e.filtro === 'string' && !!e.filtro)
    args.push('-t', String(filtrando ? 20_000 : lineas))
    if (e.solo_errores === true) args.push('*:E')
    const { stdout } = await this.correr(args, { serie: s, timeoutMs: 60_000 })
    let texto = stdout.toString('utf8')
    let lista = texto.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('--------- beginning of'))
    if (filtroPaquete) lista = lista.filter((l) => l.includes(filtroPaquete!))
    if (typeof e.filtro === 'string' && e.filtro) lista = lista.filter((l) => l.includes(e.filtro as string))
    lista = lista.slice(-lineas)
    texto = lista.join('\n')
    let guardado = ''
    if (e.guardar === true) {
      const archivo = join(await this.carpetaEvidencias(s), `${marcaTiempo()}-logcat.txt`)
      await writeFile(archivo, texto + '\n')
      guardado = `\nEvidencia: ${archivo}`
    }
    if (e.limpiar === true) await this.correr(['logcat', '-c', ...(e.fallos === true ? ['-b', 'crash'] : [])], { serie: s }).catch(() => undefined)
    if (!lista.length) return { texto: `${nota}${e.fallos === true ? 'No hay cierres inesperados registrados.' : 'No hay líneas que coincidan.'}${guardado}` }
    return { texto: recortar(nota + texto) + guardado }
  }
}
