import type { ResultadoHerramienta } from '@shared/core/herramientas'
import { AVISO_CONTENIDO_WEB, PREFIJO_CHROME } from '@shared/chrome-herramientas'
import { clicSensible, esLocal, origenDe, type PestanaChrome } from '@shared/chrome'
import { normalizarUrl } from '@shared/navegador'
import type { PuenteChrome, EventoPagina } from './chrome/puente'
import type { ControlNavegador } from './core/herramientas-odesk'
import type { MensajeConsola, PeticionRed } from './navegador'
import { ACCIONES_MOTOR, describirRef, ejecutarAccion, espera, pie, type CanalPagina, type E } from './navegador-motor'

const MAX_REGISTROS = 300

/** Respuesta de la persona a «¿dejas que la IA use este sitio?». */
export type DecisionSitio = 'no' | 'sesion' | 'siempre'

export interface DepsChromeIA {
  puente: PuenteChrome
  /** Pregunta en Odesk si la IA puede usar un sitio (en orden, una a la vez). */
  preguntarSitio: (origen: string, cliente?: string) => Promise<DecisionSitio>
  /** Confirma una acción delicada en Odesk. */
  confirmar: (pregunta: string, cliente?: string) => Promise<boolean>
}

interface Registros {
  consola: MensajeConsola[]
  red: PeticionRed[]
  pendientes: Map<string, { metodo: string; url: string; tipo: string }>
  error?: string
}

const anadir = <T>(lista: T[], x: T): void => {
  lista.push(x)
  if (lista.length > MAX_REGISTROS) lista.splice(0, lista.length - MAX_REGISTROS)
}

const NIVELES: Record<string, MensajeConsola['nivel']> = { error: 'error', assert: 'error', warning: 'warning', warn: 'warning', info: 'info', log: 'info', debug: 'debug', verbose: 'debug', trace: 'debug' }

/** Texto de los argumentos de un `console.*` tal como los manda el protocolo de DevTools. */
function textoConsola(args: unknown): string {
  if (!Array.isArray(args)) return ''
  return args
    .map((a: { value?: unknown; description?: string; type?: string }) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? a.type ?? '')))
    .join(' ')
    .slice(0, 2000)
}

/**
 * La IA maneja el Chrome real del usuario por la extensión (`chrome/puente.ts`). Mismas acciones que el navegador integrado (motor común
 * `navegador-motor.ts`), con tres barreras más porque es el navegador de la persona, con sus sesiones abiertas:
 * - solo las pestañas del grupo «Odesk» (lo comprueba la propia extensión);
 * - cada sitio (origen) se autoriza en Odesk antes de leerlo o tocarlo: esta sesión o siempre; lo local (localhost) no pregunta;
 * - lo que no se deshace se confirma: ejecutar JavaScript siempre y los clics con pinta de comprar, pagar, publicar, enviar o borrar.
 * Los diálogos `confirm`/`prompt`/`beforeunload` de la página se RECHAZAN (en el navegador integrado se aceptan): la IA no debe aceptar
 * «¿Eliminar cuenta?» por su cuenta. Lo leído lleva `AVISO_CONTENIDO_WEB` (la página puede intentar dar órdenes al modelo).
 */
export class ChromeIA implements ControlNavegador {
  private ultima?: number
  private readonly registros = new Map<number, Registros>()
  private readonly sesion = new Set<string>()
  private readonly negadosSesion = new Set<string>()
  private readonly colas = new Map<number, Promise<unknown>>()

  constructor(private readonly d: DepsChromeIA) {
    d.puente.alEvento = (e) => this.evento(e)
  }

