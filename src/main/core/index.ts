import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import type { InfoSuite, ResultadoEvals } from '@shared/core/evals'
import type { TurnoGuardado } from '@shared/core/sesion'
import type { ResumenTraza, Traza } from '@shared/core/traza'
import type { DecisionHumana, EstadoFlujo, EjecucionIniciada, EventoAgente, InfoServidorMcp, InfoWorktree, Mensaje, ResultadoPublicar, SolicitudAgente } from '@shared/core/agente'
import type { NuevaEntradaMemoria } from '@shared/core/memoria'
import { Canales } from '@shared/ipc'
import { leerProveedores } from '../proveedores'
import { DIR, leerProyectos } from '../proyectos'
import { Agente } from './agents/agente'
import { Harness, type Aprobador } from './agents/harness'
import { ProveedorAnthropic } from './agents/llm/anthropic'
import type { ProveedorLLM } from './agents/llm/proveedor'
import type { Proyecto } from '@shared/modelos'
import { BusA2A } from './a2a/bus'
import { crearTopologia } from './a2a/submodulos'
import { AGENTES_BASE, generador, planificador } from './agentes-base'
import { crearFlujoDesarrollo, estadoInicial } from './orchestrator/flujo-desarrollo'
import { PuertaHumana } from './orchestrator/puerta'
import { detectarVerificaciones, ejecutarVerificacion } from './orchestrator/verificaciones'
import { GestorWorktrees } from './git/worktree'
import { ejecutarSuite } from './evals/ejecutor'
import { AlmacenInformes, compararInformes } from './evals/informes'
import { infoSuites, SUITES } from './evals/suites'
import { MotorGuardrails } from './guardrails/motor'
import { AlmacenTrazas } from './tracing/almacen'
import { LlmTrazado } from './tracing/llm-trazado'
import { Trazador } from './tracing/trazador'
import { crearAprobadorHumano } from './hitl/aprobador'
import { MODELOS_POR_DEFECTO, Router } from './router/router'
import { CompresorContexto } from './context/compresion'
import { MonitorContexto } from './context/monitor'
import { leerConfigMcp } from './mcp/config'
import { validarId } from './memory/almacen'
import { herramientasMemoria } from './memory/herramientas'
import { MemoriaLargoPlazo } from './memory/largo-plazo'
import { MemoriaCortoPlazo } from './memory/sesion'
import { OrquestadorMcp } from './mcp/orquestador'
import { registrarIntegradas } from './tools/integradas'
import { RegistroHerramientas } from './tools/registro'

/** Clave de API: variable de entorno o `ANTHROPIC_API_KEY` en el `env` del proveedor «claude». */
async function claveAnthropic(): Promise<string | undefined> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  return (await leerProveedores()).find((p) => p.id === 'claude')?.env.ANTHROPIC_API_KEY
}

// Modelo barato para resumir la conversación al comprimir el contexto.
const MODELO_RESUMEN = 'claude-haiku-5-5'

/** Una conversación guardada no puede terminar en un tool_use sin su resultado (la API la rechazaría). */
function sinUsoPendiente(mensajes: Mensaje[]): Mensaje[] {
  const ultimo = mensajes.at(-1)
  return ultimo?.rol === 'assistant' && ultimo.contenido.some((b) => b.tipo === 'herramienta_uso') ? mensajes.slice(0, -1) : mensajes
}

interface Corrida {
  aprobar?: Aprobador
  harness: Harness
  id: string
  ctl: AbortController
  alEvento: (e: EventoAgente) => void
}

export class Nucleo {
  readonly registro = new RegistroHerramientas()
  readonly sesiones = new MemoriaCortoPlazo(join(DIR, 'conversaciones'))
  readonly memoria = new MemoriaLargoPlazo(join(DIR, 'memoria'))
  private readonly monitor = new MonitorContexto()
  private readonly router = new Router()
  private readonly puerta = new PuertaHumana()
  private readonly guardrails = new MotorGuardrails()
  readonly trazas = new AlmacenTrazas(join(DIR, 'trazas'))
  readonly trazador = new Trazador(this.trazas)
  private readonly informes = new AlmacenInformes(join(DIR, 'evals'))
  readonly worktrees = new GestorWorktrees(join(DIR, 'worktrees'))
  readonly mcp = new OrquestadorMcp(this.registro)
  private readonly agentes = new Map(AGENTES_BASE.map((d) => [d.nombre, new Agente(d)]))
  private readonly activas = new Map<string, AbortController>()

