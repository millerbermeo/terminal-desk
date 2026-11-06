import type { ResultadoHerramienta } from '@shared/core/herramientas'
import type { EventoAgente } from '@shared/core/agente'
import type { ResumenSesion, SesionGuardada } from '@shared/core/sesion'
import type { ComandoArranque, ConflictoPuerto, EstadoArranque, ResultadoArrancar } from '@shared/arranque'
import type { DatosProyectos } from '@shared/modelos'
import type { AccionIa } from '@shared/control-app'
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
        return 'Escrito. Usa terminal_leer para ver la salida.'
      }
      case 'terminal_leer': {
        const id = this.terminal(e)
        const espera = Math.min(Math.max(Math.trunc(Number(e.esperar_ms)) || 0, 0), 30_000)
        if (espera) await (d.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(espera)
        return textoTerminal(d.terminales.historial(id), acotar(e.lineas, 80, 1000)) || '(sin salida todavía)'
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