  /** `ctx.cliente`: el asistente que llama (las preguntas en Odesk dicen quién pide). */
  async ejecutar(nombre: string, e: E, ctx: { cliente?: string } = {}): Promise<ResultadoHerramienta> {
    const cliente = ctx.cliente
    const datos = await this.d.puente.leerDatos()
    if (!datos.activo) return { texto: 'El control de Chrome está apagado en Odesk (Proveedores de IA → Chrome). Pídele al usuario que lo active si quiere usarlo.', error: true }
    if (nombre === 'chrome_pestanas') return { texto: await this.listar() }
    if (!this.d.puente.conectado) throw new Error('Chrome no está conectado. Pídele al usuario que abra Chrome con la extensión «Odesk Code · Chrome» y la empareje en Odesk → Proveedores de IA → Chrome.')
    if (this.d.puente.pausado) throw new Error('El usuario pausó el control de Chrome desde la extensión. Pídele que lo reanude si quiere que sigas.')
    if (nombre === 'chrome_abrir') return this.abrir(e, cliente)
    const pestana = await this.pestana(e.pestana)
    const previa = this.colas.get(pestana.id) ?? Promise.resolve()
    const actual = previa.catch(() => undefined).then(() => this.enPestana(nombre, pestana, e, cliente))
    this.colas.set(pestana.id, actual)
    try {
      return await actual
    } finally {
      if (this.colas.get(pestana.id) === actual) this.colas.delete(pestana.id)
    }
  }

  private async listar(): Promise<string> {
    const p = this.d.puente
    if (!p.conectado) return 'Chrome no está conectado (falta abrir Chrome con la extensión de Odesk o emparejarla en Odesk → Proveedores de IA → Chrome).'
    const lista = await this.actualizarPestanas()
    const cab = `Conectado: ${p.navegador?.nombre ?? 'Chrome'}${p.pausado ? ' (PAUSADO por el usuario)' : ''}.`
    if (!lista.length) return `${cab}\nNo hay pestañas en el grupo «Odesk». Abre una con chrome_abrir (o el usuario puede compartir la suya desde la extensión).`
    return [cab, ...lista.map((x) => `pestaña ${x.id}: «${x.titulo}» — ${x.url}${x.cargando ? ' (cargando)' : ''}${x.activa ? ' (a la vista)' : ''}${x.id === this.ultima ? ' (la última que usaste)' : ''}`)].join('\n')
  }

  private async actualizarPestanas(): Promise<PestanaChrome[]> {
    const lista = await this.d.puente.pedir<PestanaChrome[]>('pestanas').catch(() => this.d.puente.pestanas)
    this.d.puente.pestanas = Array.isArray(lista) ? lista : []
    return this.d.puente.pestanas
  }

  private async pestana(v: unknown): Promise<PestanaChrome> {
    const lista = await this.actualizarPestanas()
    if (typeof v === 'number') {
      const p = lista.find((x) => x.id === v)
      if (!p) throw new Error(`La pestaña ${v} no está en el grupo «Odesk» (o se cerró).\n${await this.listar()}`)
      this.ultima = v
      return p
    }
    const ultima = lista.find((x) => x.id === this.ultima)
    if (ultima) return ultima
    if (lista.length === 1) return ((this.ultima = lista[0]!.id), lista[0]!)
    if (!lista.length) throw new Error('No hay pestañas en el grupo «Odesk»: abre una con chrome_abrir.')
    throw new Error(`Hay varias pestañas: indica «pestana».\n${await this.listar()}`)
  }

  /** ¿Puede la IA usar este sitio? Pregunta la primera vez (local no pregunta). */
  private async autorizar(url: string, cliente?: string): Promise<void> {
    const origen = origenDe(url)
    if (!origen) {
      if (/^(about:blank|chrome:\/\/newtab)/.test(url)) return
      throw new Error(`Solo se pueden usar páginas web http/https (esta es «${url.slice(0, 80)}»).`)
    }
    if (esLocal(origen) || this.sesion.has(origen) || (await this.d.puente.leerDatos()).sitios.includes(origen)) return
    if (this.negadosSesion.has(origen)) throw new Error(`El usuario no autorizó usar ${origen} en esta sesión. No lo intentes por otra vía.`)
    const r = await this.d.preguntarSitio(origen, cliente)
    if (r === 'no') {
      this.negadosSesion.add(origen)
      throw new Error(`El usuario no autorizó que uses ${origen}. No lo intentes por otra vía.`)
    }
    if (r === 'siempre') await this.d.puente.cambiarDatos((d) => void (d.sitios.includes(origen) || d.sitios.push(origen)))
    else this.sesion.add(origen)
  }