  constructor(private readonly aprobar?: Aprobador) {
    registrarIntegradas(this.registro)
    for (const h of herramientasMemoria(this.memoria)) this.registro.registrar(h)
  }

  async iniciarMcp(): Promise<InfoServidorMcp[]> {
    try {
      return await this.mcp.iniciar(await leerConfigMcp())
    } catch (err) {
      console.error('MCP no iniciado:', err)
      return [{ nombre: 'mcp.json', estado: 'error', herramientas: 0, error: (err as Error).message }]
    }
  }

  private async llm(): Promise<ProveedorLLM> {
    const clave = await claveAnthropic()
    if (!clave) throw new Error('Falta ANTHROPIC_API_KEY (variable de entorno o env del proveedor «claude»).')
    return new LlmTrazado(new ProveedorAnthropic(clave), this.trazador, MODELOS_POR_DEFECTO.media)
  }

  /** Lanza una ejecución y devuelve sus ids; el progreso se entrega por `alEvento`. */
  async ejecutar(sol: SolicitudAgente, alEvento: (e: EventoAgente) => void): Promise<EjecucionIniciada> {
    const datos = await leerProyectos()
    const proyecto = sol.proyectoId ? datos.proyectos.find((p) => p.id === sol.proyectoId) : undefined
    if (sol.proyectoId && !proyecto) throw new Error('Proyecto no encontrado')
    if (sol.modo === 'flujo' && !proyecto) throw new Error('El flujo de desarrollo necesita un proyecto')
    if (sol.modo === 'flujo' && sol.aislado !== false && !(await this.worktrees.esRepoConCommits(proyecto!.ruta)))
      throw new Error('El proyecto no es un repositorio git con al menos un commit: no se puede aislar la tarea (usa aislado: false para trabajar en el directorio del proyecto).')
    const miembros = sol.grupoId ? datos.proyectos.filter((p) => p.grupo === sol.grupoId) : []
    if (sol.grupoId && miembros.length === 0) throw new Error('El grupo no tiene proyectos')

    if (sol.modo !== 'flujo' && !sol.grupoId && !this.agentes.has(sol.agenteId ?? 'asistente')) throw new Error(`Agente desconocido: ${sol.agenteId}`)
    const llm = await this.llm()
    const sesionId = validarId(sol.sesionId ?? randomUUID())
    const id = randomUUID()
    const ctl = new AbortController()
    this.activas.set(id, ctl)
    // Traza de la ejecución: los eventos de interés se registran además de entregarse a la UI.
    this.trazador.iniciar(id, {
      prompt: sol.prompt,
      agente: sol.modo === 'flujo' ? 'flujo' : sol.grupoId ? 'coordinador' : (sol.agenteId ?? 'asistente'),
      modo: sol.modo === 'flujo' ? 'flujo' : sol.grupoId ? 'grupo' : 'chat',
      ...(sol.proyectoId ? { proyectoId: sol.proyectoId } : {})
    })
    const entregar = alEvento
    alEvento = (e) => {
      this.trazador.registrarEvento(e)
      entregar(e)
    }
    const harness = new Harness({ llm, registro: this.registro, validar: this.guardrails.validarLlamada, trazador: this.trazador, ...(this.aprobar ? { aprobar: this.aprobar } : {}) })
    // Human-in-the-loop: escrituras y ejecuciones esperan la confirmación del usuario (salvo un aprobador inyectado).
    const aprobarHumano = this.aprobar ?? crearAprobadorHumano({ puerta: this.puerta, ejecucionId: id, alEvento, senal: ctl.signal })
    // Contexto del prompt: memoria de largo plazo relevante (reglas + decisiones).
    const sistemaExtra = await this.memoria.contextoPara(sol.prompt, sol.proyectoId)
    const contexto = new CompresorContexto(this.monitor, { llm, modeloResumen: MODELO_RESUMEN })
    const emitir = (e: Omit<EventoAgente, 'ejecucionId' | 'agente' | 'profundidad'> & Record<string, unknown>): void =>
      alEvento({ ejecucionId: id, agente: 'router', profundidad: 0, ...e } as EventoAgente)

    let tarea: Promise<unknown>
    if (sol.modo === 'flujo') {
      tarea = this.correrFlujo(sol, proyecto!, { harness, id, ctl, sistemaExtra, contexto, alEvento, aprobar: aprobarHumano })
    } else if (sol.grupoId) {
      tarea = this.correrGrupo(sol, miembros, { harness, id, ctl, alEvento })
    } else {
      const agente = this.agentes.get(sol.agenteId ?? 'asistente')
      if (!agente) throw new Error(`Agente desconocido: ${sol.agenteId}`)
      const previa = await this.sesiones.obtener(sesionId)
      // El Router elige el modelo según la complejidad, salvo que se fuerce uno.
      let modelo = sol.modelo
      if (!modelo) {
        const ruta = this.router.decidir(sol.prompt)
        modelo = ruta.modelo
        emitir({ tipo: 'ruta', complejidad: ruta.complejidad, modelo: ruta.modelo, razon: ruta.razon, sugerirFlujo: ruta.sugerirFlujo })
      }
      tarea = harness
        .ejecutar(agente, {
          prompt: sol.prompt,
          cwd: proyecto?.ruta ?? process.cwd(),
          ejecucionId: id,
          modelo,
          ...(sol.proyectoId ? { proyectoId: sol.proyectoId } : {}),
          ...(sistemaExtra ? { sistemaExtra } : {}),
          historial: previa?.mensajes ?? [],
          aprobar: aprobarHumano,
          contexto,
          senal: ctl.signal,
          alEvento
        })
        .then((r) => this.sesiones.guardar(sesionId, sinUsoPendiente(r.mensajes), r.uso, sol.proyectoId))
    }
    void tarea
      .then(() => this.trazador.finalizar(id))
      .catch((err) => {
        console.error('Ejecución fallida:', err)
        return this.trazador.finalizar(id, ctl.signal.aborted ? 'cancelado' : 'error')
      })
      .finally(() => this.activas.delete(id))
    return { ejecucionId: id, sesionId }
  }

