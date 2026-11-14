import type { ResultadoHerramienta } from '@shared/core/herramientas'
import type { EventoAgente } from '@shared/core/agente'
import type { ResumenSesion, SesionGuardada } from '@shared/core/sesion'
import type { ComandoArranque, ConflictoPuerto, EstadoArranque, ResultadoArrancar } from '@shared/arranque'
import type { DatosProyectos } from '@shared/modelos'
import type { AccionIa } from '@shared/control-app'
import type { EntradaComandoArranque, ResultadoGuardarArranque } from '@shared/arranque'
import type { ComandoUsuario } from '@shared/core/comandos'
import type { BibliotecaAgentes } from '@shared/modelos'
import type { Coleccion, DatosApi, PeticionApi, RespuestaApi } from '@shared/api'
import type { ContactoChat, ConversacionChat, PaginaMensajes } from '@shared/chat'
import { randomUUID } from 'node:crypto'
import { motivoBloqueoAutonomo } from './core/guardrails/autonomo'

/** Lo que se sabe de cada terminal (pty) de la interfaz: lo anota main al crearla. */
export interface MetaTerminal {
  proyectoId?: string
  titulo?: string
  claude?: boolean
  creada: number
  /** La abrió una IA con terminal_abrir. */
  ia?: boolean
}

/** Todo lo que el controlador necesita de la app (se inyecta desde `index.ts`; en tests, falsos). */
export interface DependenciasApp {
  proyectos(): Promise<DatosProyectos>
  pendientes(): Promise<{ id: string; nombre: string; repo: string; grupoId?: string }[]>
  quitarProyecto(id: string): Promise<void>
  clonar(entrada: { proyectoId: string; carpetaPadre?: string }): Promise<{ ruta: string }>
  terminales: {
    vivas(): string[]
    meta(id: string): MetaTerminal | undefined
    historial(id: string): string
    enShell(id: string): boolean
    escribir(id: string, datos: string): void
    cerrar(id: string): void
    /** Crea el pty (con Claude Code si `claude`) y devuelve su id. */
    crear(o: { cwd: string; proyectoId: string; claude: boolean; titulo: string }): Promise<string>
  }
  arranque: {
    listar(proyectoId: string): Promise<ComandoArranque[]>
    estados(proyectoId: string): Promise<EstadoArranque[]>
    revisar(proyectoId: string, ids?: string[]): Promise<ConflictoPuerto[]>
    arrancar(proyectoId: string, ids?: string[]): Promise<ResultadoArrancar>
    detener(proyectoId: string, ids?: string[]): Promise<EstadoArranque[]>
  }
  sesiones: { listar(proyectoId?: string): Promise<ResumenSesion[]>; transcripcion(id: string): Promise<SesionGuardada | undefined> }
  ajustes: { leer(clave: string): Promise<unknown>; fijar(clave: string, cambios: Record<string, string | null>): Promise<unknown> }
  cuentas: { estado(): Promise<unknown>; activar(id: string): Promise<unknown> }
  consumo(): Promise<unknown>
  historial(op: string, entrada: Record<string, unknown>): Promise<unknown>
  /** Avisa a la interfaz (abrir/enfocar, mostrar una terminal, cerrar una celda, mandar un mensaje al Asistente). */
  interfaz(a: AccionIa): void
  esperar?(ms: number): Promise<void>
  // Módulos que se conectaron después. Opcionales: sin ellos la herramienta responde que no está disponible.
  proyectosEdicion?: { renombrar(id: string, nombre: string): Promise<unknown>; moverGrupo(id: string, grupoId: string | null): Promise<unknown> }
  arranqueConfig?: { guardar(proyectoId: string, comando: EntradaComandoArranque): Promise<ResultadoGuardarArranque>; eliminar(proyectoId: string, id: string): Promise<unknown> }
  /** `ambito` = 'global' o el id del proyecto. */
  comandos?: { listar(ambito: string): Promise<ComandoUsuario[]>; guardar(c: ComandoUsuario, ambito: string): Promise<unknown>; eliminar(nombre: string, ambito: string): Promise<unknown> }
  agentes?: { biblioteca(): Promise<BibliotecaAgentes>; activar(destino: { tipo: 'proyecto' | 'grupo'; id: string }, recursoId: string, activo: boolean): Promise<unknown> }
  /** Operaciones tipadas de los módulos (las mismas que usa la interfaz por IPC); lanzan si fallan. */
  equipos?(op: string, entrada: Record<string, unknown>): Promise<unknown>
  api?(op: string, entrada: Record<string, unknown>): Promise<unknown>
  chat?(op: string, entrada: Record<string, unknown>): Promise<unknown>
  notificar?(titulo: string, cuerpo: string): boolean
}

const MAX_RESPUESTA_API = 12_000

function falta<T>(v: T | undefined, que: string): T {
  if (!v) throw new Error(`${que} no está disponible en esta sesión de Odesk.`)
  return v
}

type Entrada = Record<string, unknown>
const MAX_SALIDA = 30_000

