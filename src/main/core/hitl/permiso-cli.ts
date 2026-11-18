import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { sinValoresCredencial } from '@shared/credenciales-herramientas'
import type { EventoAgente, PreguntaUsuario } from '@shared/core/agente'
import type { LlamadaHerramienta } from '@shared/core/herramientas'
import type { NuevaRegla, ReglaPermiso } from '@shared/core/permisos'
import type { ModoAutonomia } from '@shared/core/permisos'
import { motivoBloqueoAutonomo } from '../guardrails/autonomo'
import { esDestructiva } from '../guardrails/destructivo'
import { esBashSoloLectura } from '../guardrails/solo-lectura'
import { detectarSecretos, type Hallazgo } from '../guardrails/secretos'
import { grepSensible, motivoBashSensible, rutaSensible } from '../guardrails/acceso-sensible'
import { avisoSecretos } from './aprobador'
import type { PuertaHumana, SolicitudHumana } from '../orchestrator/puerta'
import { decidir, reglaDe } from '../permisos/reglas'
import type { PeticionPermiso, RespuestaPermiso } from '../suscripcion'
import { armarSudo, olvidarSolicitudSudo, registrarSolicitudSudo, reescribirSudo, sinSudo, tomarPasswordSudo, usaSudo } from './sudo'
import { PREFIJO_MCP } from '@shared/herramientas-odesk'

export interface DepsPermisoCli {
  puerta: PuertaHumana
  ejecucionId: string
  alEvento: (e: EventoAgente) => void
  senal?: AbortSignal
  /** Guardrails: motivo por el que se bloquea la llamada, o null. */
  validar: (l: LlamadaHerramienta) => Promise<string | null>
  reglas: () => Promise<readonly ReglaPermiso[]>
  guardarRegla: (r: NuevaRegla) => Promise<void>
  /** En «autónomo» nadie confirma: los comandos se aprueban solos salvo los catastróficos (`motivoBloqueoAutonomo`), que se deniegan. */
  autonomia?: ModoAutonomia
  /**
   * Acceso a credenciales ya autorizado en esta conversación: con la contraseña verificada una vez, el resto de accesos de la misma
   * conversación no la vuelven a pedir. Vive solo en memoria (cerrar la app lo olvida). Sin esto, se pide cada vez.
   */
  credenciales?: { autorizadas: () => boolean; autorizar: () => void }
}