  /** Planificación -> aprobación -> generación -> verificaciones -> confirmación (grafo de estados), por defecto en un git worktree. */
  private async correrFlujo(sol: SolicitudAgente, proyecto: Proyecto, c: Corrida & { sistemaExtra: string; contexto: CompresorContexto }): Promise<void> {
    const emitir = (e: Record<string, unknown>): void =>
      c.alEvento({ ejecucionId: c.id, agente: 'flujo', profundidad: 0, ...e } as EventoAgente)
    const fin = (estado: EstadoFlujo, resumen: string): void => emitir({ tipo: 'flujo_fin', estado, resumen })
    let wt: InfoWorktree | undefined
    try {
      if (sol.aislado !== false) {
        wt = await this.worktrees.crear(proyecto.ruta, proyecto.id, sol.prompt)
        emitir({ tipo: 'worktree', accion: 'creado', rama: wt.rama, ruta: wt.ruta })
      }
      const cwd = wt?.ruta ?? proyecto.ruta
      const grafo = crearFlujoDesarrollo(
        {
          harness: c.harness,
          puerta: this.puerta,
          cwd,
          proyectoId: proyecto.id,
          ejecucionId: c.id,
          verificaciones: await detectarVerificaciones(proyecto.ruta),
          ejecutarVerificacion,
          ...(c.aprobar ? { aprobar: c.aprobar } : {}),
          ...(c.sistemaExtra ? { sistemaExtra: c.sistemaExtra } : {}),
          contexto: c.contexto,
          modelo: this.modeloPara(sol),
          senal: c.ctl.signal,
          alEvento: c.alEvento
        },
        new Agente(planificador),
        new Agente(generador)
      )
      const r = await grafo.ejecutar(estadoInicial(sol.prompt), {
        senal: c.ctl.signal,
        alNodo: (nodo, intento) => emitir({ tipo: 'flujo_nodo', nodo, intento })
      })
      const e = r.estado
      const estado: EstadoFlujo = r.motivo === 'cancelado' ? 'cancelado' : e.estado === 'en_curso' ? 'fallido' : e.estado
      const resumen = e.motivo ?? e.resumen ?? r.motivo
      if (!wt) return fin(estado, resumen)
      if (estado === 'completado') return fin(...(await this.integrar(wt, sol.prompt, resumen, emitir)))
      if (estado === 'fallido') {
        emitir({ tipo: 'worktree', accion: 'conservado', rama: wt.rama, ruta: wt.ruta, detalle: 'Se conserva para revisar lo que quedó a medias' })
      } else {
        await this.worktrees.descartar(proyecto.ruta, wt)
        emitir({ tipo: 'worktree', accion: 'descartado', rama: wt.rama, ruta: wt.ruta })
      }
      fin(estado, resumen)
    } catch (err) {
      const cancelado = c.ctl.signal.aborted
      if (wt && cancelado) await this.worktrees.descartar(proyecto.ruta, wt).catch(() => undefined)
      fin(cancelado ? 'cancelado' : 'fallido', cancelado ? 'Cancelado' : (err as Error).message)
    }
  }