// eslint-disable-next-line no-control-regex -- quitar secuencias de escape de la terminal es justo lo que se busca
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][A-Za-z0-9]|\u001b[=>78MDEHc]/g
/** Texto de terminal legible: sin secuencias ANSI, con los retornos de carro resueltos (la última escritura de cada línea). */
export function textoTerminal(crudo: string, lineas: number): string {
  const limpio = crudo
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => {
      const partes = l.split('\r')
      return partes.reduce((acc, p) => (p.length >= acc.length ? p : p + acc.slice(p.length)), '')
    })
    // eslint-disable-next-line no-control-regex -- caracteres de control sueltos de la terminal
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trimEnd())
  while (limpio.length && !limpio[limpio.length - 1]) limpio.pop()
  return limpio.slice(-lineas).join('\n')
}

const TECLAS: Record<string, string> = { 'ctrl+c': '\u0003', 'ctrl+d': '\u0004', escape: '\u001b', enter: '\r', tab: '\t', arriba: '\u001b[A', abajo: '\u001b[B' }
const acotar = (v: unknown, def: number, max: number): number => Math.min(Math.max(Math.trunc(Number(v)) || def, 1), max)
const ids = (v: unknown): string[] | undefined => (Array.isArray(v) && v.length ? v.map(String) : undefined)
const aTexto = (v: unknown): string => {
  const t = typeof v === 'string' ? v : JSON.stringify(v, null, 1)
  return t.length > MAX_SALIDA ? t.slice(0, MAX_SALIDA) + '\n[… recortado]' : t
}

function textoDeTurno(eventos: EventoAgente[]): string {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i] as { tipo: string; resultado?: { texto?: string; error?: string }; texto?: string }
    if (e.tipo === 'fin' && (e.resultado?.texto || e.resultado?.error)) return e.resultado.texto || `(error) ${e.resultado.error}`
  }
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i] as { tipo: string; texto?: string }
    if (e.tipo === 'texto' && e.texto) return e.texto
  }
  return ''
}

/**
 * Herramientas de la aplicación (`HERRAMIENTAS_APP`) ya validadas: aquí se ejecutan contra los servicios reales. Lo que cierra, para,
 * quita, restaura o sube permisos ya viene aprobado por la persona (lo pregunta el ejecutor común antes de llegar aquí).
 */
export class ControlApp {
  constructor(private readonly d: DependenciasApp) {}

  private async proyecto(e: Entrada, porDefecto?: string): Promise<{ id: string; nombre: string; ruta: string }> {
    const id = (typeof e.proyecto_id === 'string' && e.proyecto_id) || porDefecto
    if (!id) throw new Error('Indica proyecto_id (odesk_proyectos da los ids): esta conversación no está ligada a un proyecto.')
    const p = (await this.d.proyectos()).proyectos.find((x) => x.id === id)
    if (!p) throw new Error(`No hay un proyecto con id ${id} en este equipo (odesk_proyectos da los ids; los «pendientes» se clonan con proyecto_clonar).`)
    return p
  }

  private terminal(e: Entrada): string {
    const id = String(e.terminal ?? '')
    if (!this.d.terminales.vivas().includes(id)) throw new Error(`No hay una terminal abierta con id ${id} (terminal_listar da los ids).`)
    return id
  }

  async ejecutar(nombre: string, e: Entrada, ctx: { proyectoId?: string | undefined; cliente?: string | undefined }): Promise<ResultadoHerramienta> {
    try {
      const r = await this.correr(nombre, e, ctx.proyectoId)
      return typeof r === 'object' && r && 'texto' in r && typeof (r as ResultadoHerramienta).texto === 'string' ? (r as ResultadoHerramienta) : { texto: aTexto(r) }
    } catch (err) {
      return { texto: (err as Error).message, error: true }
    }
  }