const MAX_DETALLE = 1500
const recortar = (t: string): string => (t.length > MAX_DETALLE ? t.slice(0, MAX_DETALLE) + '\n[… recortado]' : t)
const META_SHELL = /[;&|`$()<>\n\\]/

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Preguntas de `AskUserQuestion` en el formato de la app. */
function leerPreguntas(entrada: Record<string, unknown>): PreguntaUsuario[] {
  const qs = Array.isArray(entrada.questions) ? (entrada.questions as Record<string, unknown>[]) : []
  return qs
    .filter((q) => texto(q.question))
    .map((q) => ({
      pregunta: texto(q.question),
      ...(texto(q.header) ? { encabezado: texto(q.header) } : {}),
      opciones: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : [])
        .filter((o) => texto(o.label))
        .map((o) => ({ etiqueta: texto(o.label), ...(texto(o.description) ? { descripcion: texto(o.description) } : {}) })),
      ...(q.multiSelect === true ? { multiple: true } : {})
    }))
}

/** Herramienta del CLI -> llamada con el vocabulario de la app (guardrails, reglas y detección de lo destructivo). */
function traducir(p: PeticionPermiso): { llamada: LlamadaHerramienta; descripcion: string; simple: boolean } {
  const e = p.entrada
  const id = 'cli'
  switch (p.herramienta) {
    case 'Bash': {
      const linea = texto(e.command).trim()
      const [comando = '', ...args] = linea.split(/\s+/)
      return { llamada: { id, nombre: 'ejecutar_comando', entrada: { comando, args } }, descripcion: `$ ${linea}`, simple: !META_SHELL.test(linea) && !/['"]/.test(linea) }
    }
    case 'Write':
      return { llamada: { id, nombre: 'escribir_archivo', entrada: { ruta: texto(e.file_path), contenido: texto(e.content) } }, descripcion: `Escribir ${texto(e.file_path)}\n\n${recortar(texto(e.content))}`, simple: true }
    case 'Edit':
      return {
        llamada: { id, nombre: 'escribir_archivo', entrada: { ruta: texto(e.file_path), contenido: texto(e.new_string) } },
        descripcion: `Editar ${texto(e.file_path)}\n\n- ${recortar(texto(e.old_string)).replace(/\n/g, '\n- ')}\n+ ${recortar(texto(e.new_string)).replace(/\n/g, '\n+ ')}`,
        simple: true
      }
    case 'MultiEdit':
    case 'NotebookEdit':
      return { llamada: { id, nombre: 'escribir_archivo', entrada: { ruta: texto(e.file_path) || texto(e.notebook_path), contenido: '' } }, descripcion: `${p.herramienta} ${texto(e.file_path) || texto(e.notebook_path)}\n\n${recortar(JSON.stringify(e, null, 2))}`, simple: true }
    default:
      // (La confirmación queda en la conversación: una credencial que se guarda se muestra sin sus valores.)
      return { llamada: { id, nombre: p.herramienta, entrada: e }, descripcion: `${p.herramienta}\n${recortar(JSON.stringify(sinValoresCredencial(p.herramienta, e), null, 2))}`, simple: true }
  }
}

/** Motivo destructivo de un `Bash` (en un comando compuesto, cualquier tramo cuenta). */
function razonDestructiva(llamada: LlamadaHerramienta, linea: string | null, simple: boolean): string | null {
  return (
    esDestructiva(llamada.nombre, llamada.entrada) ??
    (linea !== null && !simple
      ? linea.split(/&&|\|\||[;|\n]/).map((t) => t.trim().split(/\s+/)).map(([comando = '', ...args]) => esDestructiva('ejecutar_comando', { comando, args })).find(Boolean) ?? null
      : null)
  )
}

const MAX_LECTURA_SECRETOS = 2 * 1024 * 1024

/** Credenciales de un archivo que el CLI quiere leer (las mismas reglas que el gancho). Ilegible, enorme o binario: ninguna. */
async function secretosDeArchivo(ruta: string): Promise<Hallazgo[]> {
  try {
    if (!ruta || !isAbsolute(ruta) || (await stat(ruta)).size > MAX_LECTURA_SECRETOS) return []
    const datos = await readFile(ruta)
    if (datos.subarray(0, 8000).includes(0)) return []
    return detectarSecretos(datos.toString('utf8'))
  } catch {
    return []
  }
}

/**
 * Acceso a credenciales o variables de entorno (archivo `.env`, claves, secretos de producción, `credenciales_obtener`…): se permite
 * solo si una persona escribe la contraseña del equipo en el modal (en cualquier modo de autonomía; sin nadie delante, como en las
 * tareas programadas, la solicitud se deniega sola). La contraseña se verifica en main (`core:sudo-verificar`, mismo registro que
 * `sudo`) y se descarta en cuanto se comprueba: no se guarda ni se usa para nada más.
 */
export async function pedirContrasena(
  d: DepsPermisoCli,
  alSolicitar: (id: string, s: SolicitudHumana) => void,
  o: { herramienta: string; contenido: string; motivo: string }
): Promise<RespuestaPermiso> {
  const evento = (m: string): void => d.alEvento({ ejecucionId: d.ejecucionId, agente: 'asistente', profundidad: 0, tipo: 'guardrail', herramienta: o.herramienta, motivo: m } as EventoAgente)
  if (d.credenciales?.autorizadas()) {
    evento(`acceso a credenciales permitido (ya autorizado en esta conversación): ${o.motivo}`)
    return { permitir: true }
  }
  const negado = `El usuario no autorizó este acceso a credenciales (${o.motivo}). No lo intentes por otra vía (cat, grep, sed, otro comando…); si necesitas un dato que no sea secreto, pídeselo al usuario.`
  let sid = ''
  try {
    const dec = await d.puerta.solicitar(
      {
        clase: 'accion',
        contenido: o.contenido,
        detalle: `El asistente quiere acceder a credenciales o variables de entorno: ${o.motivo}. Lo que lea se envía al modelo.`,
        herramienta: o.herramienta,
        sudo: true,
        credenciales: true
      },
      (id, sol) => {
        sid = id
        registrarSolicitudSudo(id)
        alSolicitar(id, sol)
      },
      d.senal
    )
    // Aprobado sin contraseña verificada (otra ventana, una respuesta forjada): no vale.
    const verificada = sid ? tomarPasswordSudo(sid) !== undefined : false
    if (!dec.aprobado || !verificada) {
      evento(`acceso a credenciales denegado: ${o.motivo}`)
      return { permitir: false, mensaje: dec.comentario ? `${negado} Comentario del usuario: ${dec.comentario}` : negado }
    }
    d.credenciales?.autorizar()
    evento(`acceso a credenciales autorizado con la contraseña del equipo: ${o.motivo}`)
    return { permitir: true }
  } finally {
    if (sid) olvidarSolicitudSudo(sid)
  }
}

/**
 * Lectura de un archivo sensible por su nombre (`.env`, claves…) o con posibles credenciales dentro: su contenido iría al modelo.
 * Pide la contraseña del equipo. Si no es sensible por nombre y al revisarlo aquí ya no tiene credenciales, se deja leer.
 */
async function leerConSecretos(p: PeticionPermiso, d: DepsPermisoCli, alSolicitar: (id: string, s: SolicitudHumana) => void): Promise<RespuestaPermiso> {
  const ruta = texto(p.entrada.file_path)
  const porNombre = rutaSensible(ruta)
  const hallazgos = await secretosDeArchivo(ruta)
  if (!porNombre && !hallazgos.length) return { permitir: true }
  return pedirContrasena(d, alSolicitar, {
    herramienta: 'Read',
    contenido: hallazgos.length ? avisoSecretos(`«${ruta}»`, hallazgos, 'el asistente no recibe el archivo y sigue sin él.') : `Leer «${ruta}»`,
    motivo: `leer «${ruta}»${porNombre ? ' (archivo de credenciales)' : ' (contiene posibles credenciales)'}`
  })
}

/**
 * Responde a lo que el CLI de suscripción no puede decidir solo (`--permission-prompt-tool stdio`): las preguntas con opciones
 * (`AskUserQuestion`) y los permisos para escribir, ejecutar o usar herramientas. Mismas garantías que en modo API: los guardrails y
 * las reglas de denegación van primero, lo destructivo siempre se pregunta y nunca se recuerda.
 */
export function crearPermisoCli(d: DepsPermisoCli): (p: PeticionPermiso) => Promise<RespuestaPermiso> {
  const recordadas = new Set<string>()
  const alSolicitar = (solicitudId: string, s: SolicitudHumana): void =>
    d.alEvento({ ejecucionId: d.ejecucionId, agente: 'asistente', profundidad: 0, tipo: 'solicitud_humana', solicitudId, ...s } as EventoAgente)

  return async (p) => {
    try {
      if (p.herramienta === 'AskUserQuestion') {
        const preguntas = leerPreguntas(p.entrada)
        if (!preguntas.length) return { permitir: true }
        const dec = await d.puerta.solicitar({ clase: 'pregunta', contenido: preguntas.map((q) => q.pregunta).join('\n'), preguntas }, alSolicitar, d.senal)
        if (!dec.aprobado) return { permitir: false, mensaje: dec.comentario ? `El usuario no quiso responder: ${dec.comentario}` : 'El usuario no quiso responder las preguntas.' }
        return { permitir: true, entrada: { ...p.entrada, answers: dec.respuestas ?? {} } }
      }

      // `Read`/`Grep` solo llegan aquí si el gancho de la guardia vio un archivo sensible («ask»): lo demás el CLI lo lee sin preguntar.
      if (p.herramienta === 'Read') return await leerConSecretos(p, d, alSolicitar)
      if (p.herramienta === 'Grep') {
        const motivo = grepSensible(p.entrada)
        return motivo ? await pedirContrasena(d, alSolicitar, { herramienta: 'Grep', contenido: `Grep ${JSON.stringify(p.entrada)}`, motivo }) : { permitir: true }
      }
      if (p.herramienta === `${PREFIJO_MCP}credenciales_obtener`) {
        const nombre = texto(p.entrada.nombre) || 'credencial'
        return await pedirContrasena(d, alSolicitar, { herramienta: p.herramienta, contenido: `Obtener los valores de la credencial «${nombre}»`, motivo: `obtener los valores de «${nombre}»` })
      }

      const { llamada, descripcion, simple } = traducir(p)
      const bloqueo = await d.validar(llamada)
      if (bloqueo) return { permitir: false, mensaje: `Bloqueado: ${bloqueo}` }
      const regla = simple ? decidir(await d.reglas(), llamada) : null
      if (regla === 'denegar') return { permitir: false, mensaje: 'Una regla de permisos de este proyecto lo deniega.' }
      // Comando que lee credenciales o variables de entorno: contraseña del equipo, aunque sea de solo lectura o esté en «autónomo».
      // Con `sudo` va por su propio modal, que ya pide la contraseña.
      const motivoSensible = p.herramienta === 'Bash' && !usaSudo(texto(p.entrada.command)) ? motivoBashSensible(texto(p.entrada.command)) : null
      if (motivoSensible) {
        if (d.autonomia === 'autonomo') {
          const bloqueoAuto = motivoBloqueoAutonomo(texto(p.entrada.command))
          if (bloqueoAuto) return { permitir: false, mensaje: `Bloqueado en modo autónomo: ${bloqueoAuto}. No lo intentes de otra forma.` }
        }
        const r = await pedirContrasena(d, alSolicitar, { herramienta: 'Bash', contenido: descripcion, motivo: motivoSensible })
        if (!r.permitir) return r
        const razonCmd = razonDestructiva(llamada, texto(p.entrada.command), simple)
        if (!razonCmd) return r
        // Además destructivo: la contraseña no sustituye a la confirmación de lo destructivo (sigue abajo).
      }
      // `sudo`: el CLI no tiene terminal donde pedir la contraseña. Se pide en el modal (en cualquier modo de autonomía: hace
      // falta una persona) y el comando se reescribe a `sudo -A` con el ayudante de la app (`./sudo.ts`).
      if (p.herramienta === 'Bash' && process.platform !== 'win32' && usaSudo(texto(p.entrada.command))) {
        const linea = texto(p.entrada.command).trim()
        const interior = sinSudo(linea)
        if (d.autonomia === 'autonomo') {
          const motivo = motivoBloqueoAutonomo(interior)
          if (motivo) {
            d.alEvento({ ejecucionId: d.ejecucionId, agente: 'asistente', profundidad: 0, tipo: 'guardrail', herramienta: 'Bash', motivo } as EventoAgente)
            return { permitir: false, mensaje: `Bloqueado en modo autónomo: ${motivo}. No lo intentes de otra forma.` }
          }
        }
        const [c = '', ...a] = interior.split(/\s+/)
        const razon = razonDestructiva({ id: 'cli', nombre: 'ejecutar_comando', entrada: { comando: c, args: a } }, interior, !META_SHELL.test(interior) && !/['"]/.test(interior))
        let sid = ''
        try {
          const dec = await d.puerta.solicitar(
            {
              clase: 'accion',
              contenido: descripcion,
              detalle: `El asistente necesita permisos de administrador (sudo) para este comando${razon ? ` — ACCIÓN DESTRUCTIVA: ${razon}` : ''}`,
              herramienta: 'Bash',
              sudo: true,
              ...(razon ? { destructivo: true } : {})
            },
            (id, s) => {
              sid = id
              registrarSolicitudSudo(id)
              alSolicitar(id, s)
            },
            d.senal
          )
          const password = sid ? tomarPasswordSudo(sid) : undefined
          if (!dec.aprobado) return { permitir: false, mensaje: dec.comentario ? `El usuario denegó los permisos de administrador: ${dec.comentario}` : 'El usuario denegó los permisos de administrador (sudo). No lo intentes de otra forma.' }
          if (!password) return { permitir: false, mensaje: 'No se recibió la contraseña de administrador.' }
          const { askpass, token } = await armarSudo(password, d.senal)
          return { permitir: true, entrada: { ...p.entrada, command: reescribirSudo(linea, askpass, token) } }
        } finally {
          if (sid) olvidarSolicitudSudo(sid)
        }
      }
      if (d.autonomia === 'autonomo' && p.herramienta === 'Bash') {
        const motivo = motivoBloqueoAutonomo(texto(p.entrada.command))
        if (!motivo) return { permitir: true }
        d.alEvento({ ejecucionId: d.ejecucionId, agente: 'asistente', profundidad: 0, tipo: 'guardrail', herramienta: 'Bash', motivo } as EventoAgente)
        return {
          permitir: false,
          mensaje: `Bloqueado en modo autónomo: ${motivo}. No lo intentes de otra forma; si de verdad hace falta, explícale al usuario qué comando debe ejecutar él y por qué.`
        }
      }
      const razon = razonDestructiva(llamada, p.herramienta === 'Bash' ? texto(p.entrada.command) : null, simple)
      if (!razon && regla === 'permitir') return { permitir: true }
      // Un `Bash` que solo lee (grep, ls, git log, sed -n…) vale lo mismo que Read/Grep, que ya se permiten siempre: no se pregunta.
      if (!razon && p.herramienta === 'Bash' && esBashSoloLectura(texto(p.entrada.command))) return { permitir: true }
      if (!razon && recordadas.has(p.herramienta)) return { permitir: true }

      const oferta = !razon && simple ? reglaDe(llamada) : null
      const dec = await d.puerta.solicitar(
        {
          clase: 'accion',
          contenido: descripcion,
          detalle: `El asistente quiere usar «${p.herramienta}»${razon ? ` — ACCIÓN DESTRUCTIVA: ${razon}` : ''}`,
          herramienta: p.herramienta,
          ...(razon ? { destructivo: true } : {}),
          ...(oferta ? { puedeSiempre: true } : {})
        },
        alSolicitar,
        d.senal
      )
      if (!dec.aprobado) return { permitir: false, mensaje: dec.comentario ? `El usuario lo rechazó: ${dec.comentario}` : 'El usuario rechazó esta acción.' }
      if (dec.recordar && !razon) recordadas.add(p.herramienta)
      if (dec.siempre && oferta) await d.guardarRegla(oferta).catch(() => undefined)
      return { permitir: true }
    } catch {
      return { permitir: false, mensaje: 'Cancelado.' }
    }
  }
}