  /** Revisa el diff completo en busca de credenciales y, si está limpio, confirma los cambios en la rama del worktree. */
  private async integrar(
    wt: InfoWorktree,
    peticion: string,
    resumen: string,
    emitir: (e: Record<string, unknown>) => void
  ): Promise<[EstadoFlujo, string]> {
    const cambios = await this.worktrees.cambios(wt)
    const secretos = this.guardrails.revisarTexto(cambios.texto)
    if (secretos.length) {
      emitir({ tipo: 'guardrail', herramienta: 'confirmar', motivo: `credenciales en los cambios: ${secretos.map((h) => h.mensaje).slice(0, 3).join('; ')}` })
      emitir({ tipo: 'worktree', accion: 'conservado', rama: wt.rama, ruta: wt.ruta, detalle: 'No se confirmó: se detectaron posibles credenciales' })
      return ['fallido', 'Se detectaron posibles credenciales en los cambios; no se confirmaron. Revisa el worktree.']
    }
    const commit = await this.worktrees.confirmar(wt, `agente: ${peticion}`)
    if (!commit) {
      emitir({ tipo: 'worktree', accion: 'conservado', rama: wt.rama, ruta: wt.ruta, detalle: 'Sin cambios que confirmar' })
      return ['completado', `${resumen} (el agente no modificó archivos)`]
    }
    emitir({ tipo: 'worktree', accion: 'confirmado', rama: wt.rama, ruta: wt.ruta, detalle: `commit ${commit}` })
    return ['completado', `${resumen}\nCambios confirmados en la rama ${wt.rama} (${commit}). Revísala e intégrala cuando quieras.`]
  }

  async listarWorktrees(proyectoId: string): Promise<InfoWorktree[]> {
    const p = await this.proyecto(proyectoId)
    return this.worktrees.listar(p.ruta, proyectoId)
  }

  async descartarWorktree(proyectoId: string, id: string): Promise<InfoWorktree[]> {
    const p = await this.proyecto(proyectoId)
    const wt = (await this.worktrees.listar(p.ruta, proyectoId)).find((w) => w.id === id)
    if (!wt) throw new Error('Worktree no encontrado')
    await this.worktrees.descartar(p.ruta, wt)
    return this.worktrees.listar(p.ruta, proyectoId)
  }