  private async abrir(e: E, cliente?: string): Promise<ResultadoHerramienta> {
    const n = normalizarUrl(String(e.url))
    if ('error' in n) throw new Error(n.error)
    await this.autorizar(n.url, cliente)
    const id = await this.d.puente.pedir<number>('abrir', { url: n.url })
    this.ultima = id
    const c = this.canal(id)
    await c.esperarCarga(15_000)
    await this.actualizarPestanas()
    return { texto: `Pestaña ${id} abierta en el grupo «Odesk».\n${await pie(c)}` }
  }

  private async enPestana(nombre: string, p: PestanaChrome, e: E, cliente?: string): Promise<ResultadoHerramienta> {
    const accion = nombre.slice(PREFIJO_CHROME.length)
    const c = this.canal(p.id)
    // El sitio en el que está ahora (puede haber navegado desde la última lista) y, al ir, también el de destino.
    const ahora = (await c.estado()).url
    const yendo = accion === 'ir' && typeof e.url === 'string' && e.url !== ''
    if (!yendo) await this.autorizar(ahora, cliente)
    if (accion === 'cerrar') {
      await this.d.puente.pedir('cerrar', { pestana: p.id })
      this.registros.delete(p.id)
      if (this.ultima === p.id) this.ultima = undefined
      return { texto: `Pestaña ${p.id} cerrada.` }
    }
    if (!ACCIONES_MOTOR.has(accion)) throw new Error(`Herramienta de Chrome desconocida: ${nombre}`)
    let entrada = e
    if (accion === 'ir' && typeof e.url === 'string' && e.url) {
      const n = normalizarUrl(e.url)
      if ('error' in n) throw new Error(n.error)
      await this.autorizar(n.url, cliente)
      this.registro(p.id).error = undefined
      entrada = { ...e, url: n.url }
    }
    if (accion === 'evaluar') {
      const codigo = String(e.codigo).slice(0, 1500)
      if (!(await this.d.confirmar(`Ejecutar JavaScript en tu Chrome, en ${origenDe(ahora) ?? ahora}:\n\n${codigo}`, cliente))) throw new Error('El usuario no autorizó ejecutar ese JavaScript. No lo intentes por otra vía.')
    }
    if (accion === 'clic' && typeof e.ref === 'string') {
      const desc = await describirRef(c, e.ref)
      if (clicSensible(desc) && !(await this.d.confirmar(`Clic en ${desc}\nen ${ahora}\n\nPuede comprar, pagar, publicar, enviar o borrar algo.`, cliente)))
        throw new Error(`El usuario no autorizó el clic en ${desc}. Pregúntale qué quiere hacer.`)
    }
    const r = await ejecutarAccion(c, accion, entrada)
    // Tras navegar o hacer clic, la página puede estar en otro sitio: si no está autorizado, la próxima acción preguntará.
    return accion === 'instantanea' || accion === 'evaluar' ? { ...r, texto: `${AVISO_CONTENIDO_WEB}\n${r.texto}` } : r
  }

  private registro(id: number): Registros {
    let r = this.registros.get(id)
    if (!r) this.registros.set(id, (r = { consola: [], red: [], pendientes: new Map() }))
    return r
  }