  private async correr(nombre: string, e: Entrada, ctxProyecto?: string): Promise<unknown> {
    const d = this.d
    switch (nombre) {
      case 'odesk_proyectos': {
        const datos = await d.proyectos()
        const vivas = d.terminales.vivas().map((id) => d.terminales.meta(id))
        const estados = await Promise.all(datos.proyectos.map((p) => d.arranque.estados(p.id).catch(() => [])))
        return {
          grupos: datos.grupos.map((g) => ({ id: g.id, nombre: g.nombre })),
          proyectos: datos.proyectos.map((p, i) => ({
            id: p.id,
            nombre: p.nombre,
            carpeta: p.ruta,
            ...(p.grupo ? { grupo: datos.grupos.find((g) => g.id === p.grupo)?.nombre ?? p.grupo } : {}),
            terminales: vivas.filter((m) => m?.proyectoId === p.id).length,
            servicios_en_marcha: estados[i]!.filter((x) => x.estado === 'listo' || x.estado === 'arrancando').length
          })),
          pendientes: (await d.pendientes().catch(() => [])).map((p) => ({ id: p.id, nombre: p.nombre, repo: p.repo }))
        }
      }
      case 'proyecto_abrir': {
        const p = await this.proyecto(e, ctxProyecto)
        const vista = e.vista === 'asistente' || e.vista === 'archivos' ? e.vista : 'terminal'
        d.interfaz({ tipo: 'abrir-proyecto', proyectoId: p.id, vista })
        return `Abierto «${p.nombre}» (${vista}) en Odesk.`
      }
      case 'proyecto_clonar': {
        const id = String(e.proyecto_id ?? '')
        const pend = (await d.pendientes()).find((p) => p.id === id)
        if (!pend) throw new Error('Ese proyecto no está pendiente de clonar en este equipo (odesk_proyectos → pendientes).')
        const r = await d.clonar({ proyectoId: id, ...(typeof e.carpeta_padre === 'string' && e.carpeta_padre ? { carpetaPadre: e.carpeta_padre } : {}) })
        d.interfaz({ tipo: 'proyectos-cambiados' })
        return { clonado: pend.nombre, carpeta: r.ruta }
      }
      case 'proyecto_quitar': {
        const p = await this.proyecto(e)
        await d.quitarProyecto(p.id)
        d.interfaz({ tipo: 'proyectos-cambiados' })
        return `«${p.nombre}» ya no está en este equipo (la carpeta ${p.ruta} sigue intacta).`
      }
      case 'terminal_listar': {
        const datos = await d.proyectos()
        const filtro = typeof e.proyecto_id === 'string' && e.proyecto_id ? e.proyecto_id : undefined
        return d.terminales
          .vivas()
          .map((id) => ({ id, m: d.terminales.meta(id) }))
          .filter(({ m }) => !filtro || m?.proyectoId === filtro)
          .map(({ id, m }) => ({
            id,
            ...(m?.titulo ? { titulo: m.titulo } : {}),
            ...(m?.proyectoId ? { proyecto: datos.proyectos.find((p) => p.id === m.proyectoId)?.nombre ?? m.proyectoId, proyecto_id: m.proyectoId } : {}),
            ...(m?.claude ? { claude_code: true } : {}),
            ...(m?.ia ? { abierta_por_ia: true } : {}),
            estado: d.terminales.enShell(id) ? 'esperando en el shell' : 'ejecutando un programa',
            ultima_linea: textoTerminal(d.terminales.historial(id), 1).slice(0, 200)
          }))
      }
      case 'terminal_abrir': {
        const p = await this.proyecto(e, ctxProyecto)
        const claude = e.claude === true
        const titulo = typeof e.titulo === 'string' && e.titulo.trim() ? e.titulo.trim().slice(0, 60) : `${p.nombre}${claude ? ' · Claude' : ''} · IA`
        const id = await d.terminales.crear({ cwd: p.ruta, proyectoId: p.id, claude, titulo })
        d.interfaz({ tipo: 'terminal', proyectoId: p.id, ptyId: id, titulo })
        return { terminal: id, proyecto: p.nombre, titulo, ...(claude ? { claude_code: true } : {}) }
      }
      case 'terminal_escribir': {
        const id = this.terminal(e)
        if (typeof e.tecla === 'string') {
          const k = TECLAS[e.tecla]
          if (!k) throw new Error(`Tecla no soportada: ${e.tecla}`)
          d.terminales.escribir(id, k)
          return `Pulsada ${e.tecla}.`
        }
        const texto = String(e.texto ?? '')
        if (!texto && e.enter === false) throw new Error('Indica texto o tecla.')
        // Si la terminal está en el shell, el texto es un comando: la misma barrera que en modo autónomo para lo catastrófico.
        if (d.terminales.enShell(id)) {
          const motivo = motivoBloqueoAutonomo(texto)
          if (motivo) throw new Error(`Bloqueado: ${motivo}. Si de verdad hace falta, que lo ejecute la persona.`)
        }
        d.terminales.escribir(id, texto.replace(/\r?\n/g, '\r') + (e.enter === false ? '' : '\r'))
        return 'Escrito. Usa terminal_esperar para esperar a que termine y ver la salida (o terminal_leer para mirar sin esperar).'
      }
      case 'terminal_leer': {
        const id = this.terminal(e)
        const espera = Math.min(Math.max(Math.trunc(Number(e.esperar_ms)) || 0, 0), 30_000)
        if (espera) await (d.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(espera)
        return textoTerminal(d.terminales.historial(id), acotar(e.lineas, 80, 1000)) || '(sin salida todavía)'
      }
      case 'terminal_esperar': {
        const id = this.terminal(e)
        const dormir = d.esperar ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)))
        const PASO = 250
        const pasos = Math.ceil((acotar(e.max_s, 60, 300) * 1000) / PASO)
        const buscado = typeof e.texto === 'string' && e.texto.trim() ? e.texto.trim().toLowerCase() : undefined
        const inicial = d.terminales.historial(id)
        // Salida producida desde que se llamó (el historial es una ventana que se desplaza: si ya no encaja, vale todo lo que hay).
        const nuevo = (h: string): string => (h.length >= inicial.length && h.startsWith(inicial) ? h.slice(inicial.length) : h)
        let motivo = 'tiempo'
        let previo = inicial
        let quieta = 0
        for (let i = 0; i < pasos; i++) {
          await dormir(PASO)
          if (!d.terminales.vivas().includes(id)) {
            motivo = 'cerrada'
            break
          }
          const h = d.terminales.historial(id)
          if (buscado) {
            if (textoTerminal(nuevo(h), 1000).toLowerCase().includes(buscado)) {
              motivo = 'texto'
              break
            }
          } else {
            // Terminó = de vuelta en el shell y sin salida nueva durante dos sondeos seguidos (un comando recién escrito tarda en arrancar).
            quieta = d.terminales.enShell(id) && h === previo ? quieta + 1 : 0
            if (quieta >= 2) {
              motivo = 'shell'
              break
            }
          }
          previo = h
        }
        if (motivo === 'cerrada') return { estado: 'la terminal se cerró', salida: textoTerminal(previo, acotar(e.lineas, 60, 1000)) }
        const estado =
          motivo === 'shell'
            ? 'terminó (la terminal está en el shell)'
            : motivo === 'texto'
              ? `apareció «${String(e.texto).trim()}»`
              : `tiempo agotado: ${buscado ? 'el texto no apareció' : 'sigue ejecutándose'}. Vuelve a llamar a terminal_esperar para seguir esperando, o terminal_escribir con tecla ctrl+c para pararlo.`
        return { estado, salida: textoTerminal(d.terminales.historial(id), acotar(e.lineas, 60, 1000)) || '(sin salida)' }
      }
      case 'terminal_cerrar': {
        const id = this.terminal(e)
        d.interfaz({ tipo: 'cerrar-terminal', ptyId: id }) // la celda desaparece de la interfaz…
        d.terminales.cerrar(id) // …y el proceso termina aunque no tuviera celda (p. ej. en otra ventana)
        return `Terminal ${id} cerrada.`
      }
      case 'servicios_listar': {
        const p = await this.proyecto(e, ctxProyecto)
        const [comandos, estados] = await Promise.all([d.arranque.listar(p.id), d.arranque.estados(p.id)])
        if (!comandos.length) return `«${p.nombre}» no tiene comandos de arranque configurados (se crean en Odesk → Servicios).`
        return comandos.map((c) => {
          const s = estados.find((x) => x.comandoId === c.id)
          return { id: c.id, nombre: c.nombre, comando: c.comando, ...(c.cwd ? { carpeta: c.cwd } : {}), ...(c.puerto ? { puerto: c.puerto } : {}), estado: s?.estado ?? 'detenido', ...(s?.mensaje ? { mensaje: s.mensaje } : {}), ...(s?.ptyId ? { terminal: s.ptyId } : {}) }
        })
      }
      case 'servicios_arrancar':
        return this.arrancar(await this.proyecto(e, ctxProyecto), ids(e.ids), e.esperar !== false)
      case 'servicios_detener': {
        const p = await this.proyecto(e, ctxProyecto)
        const r = await d.arranque.detener(p.id, ids(e.ids))
        return { detenidos: r.map((x) => x.comandoId) }
      }
      case 'servicios_reiniciar': {
        const p = await this.proyecto(e, ctxProyecto)
        await d.arranque.detener(p.id, ids(e.ids))
        // El proceso tarda un momento en soltar el puerto: hasta entonces se vería como «ocupado por otro programa».
        const dormir = d.esperar ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)))
        const limite = Date.now() + 10_000
        while (Date.now() < limite && (await d.arranque.revisar(p.id, ids(e.ids))).length) await dormir(250)
        return this.arrancar(p, ids(e.ids), true)
      }
      case 'servicio_logs': {
        const p = await this.proyecto(e, ctxProyecto)
        const s = (await d.arranque.estados(p.id)).find((x) => x.comandoId === String(e.id))
        if (!s?.ptyId || !d.terminales.vivas().includes(s.ptyId)) return `El comando ${String(e.id)} no está en marcha (estado: ${s?.estado ?? 'detenido'}${s?.mensaje ? `, ${s.mensaje}` : ''}).`
        return textoTerminal(d.terminales.historial(s.ptyId), acotar(e.lineas, 120, 1000)) || '(sin salida todavía)'
      }
      case 'asistente_conversaciones': {
        const filtro = typeof e.proyecto_id === 'string' && e.proyecto_id ? e.proyecto_id : undefined
        const l = await d.sesiones.listar(filtro)
        return l.slice(0, acotar(e.limite, 20, 100)).map((s) => ({ id: s.id, titulo: s.titulo, ...(s.proyectoId ? { proyecto_id: s.proyectoId } : {}), actualizada: s.actualizada, turnos: s.turnos }))
      }
      case 'asistente_leer': {
        const s = await d.sesiones.transcripcion(String(e.conversacion ?? ''))
        if (!s) throw new Error('No hay una conversación con ese id (asistente_conversaciones).')
        const turnos = s.transcripcion.slice(-acotar(e.ultimos, 6, 50))
        return {
          titulo: s.titulo,
          turnos: turnos.map((x) => ({ usuario: x.prompt.slice(0, 4000), estado: x.estado, respuesta: textoDeTurno(x.eventos).slice(0, 6000), ...(x.error ? { error: x.error } : {}) }))
        }
      }
      case 'asistente_enviar': {
        const p = await this.proyecto(e, ctxProyecto)
        const mensaje = String(e.mensaje ?? '').trim()
        if (!mensaje) throw new Error('El mensaje está vacío.')
        d.interfaz({ tipo: 'asistente-enviar', proyectoId: p.id, mensaje })
        return `Enviado al Asistente de «${p.nombre}» (si estaba ocupado, queda en cola). Lee el resultado más tarde con asistente_conversaciones y asistente_leer.`
      }
      case 'ajustes_leer': {
        const clave = typeof e.proyecto_id === 'string' && e.proyecto_id ? e.proyecto_id : 'global'
        const [ajustes, cuentas] = await Promise.all([d.ajustes.leer(clave), d.cuentas.estado().catch(() => undefined)])
        return { ambito: clave, ajustes, ...(cuentas ? { cuentas } : {}) }
      }
      case 'ajustes_fijar': {
        const clave = typeof e.proyecto_id === 'string' && e.proyecto_id ? e.proyecto_id : 'global'
        const cambios: Record<string, string | null> = {}
        for (const k of ['modelo', 'autonomia', 'esfuerzo'] as const) if (k in e) cambios[k] = e[k] === null || e[k] === 'auto' ? null : String(e[k])
        if (!Object.keys(cambios).length) throw new Error('Indica modelo, autonomia o esfuerzo.')
        return { ambito: clave, ajustes: await d.ajustes.fijar(clave, cambios), nota: 'Se aplica desde el siguiente mensaje del Asistente.' }
      }
      case 'cuenta_activar':
        await d.cuentas.activar(String(e.id ?? ''))
        return 'Cuenta activada.'
      case 'consumo':
        return d.consumo()
      case 'historial_archivos': {
        const p = await this.proyecto(e, ctxProyecto)
        return d.historial('archivos', { proyectoId: p.id, limite: acotar(e.limite, 50, 500), ...(typeof e.texto === 'string' && e.texto ? { filtro: { texto: e.texto } } : {}) })
      }
      case 'historial_versiones': {
        const p = await this.proyecto(e, ctxProyecto)
        return d.historial('versiones', { proyectoId: p.id, ruta: String(e.ruta) })
      }
      case 'historial_comparar': {
        const p = await this.proyecto(e, ctxProyecto)
        const hasta = String(e.hasta)
        return d.historial('comparar', { proyectoId: p.id, ruta: String(e.ruta), desde: typeof e.desde === 'string' && e.desde ? e.desde : hasta === 'actual' ? 'anterior' : 'actual', hasta })
      }
      case 'historial_restaurar': {
        const p = await this.proyecto(e, ctxProyecto)
        await d.historial('restaurar', { proyectoId: p.id, ruta: String(e.ruta), version: String(e.version) })
        return `Restaurado ${String(e.ruta)} a la versión ${String(e.version)} (el estado anterior quedó guardado en el historial).`
      }
      case 'proyecto_renombrar': {
        const p = await this.proyecto(e, ctxProyecto)
        const nombre = String(e.nombre ?? '').trim()
        if (!nombre) throw new Error('El nombre está vacío.')
        await falta(d.proyectosEdicion, 'Editar proyectos').renombrar(p.id, nombre)
        d.interfaz({ tipo: 'proyectos-cambiados' })
        return `«${p.nombre}» ahora se llama «${nombre}».`
      }
      case 'proyecto_mover_grupo': {
        const p = await this.proyecto(e, ctxProyecto)
        const g = typeof e.grupo_id === 'string' && e.grupo_id && e.grupo_id !== 'ninguno' ? e.grupo_id : null
        const grupos = (await d.proyectos()).grupos
        if (g && !grupos.some((x) => x.id === g)) throw new Error(`No hay un grupo con id ${g} (odesk_proyectos da los grupos).`)
        await falta(d.proyectosEdicion, 'Editar proyectos').moverGrupo(p.id, g)
        d.interfaz({ tipo: 'proyectos-cambiados' })
        return g ? `«${p.nombre}» movido al grupo «${grupos.find((x) => x.id === g)?.nombre}».` : `«${p.nombre}» quedó sin grupo.`
      }
      case 'servicio_guardar': {
        const p = await this.proyecto(e, ctxProyecto)
        const id = typeof e.id === 'string' && e.id ? e.id : undefined
        const previo = id ? (await d.arranque.listar(p.id)).find((c) => c.id === id) : undefined
        if (id && !previo) throw new Error(`No hay un comando de arranque con id ${id} (servicios_listar).`)
        const base: Partial<EntradaComandoArranque> = { ...previo }
        delete (base as { orden?: number }).orden
        const comando: EntradaComandoArranque = {
          ...base,
          nombre: String(e.nombre ?? previo?.nombre ?? ''),
          comando: String(e.comando ?? previo?.comando ?? ''),
          ...(typeof e.cwd === 'string' ? { cwd: e.cwd } : {}),
          ...(typeof e.puerto === 'number' ? { puerto: e.puerto } : {}),
          ...(typeof e.esperar === 'string' ? { esperar: e.esperar as EntradaComandoArranque['esperar'] } : {}),
          ...(typeof e.texto_listo === 'string' ? { textoListo: e.texto_listo } : {}),
          ...(typeof e.espera_ms === 'number' ? { esperaMs: e.espera_ms } : {}),
          ...(typeof e.siempre === 'boolean' ? { siempre: e.siempre } : {})
        }
        const r = await falta(d.arranqueConfig, 'Configurar servicios').guardar(p.id, comando)
        if (!r.ok) throw new Error(r.mensaje)
        d.interfaz({ tipo: 'proyectos-cambiados' })
        const guardado = r.comandos.find((c) => (id ? c.id === id : c.nombre === comando.nombre))
        return { guardado: guardado ?? comando, ...(r.avisos.length ? { avisos: r.avisos } : {}) }
      }
      case 'servicio_eliminar': {
        const p = await this.proyecto(e, ctxProyecto)
        const id = String(e.id ?? '')
        if (!(await d.arranque.listar(p.id)).some((c) => c.id === id)) throw new Error(`No hay un comando de arranque con id ${id} (servicios_listar).`)
        await falta(d.arranqueConfig, 'Configurar servicios').eliminar(p.id, id)
        return `Comando de arranque ${id} borrado.`
      }
      case 'comandos_listar': {
        const c = falta(d.comandos, 'Comandos «/»')
        const proyecto = typeof e.proyecto_id === 'string' && e.proyecto_id ? (await this.proyecto(e)).id : undefined
        const resumen = (x: ComandoUsuario) => ({ nombre: `/${x.nombre}`, tipo: x.tipo, descripcion: x.descripcion, ...(x.tipo === 'prompt' ? { plantilla: (x.plantilla ?? '').slice(0, 500) } : { comando: x.comando ?? [] }) })
        return { globales: (await c.listar('global')).map(resumen), ...(proyecto ? { proyecto: (await c.listar(proyecto)).map(resumen) } : {}) }
      }
      case 'comando_guardar': {
        const c = falta(d.comandos, 'Comandos «/»')
        const ambito = typeof e.proyecto_id === 'string' && e.proyecto_id ? (await this.proyecto(e)).id : 'global'
        const tipo = e.tipo === 'ejecutable' ? 'ejecutable' : 'prompt'
        const cmd: ComandoUsuario = {
          nombre: String(e.nombre ?? '').replace(/^\//, ''),
          descripcion: String(e.descripcion ?? ''),
          tipo,
          ...(tipo === 'prompt' ? { plantilla: String(e.plantilla ?? '') } : { comando: Array.isArray(e.comando) ? e.comando.map(String) : [], argumentos: e.argumentos === true })
        }
        await c.guardar(cmd, ambito)
        return `Comando «/${cmd.nombre}» guardado (${ambito === 'global' ? 'global' : 'del proyecto'}).`
      }
      case 'comando_eliminar': {
        const c = falta(d.comandos, 'Comandos «/»')
        const ambito = typeof e.proyecto_id === 'string' && e.proyecto_id ? (await this.proyecto(e)).id : 'global'
        const nombre = String(e.nombre ?? '').replace(/^\//, '')
        if (!(await c.listar(ambito)).some((x) => x.nombre === nombre)) throw new Error(`No hay un comando «/${nombre}» ${ambito === 'global' ? 'global' : 'en ese proyecto'} (comandos_listar).`)
        await c.eliminar(nombre, ambito)
        return `Comando «/${nombre}» borrado.`
      }
      case 'agentes_listar': {
        const b = await falta(d.agentes, 'Agentes y skills').biblioteca()
        const datos = await d.proyectos()
        const filtro = typeof e.proyecto_id === 'string' && e.proyecto_id ? (await this.proyecto(e)).id : undefined
        const grupoDe = filtro ? datos.proyectos.find((p) => p.id === filtro)?.grupo : undefined
        const activoEn = (id: string) => ({
          proyectos: Object.entries(b.activaciones.proyectos).filter(([, l]) => l.includes(id)).map(([p]) => datos.proyectos.find((x) => x.id === p)?.nombre ?? p),
          grupos: Object.entries(b.activaciones.grupos).filter(([, l]) => l.includes(id)).map(([g]) => datos.grupos.find((x) => x.id === g)?.nombre ?? g)
        })
        const lista = b.recursos
          .filter((r) => !filtro || (r.ambito === 'proyecto' ? r.proyectoId === filtro : (b.activaciones.proyectos[filtro] ?? []).includes(r.id) || (!!grupoDe && (b.activaciones.grupos[grupoDe] ?? []).includes(r.id))))
          .map((r) => ({ id: r.id, tipo: r.tipo, nombre: r.nombre, descripcion: r.descripcion.slice(0, 300), ambito: r.ambito, ...(r.ambito === 'proyecto' ? { proyecto_id: r.proyectoId } : { activo_en: activoEn(r.id) }) }))
        return filtro ? { cargados_en_el_proyecto: lista } : { recursos: lista }
      }
      case 'agente_activar': {
        const a = falta(d.agentes, 'Agentes y skills')
        const recursoId = String(e.recurso_id ?? '')
        const r = (await a.biblioteca()).recursos.find((x) => x.id === recursoId)
        if (!r) throw new Error(`No hay un agente o skill con id ${recursoId} (agentes_listar).`)
        if (r.ambito !== 'compartido') throw new Error(`«${r.nombre}» es de un proyecto: ya se carga siempre en él y no se activa a mano.`)
        const tipo = e.destino === 'grupo' ? 'grupo' : 'proyecto'
        let destinoId = typeof e.destino_id === 'string' && e.destino_id ? e.destino_id : undefined
        if (tipo === 'proyecto') destinoId = (await this.proyecto({ proyecto_id: destinoId }, ctxProyecto)).id
        else if (!destinoId || !(await d.proyectos()).grupos.some((g) => g.id === destinoId)) throw new Error('Indica destino_id con el id de un grupo (odesk_proyectos).')
        await a.activar({ tipo, id: destinoId! }, recursoId, e.activo === true)
        return `«${r.nombre}» ${e.activo === true ? 'activado' : 'desactivado'} en ${tipo === 'grupo' ? 'el grupo' : 'el proyecto'}. Se aplica en las conversaciones y terminales nuevas.`
      }
      case 'equipos_estado': {
        const op = falta(d.equipos, 'Mis equipos')
        if (typeof e.proyecto_id === 'string' && e.proyecto_id) return op('listar', { proyectoId: (await this.proyecto(e)).id })
        return { avisos: await op('resumen', {}) }
      }
      case 'api_colecciones': {
        const datos = (await falta(d.api, 'Cliente API')('datos', {})) as DatosApi
        return {
          colecciones: datos.colecciones.map((c) => ({ id: c.id, nombre: c.nombre, peticiones: c.peticiones.map((p) => ({ id: p.id, nombre: p.nombre, metodo: p.peticion.metodo, url: p.peticion.url })) })),
          // Los valores pueden ser tokens o claves: solo los nombres.
          entornos: datos.entornos.map((x) => ({ id: x.id, nombre: x.nombre, variables: x.variables.map((v) => v.clave), ...(x.id === datos.entornoActivo ? { activo: true } : {}) }))
        }
      }
      case 'api_enviar': {
        const op = falta(d.api, 'Cliente API')
        const datos = (await op('datos', {})) as DatosApi
        const col = datos.colecciones.find((c) => c.id === String(e.coleccion_id))
        const guardada = col?.peticiones.find((p) => p.id === String(e.peticion_id))
        if (!guardada) throw new Error('No hay esa petición guardada (api_colecciones da los ids).')
        const r = (await op('enviar', { peticion: guardada.peticion, envioId: randomUUID() })) as RespuestaApi
        const cuerpo = r.cuerpo.tipo === 'texto' ? (r.texto.length > MAX_RESPUESTA_API ? r.texto.slice(0, MAX_RESPUESTA_API) + '\n[… recortado]' : r.texto) : `(${r.cuerpo.tipo}, ${r.bytes} bytes)`
        return { estado: r.estado, ms: r.ms, url: r.urlFinal, tipo: r.tipoContenido, cabeceras: Object.fromEntries(r.cabeceras), cuerpo }
      }
      case 'api_guardar_peticion': {
        const op = falta(d.api, 'Cliente API')
        let coleccionId = typeof e.coleccion_id === 'string' && e.coleccion_id ? e.coleccion_id : undefined
        const datos = (await op('datos', {})) as DatosApi
        let col: Coleccion | undefined
        if (coleccionId) {
          col = datos.colecciones.find((c) => c.id === coleccionId)
          if (!col) throw new Error(`No hay una colección con id ${coleccionId} (api_colecciones).`)
        } else {
          const nombre = String(e.coleccion_nombre ?? '').trim() || 'Asistente'
          coleccionId = datos.colecciones.find((c) => c.nombre === nombre)?.id ?? ((await op('guardarColeccion', { nombre })) as { id: string }).id
        }
        const previa = typeof e.id === 'string' ? col?.peticiones.find((p) => p.id === e.id)?.peticion : undefined
        const cabeceras = e.cabeceras && typeof e.cabeceras === 'object' ? Object.entries(e.cabeceras as Record<string, unknown>).map(([clave, valor]) => ({ id: randomUUID(), clave, valor: String(valor), activo: true })) : (previa?.cabeceras ?? [])
        const peticion: PeticionApi = {
          consulta: [],
          auth: { tipo: 'ninguna' },
          opciones: { seguirRedirecciones: true, ignorarCertificado: false, tiempoMs: 30_000 },
          ...previa,
          metodo: String(e.metodo ?? 'GET').toUpperCase() as PeticionApi['metodo'],
          url: String(e.url ?? ''),
          cabeceras,
          cuerpo: typeof e.cuerpo_json === 'string' && e.cuerpo_json ? { tipo: 'json', texto: e.cuerpo_json } : (previa?.cuerpo ?? { tipo: 'ninguno' })
        }
        const r = (await op('guardarPeticion', { coleccionId, ...(typeof e.id === 'string' && e.id ? { id: e.id } : {}), nombre: String(e.nombre ?? ''), peticion })) as { id: string }
        return { coleccion_id: coleccionId, peticion_id: r.id }
      }
      case 'chat_contactos': {
        const r = (await falta(d.chat, 'Chat')('contactos', {})) as { contactos: ContactoChat[] }
        return r.contactos.map((c) => ({ usuario_id: c.usuario.id, nombre: c.usuario.nombre, email: c.usuario.email, estado: c.estado, ...(c.usuario.enLinea !== undefined ? { en_linea: c.usuario.enLinea } : {}) }))
      }
      case 'chat_conversaciones': {
        const r = (await falta(d.chat, 'Chat')('conversaciones', {})) as { conversaciones: ConversacionChat[] }
        return r.conversaciones
          .filter((c) => !c.archivada)
          .map((c) => ({ id: c.id, con: c.otro.nombre, usuario_id: c.otro.id, no_leidos: c.noLeidos, ...(c.ultimo ? { ultimo: { texto: c.ultimo.texto, de_mi: c.ultimo.emisorId !== c.otro.id, fecha: c.ultimo.creado } } : {}) }))
      }
      case 'chat_leer': {
        const chat = falta(d.chat, 'Chat')
        const conv = ((await chat('conversaciones', {})) as { conversaciones: ConversacionChat[] }).conversaciones.find((c) => c.id === String(e.conversacion))
        if (!conv) throw new Error('No hay esa conversación (chat_conversaciones da los ids).')
        const p = (await chat('mensajes', { conversacionId: conv.id, limite: acotar(e.limite, 30, 100) })) as PaginaMensajes
        return {
          con: conv.otro.nombre,
          mensajes: p.mensajes.map((m) => ({ de: m.emisorId === conv.otro.id ? conv.otro.nombre : 'yo', tipo: m.tipo, texto: m.eliminado ? '(eliminado)' : m.texto.slice(0, 4000), ...(m.adjunto ? { adjunto: m.adjunto.nombre } : {}), fecha: m.creado }))
        }
      }
      case 'chat_enviar': {
        const chat = falta(d.chat, 'Chat')
        const texto = String(e.texto ?? '').trim()
        if (!texto) throw new Error('El mensaje está vacío.')
        let conversacionId = typeof e.conversacion === 'string' && e.conversacion ? e.conversacion : undefined
        if (!conversacionId) {
          if (typeof e.usuario_id !== 'string' || !e.usuario_id) throw new Error('Indica conversacion o usuario_id (chat_contactos / chat_conversaciones).')
          conversacionId = ((await chat('abrirConversacion', { usuarioId: e.usuario_id })) as { id: string }).id
        }
        await chat('enviarTexto', { conversacionId, texto, clienteId: randomUUID() })
        return 'Mensaje enviado.'
      }
      case 'notificar': {
        const cuerpo = String(e.cuerpo ?? '').trim()
        if (!cuerpo) throw new Error('El texto está vacío.')
        const ok = falta(d.notificar, 'Notificaciones')(String(e.titulo ?? 'Odesk Agent'), cuerpo)
        return ok ? 'Notificación mostrada.' : 'El sistema no admite notificaciones.'
      }
    }
    throw new Error(`Herramienta desconocida: ${nombre}`)
  }

  private async arrancar(p: { id: string; nombre: string }, lista: string[] | undefined, esperar: boolean): Promise<unknown> {
    const d = this.d
    const conflictos = await d.arranque.revisar(p.id, lista)
    if (conflictos.length) return { arrancado: false, motivo: 'Hay puertos ocupados: no se toca lo que no es de este proyecto. Resuélvelo desde Odesk → Servicios o libera el puerto.', conflictos }
    const r = await d.arranque.arrancar(p.id, lista)
    if (!r.ok) throw new Error(r.mensaje)
    if (!esperar) return { arrancando: r.comandos }
    const dormir = d.esperar ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)))
    const limite = Date.now() + 120_000
    let estados = await d.arranque.estados(p.id)
    while (Date.now() < limite && estados.some((x) => (!lista || lista.includes(x.comandoId)) && (x.estado === 'pendiente' || x.estado === 'arrancando'))) {
      await dormir(1000)
      estados = await d.arranque.estados(p.id)
    }
    return estados.filter((x) => !lista || lista.includes(x.comandoId)).map((x) => ({ id: x.comandoId, estado: x.estado, ...(x.mensaje ? { mensaje: x.mensaje } : {}), ...(x.ptyId ? { terminal: x.ptyId } : {}) }))
  }
}