  /** `git push` de la rama del worktree, solo si el usuario lo confirma. */
  async publicarWorktree(proyectoId: string, id: string, alEvento: (e: EventoAgente) => void): Promise<ResultadoPublicar> {
    const p = await this.proyecto(proyectoId)
    const wt = (await this.worktrees.listar(p.ruta, proyectoId)).find((w) => w.id === id)
    if (!wt) throw new Error('Worktree no encontrado')
    try {
      const dec = await this.puerta.solicitar(
        { clase: 'accion', contenido: `$ git push -u origin ${wt.rama}`, detalle: 'ACCIÓN DESTRUCTIVA: sube cambios a un repositorio remoto (push)', herramienta: 'git_push', destructivo: true },
        (solicitudId, s) => alEvento({ ejecucionId: id, agente: 'worktree', profundidad: 0, tipo: 'solicitud_humana', solicitudId, ...s })
      )
      if (!dec.aprobado) return { ok: false, mensaje: 'Publicación cancelada' }
      const salida = await this.worktrees.publicar(wt)
      alEvento({ ejecucionId: id, agente: 'worktree', profundidad: 0, tipo: 'worktree', accion: 'publicado', rama: wt.rama, ruta: wt.ruta })
      return { ok: true, mensaje: salida || `Rama ${wt.rama} publicada` }
    } catch (err) {
      return { ok: false, mensaje: (err as Error).message }
    }
  }

  private async proyecto(id: string): Promise<Proyecto> {
    const p = (await leerProyectos()).proyectos.find((x) => x.id === validarId(id))
    if (!p) throw new Error('Proyecto no encontrado')
    return p
  }

  /** Un agente por submódulo del grupo que se consultan entre sí (A2A); un coordinador sintetiza. */
  private async correrGrupo(sol: SolicitudAgente, miembros: Proyecto[], c: Corrida): Promise<void> {
    const bus = new BusA2A()
    const { coordinador } = crearTopologia({ proyectos: miembros, harness: c.harness, bus, ejecucionId: c.id, alEvento: c.alEvento })
    await c.harness.ejecutar(coordinador, {
      prompt: sol.prompt,
      cwd: miembros[0]!.ruta,
      ejecucionId: c.id,
      modelo: this.modeloPara(sol),
      extras: [bus.herramientaConsultar(coordinador.nombre, [], (m) => c.alEvento({ ejecucionId: c.id, agente: m.fase === 'envio' ? m.de : m.a, profundidad: 0, tipo: 'a2a', ...m }))],
      senal: c.ctl.signal,
      alEvento: c.alEvento
    })
  }

  /** Para flujos y grupos (que escriben o coordinan) nunca se baja del modelo intermedio. */
  private modeloPara(sol: SolicitudAgente): string {
    if (sol.modelo) return sol.modelo
    const r = this.router.decidir(sol.prompt)
    return r.complejidad === 'simple' ? MODELOS_POR_DEFECTO.media : r.modelo
  }

  responder(solicitudId: string, decision: DecisionHumana): boolean {
    return this.puerta.responder(String(solicitudId), decision)
  }

  listarTrazas(limite?: number): Promise<ResumenTraza[]> {
    return this.trazas.listar(limite)
  }

  obtenerTraza(id: string): Promise<Traza | undefined> {
    return this.trazas.obtener(validarId(id))
  }

  eliminarTraza(id: string): Promise<void> {
    return this.trazas.eliminar(validarId(id))
  }

  evalsSuites(): InfoSuite[] {
    return infoSuites()
  }

  /** Ejecuta una suite de evals contra el modelo real (en proyectos temporales) y la compara con el informe anterior. */
  async ejecutarEvals(suiteId: string, casos?: string[]): Promise<ResultadoEvals> {
    const suite = SUITES.find((s) => s.id === suiteId)
    if (!suite) throw new Error(`Suite desconocida: ${suiteId}`)
    const anterior = (await this.informes.listar(suite.id, 1))[0]
    const informe = await ejecutarSuite(suite, { llm: await this.llm(), trazador: this.trazador, modelo: MODELOS_POR_DEFECTO.media }, casos ? { casos } : {})
    // Una ejecución parcial no se guarda: falsearía la comparación con la suite completa.
    if (!casos) await this.informes.guardar(informe)
    return { informe, ...(anterior && !casos ? { comparacion: compararInformes(anterior, informe) } : {}) }
  }

  evalsInformes(suiteId: string) {
    return this.informes.listar(String(suiteId))
  }