  /** Eventos de DevTools que reenvía la extensión: consola, red, errores de carga y diálogos. */
  private evento({ pestana, metodo, params: p }: EventoPagina): void {
    const r = this.registro(pestana)
    const ahora = Date.now()
    switch (metodo) {
      case 'Runtime.consoleAPICalled':
        return anadir(r.consola, { nivel: NIVELES[String(p.type)] ?? 'info', texto: textoConsola(p.args), cuando: ahora })
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails as { text?: string; url?: string; lineNumber?: number; exception?: { description?: string } } | undefined
        return anadir(r.consola, { nivel: 'error', texto: (d?.exception?.description ?? d?.text ?? 'Excepción').slice(0, 2000), ...(d?.url ? { origen: `${d.url}:${(d.lineNumber ?? 0) + 1}` } : {}), cuando: ahora })
      }
      case 'Log.entryAdded': {
        const en = p.entry as { level?: string; text?: string; url?: string } | undefined
        return anadir(r.consola, { nivel: NIVELES[String(en?.level)] ?? 'info', texto: String(en?.text ?? '').slice(0, 2000), ...(en?.url ? { origen: en.url } : {}), cuando: ahora })
      }
      case 'Network.requestWillBeSent': {
        const q = p.request as { method?: string; url?: string } | undefined
        if (!q?.url || q.url.startsWith('data:')) return
        r.pendientes.set(String(p.requestId), { metodo: q.method ?? 'GET', url: q.url, tipo: String(p.type ?? 'Other') })
        if (r.pendientes.size > 500) r.pendientes.delete(r.pendientes.keys().next().value!)
        return
      }
      case 'Network.responseReceived': {
        const q = r.pendientes.get(String(p.requestId))
        if (!q) return
        r.pendientes.delete(String(p.requestId))
        return anadir(r.red, { ...q, estado: Number((p.response as { status?: number } | undefined)?.status ?? 0), cuando: ahora })
      }
      case 'Network.loadingFailed': {
        const q = r.pendientes.get(String(p.requestId))
        if (!q) return
        r.pendientes.delete(String(p.requestId))
        const error = String(p.errorText ?? 'fallo de red')
        if (q.tipo === 'Document' && p.canceled !== true) r.error = error
        return anadir(r.red, { ...q, error, cuando: ahora })
      }
      case 'Page.javascriptDialogOpening': {
        const tipo = String(p.type ?? '')
        const aceptar = tipo === 'alert'
        anadir(r.consola, { nivel: 'warning', texto: `[diálogo ${tipo}] ${String(p.message ?? '').slice(0, 500)} → ${aceptar ? 'aceptado' : 'RECHAZADO (en el Chrome del usuario no se aceptan confirmaciones solas: pregúntale)'}`, cuando: ahora })
        void this.d.puente.pedir('cdp', { pestana, metodo: 'Page.handleJavaScriptDialog', params: { accept: aceptar } }).catch(() => undefined)
      }
    }
  }

  /** Una pestaña de Chrome vista por el motor común. */
  private canal(id: number): CanalPagina {
    const pedir = this.d.puente.pedir.bind(this.d.puente)
    const r = this.registro(id)
    type Estado = { url: string; titulo: string; cargando: boolean }
    const estado = (): Promise<Estado> => pedir<Estado>('estado', { pestana: id })
    return {
      cdp: <T>(metodo: string, params: object = {}) => pedir<T>('cdp', { pestana: id, metodo, params }),
      aislado: (codigo) => pedir('aislado', { pestana: id, codigo }, 20_000),
      zoom: async () => Number(await pedir('zoom', { pestana: id }).catch(() => 1)) || 1,
      vista: async () => {
        const m = await pedir<{ cssLayoutViewport?: { clientWidth: number; clientHeight: number }; layoutViewport?: { clientWidth: number; clientHeight: number } }>('cdp', { pestana: id, metodo: 'Page.getLayoutMetrics', params: {} })
        const v = m.cssLayoutViewport ?? m.layoutViewport
        return { ancho: v?.clientWidth ?? 1280, alto: v?.clientHeight ?? 800 }
      },
      estado: async () => ({ ...(await estado()), error: r.error }),
      navegar: async (d) => void (await pedir('navegar', { pestana: id, ...d })),
      esperarCarga: async (maxMs) => {
        await espera(200)
        const fin = Date.now() + maxMs
        while (Date.now() < fin) {
          const s = await estado().catch(() => undefined)
          if (!s?.cargando) break
          await espera(200)
        }
        await espera(150)
      },
      anunciar: (texto) => void pedir('anunciar', { pestana: id, texto: texto.slice(0, 120) }, 5_000).catch(() => undefined),
      consola: r.consola,
      red: r.red
    }
  }
}