  cancelar(id: string): void {
    this.activas.get(id)?.abort()
  }

  async detener(): Promise<void> {
    for (const c of this.activas.values()) c.abort()
    await this.mcp.detener()
  }
}

export function registrarIpcCore(nucleo: Nucleo): void {
  ipcMain.handle(Canales.coreEjecutar, async (e, sol: SolicitudAgente) => {
    if (typeof sol?.prompt !== 'string' || !sol.prompt.trim()) throw new Error('prompt vacío')
    const emisor = e.sender
    return nucleo.ejecutar(sol, (ev) => {
      if (!emisor.isDestroyed()) emisor.send(Canales.coreEvento, ev)
    })
  })
  ipcMain.handle(Canales.coreCancelar, (_e, id: string) => nucleo.cancelar(String(id)))
  ipcMain.handle(Canales.coreResponder, (_e, solicitudId: string, decision: DecisionHumana) => nucleo.responder(solicitudId, decision))
  ipcMain.handle(Canales.coreWorktreesListar, (_e, proyectoId: string) => nucleo.listarWorktrees(String(proyectoId)))
  ipcMain.handle(Canales.coreWorktreeDescartar, (_e, proyectoId: string, id: string) => nucleo.descartarWorktree(String(proyectoId), String(id)))
  ipcMain.handle(Canales.coreWorktreePublicar, (e, proyectoId: string, id: string) =>
    nucleo.publicarWorktree(String(proyectoId), String(id), (ev) => {
      if (!e.sender.isDestroyed()) e.sender.send(Canales.coreEvento, ev)
    })
  )
  ipcMain.handle(Canales.coreTrazasListar, (_e, limite?: number) => nucleo.listarTrazas(typeof limite === 'number' ? limite : undefined))
  ipcMain.handle(Canales.coreTrazaObtener, (_e, id: string) => nucleo.obtenerTraza(String(id)))
  ipcMain.handle(Canales.coreTrazaEliminar, (_e, id: string) => nucleo.eliminarTraza(String(id)))
  ipcMain.handle(Canales.coreEvalsSuites, () => nucleo.evalsSuites())
  ipcMain.handle(Canales.coreEvalsEjecutar, (_e, suiteId: string, casos?: string[]) => nucleo.ejecutarEvals(String(suiteId), Array.isArray(casos) ? casos.map(String) : undefined))
  ipcMain.handle(Canales.coreEvalsInformes, (_e, suiteId: string) => nucleo.evalsInformes(suiteId))
  ipcMain.handle(Canales.coreSesionesListar, (_e, proyectoId?: string) => nucleo.sesiones.listar(proyectoId ? String(proyectoId) : undefined))
  ipcMain.handle(Canales.coreSesionObtener, (_e, id: string) => nucleo.sesiones.transcripcion(validarId(String(id))))
  ipcMain.handle(Canales.coreSesionTranscripcion, (_e, id: string, turnos: TurnoGuardado[], proyectoId?: string) =>
    nucleo.sesiones.guardarTranscripcion(validarId(String(id)), Array.isArray(turnos) ? turnos : [], proyectoId ? validarId(String(proyectoId)) : undefined)
  )
  ipcMain.handle(Canales.coreSesionBorrar, (_e, id: string) => nucleo.sesiones.borrar(String(id)))
  ipcMain.handle(Canales.coreMemoriaListar, (_e, proyectoId?: string) => nucleo.memoria.listar(proyectoId || undefined))
  ipcMain.handle(Canales.coreMemoriaGuardar, (_e, entrada: NuevaEntradaMemoria, proyectoId?: string) =>
    nucleo.memoria.guardar(entrada, proyectoId || undefined)
  )
  ipcMain.handle(Canales.coreMemoriaEliminar, (_e, id: string, proyectoId?: string) =>
    nucleo.memoria.eliminar(String(id), proyectoId || undefined)
  )
  ipcMain.handle(Canales.coreMcpEstado, () => nucleo.mcp.estado())
  ipcMain.handle(Canales.coreMcpReiniciar, () => nucleo.iniciarMcp())
}
