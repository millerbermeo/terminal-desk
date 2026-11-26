import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { vi } from 'vitest'

export interface ProyectoFalso {
  id: string
  nombre: string
  ruta: string
  grupo?: string
  repo?: string
  /** Proyecto local: solo lo ve el equipo con este id. */
  equipo?: string
}

/**
 * Servidor de la API en memoria (solo lo que usa el escritorio): acepta cualquier login y devuelve la lista de proyectos que se
 * le dé. `proyectos` se puede modificar durante el test.
 */
export class ServidorFalso {
  readonly proyectos: ProyectoFalso[]
  /** Comandos con `/` de la cuenta, tal como los guarda la API. */
  readonly comandos: Record<string, unknown>[] = []
  readonly grupos: { id: string; nombre: string; equipo?: string }[] = []
  /** Recursos de la biblioteca de agentes y skills, como los devuelve `/agentes`. */
  readonly recursos: Record<string, unknown>[] = []
  /** Activaciones de la biblioteca (`targetType`, `targetId`, `resourceId`). */
  readonly activaciones: { targetType: string; targetId: string; resourceId: string }[] = []
  /** Comandos de arranque de la cuenta, como los devuelve `/arranque` (con las mismas reglas de repetidos que la API real). */
  readonly arranque: Record<string, unknown>[] = []
  /** Peticiones recibidas (`METODO ruta`), para comprobar lo que NO se pide. */
  readonly peticiones: string[] = []
  /** Simula el servidor caído: las conexiones se cortan sin responder. */
  caido = false
  private http!: Server
  url = ''

  constructor(proyectos: ProyectoFalso[] = []) {
    this.proyectos = proyectos
  }

  async iniciar(): Promise<this> {
    this.http = createServer((req, res) => {
      const responder = (codigo: number, cuerpo?: unknown): void => {
        res.writeHead(codigo, { 'content-type': 'application/json' })
        res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo))
      }
      if (this.caido) return void req.socket.destroy()
      this.peticiones.push(`${req.method} ${req.url}`)
      if (req.url?.startsWith('/arranque')) return this.atenderArranque(req.url, req.method ?? 'GET', req, responder)
      if (req.url === '/auth/login' && req.method === 'POST') return responder(200, { token: 'token-falso', usuario: { id: 'u1', email: 'test@desk.local' } })
      if (req.url?.split('?')[0] === '/projects' && req.method === 'GET') {
        // Como la API real: lo local solo para su equipo (`?device=`); sin equipo, nada local.
        const equipo = new URL(req.url, 'http://x').searchParams.get('device') ?? undefined
        const ve = (x: { equipo?: string }): boolean => !x.equipo || x.equipo === equipo
        return responder(200, {
          groups: this.grupos.filter(ve).map((g) => ({ id: g.id, name: g.nombre, deviceId: g.equipo ?? null })),
          projects: this.proyectos.filter(ve).map((p) => ({ id: p.id, name: p.nombre, repo: p.repo ?? null, groupId: p.grupo ?? null, deviceId: p.equipo ?? null }))
        })
      }
      const nombreDe = /^\/projects\/([^/?]+)\/name$/.exec(req.url ?? '')
      if (nombreDe && req.method === 'PUT') {
        const trozos: Buffer[] = []
        req.on('data', (t: Buffer) => trozos.push(t))
        req.on('end', () => {
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { name?: string }
          const p = this.proyectos.find((x) => x.id === decodeURIComponent(nombreDe[1]!))
          if (!p) return responder(404, { message: 'El proyecto no existe' })
          p.nombre = String(c.name ?? '').trim()
          responder(200, { id: p.id, name: p.nombre })
        })
        return
      }
      const equipoDe = /^\/(projects|groups)\/([^/?]+)\/device$/.exec(req.url ?? '')
      if (equipoDe && req.method === 'PUT') {
        const trozos: Buffer[] = []
        req.on('data', (t: Buffer) => trozos.push(t))
        req.on('end', () => {
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { deviceId?: string | null }
          const lista: { id: string; equipo?: string }[] = equipoDe[1] === 'projects' ? this.proyectos : this.grupos
          const x = lista.find((y) => y.id === decodeURIComponent(equipoDe[2]!))
          if (!x) return responder(404, { message: 'No existe' })
          if (c.deviceId) x.equipo = c.deviceId
          else delete x.equipo
          responder(200, { id: x.id, deviceId: x.equipo ?? null })
        })
        return
      }
      const uno = /^\/projects\/([^/?]+)$/.exec(req.url ?? '')
      if (uno && req.method === 'GET') {
        const p = this.proyectos.find((x) => x.id === decodeURIComponent(uno[1]!))
        return p ? responder(200, { id: p.id, name: p.nombre, repo: p.repo ?? null, groupId: p.grupo ?? null }) : responder(404, { message: 'El proyecto no existe' })
      }
      if (req.url === '/projects' && req.method === 'POST') {
        const trozos: Buffer[] = []
        req.on('data', (t: Buffer) => trozos.push(t))
        req.on('end', () => {
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { name: string; groupId?: string; groupName?: string; repo?: string; deviceId?: string }
          let grupo = c.groupId
          if (!grupo && c.groupName) {
            const g = this.grupos.find((x) => x.nombre.toLowerCase() === c.groupName!.toLowerCase() && (x.equipo ?? null) === (c.deviceId ?? null)) ?? { id: randomUUID(), nombre: c.groupName, ...(c.deviceId ? { equipo: c.deviceId } : {}) }
            if (!this.grupos.includes(g)) this.grupos.push(g)
            grupo = g.id
          }
          const p: ProyectoFalso = { id: randomUUID(), nombre: c.name, ruta: '', ...(grupo ? { grupo } : {}), ...(c.repo ? { repo: c.repo } : {}), ...(c.deviceId ? { equipo: c.deviceId } : {}) }
          this.proyectos.push(p)
          responder(201, { id: p.id, name: p.nombre, repo: p.repo ?? null, groupId: p.grupo ?? null, deviceId: p.equipo ?? null })
        })
        return
      }
      if (uno && req.method === 'DELETE') {
        const i = this.proyectos.findIndex((x) => x.id === decodeURIComponent(uno[1]!))
        if (i < 0) return responder(404, { message: 'El proyecto no existe' })
        this.proyectos.splice(i, 1)
        return responder(204)
      }
      const grupoDe = /^\/projects\/([^/?]+)\/group$/.exec(req.url ?? '')
      if (grupoDe && req.method === 'PUT') {
        const trozos: Buffer[] = []
        req.on('data', (t: Buffer) => trozos.push(t))
        req.on('end', () => {
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { groupId?: string | null }
          const p = this.proyectos.find((x) => x.id === decodeURIComponent(grupoDe[1]!))
          if (!p) return responder(404, { message: 'El proyecto no existe' })
          if (c.groupId) p.grupo = c.groupId
          else delete p.grupo
          responder(200, { id: p.id })
        })
        return
      }
      if (req.url === '/groups' && req.method === 'POST') {
        const trozos: Buffer[] = []
        req.on('data', (t: Buffer) => trozos.push(t))
        req.on('end', () => {
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { name: string; deviceId?: string }
          const g = this.grupos.find((x) => x.nombre.toLowerCase() === c.name.toLowerCase() && (x.equipo ?? null) === (c.deviceId ?? null)) ?? { id: randomUUID(), nombre: c.name, ...(c.deviceId ? { equipo: c.deviceId } : {}) }
          if (!this.grupos.includes(g)) this.grupos.push(g)
          responder(201, { id: g.id, name: g.nombre, deviceId: g.equipo ?? null })
        })
        return
      }
      const grupo = /^\/groups\/([^/?]+)$/.exec(req.url ?? '')
      if (grupo && req.method === 'DELETE') {
        const i = this.grupos.findIndex((g) => g.id === decodeURIComponent(grupo[1]!))
        if (i < 0) return responder(404, { message: 'El grupo no existe' })
        const [g] = this.grupos.splice(i, 1)
        for (const p of this.proyectos) if (p.grupo === g!.id) delete p.grupo
        return responder(204)
      }
      if (req.url === '/comandos') {
        if (req.method === 'GET') return responder(200, { commands: this.comandos })
        const trozos: Buffer[] = []
        req.on('data', (t: Buffer) => trozos.push(t))
        req.on('end', () => {
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { name: string; projectId?: string }
          const i = this.comandos.findIndex((x) => x.name === c.name && (x.projectId ?? null) === (c.projectId ?? null))
          if (req.method === 'PUT') {
            const fila = { id: `c${this.comandos.length}`, projectId: null, template: null, command: null, args: false, allowed: false, ...c }
            if (i >= 0) this.comandos[i] = fila
            else this.comandos.push(fila)
            return responder(200, fila)
          }
          if (i < 0) return responder(404, { message: 'El comando no existe' })
          this.comandos.splice(i, 1)
          responder(204)
        })
        return
      }
      if (req.url === '/agentes' && req.method === 'GET') return responder(200, { resources: this.recursos, activations: this.activaciones })
      if ((req.url === '/agentes' && req.method === 'PUT') || (req.url === '/agentes/activaciones' && req.method === 'POST')) {
        const trozos: Buffer[] = []
        req.on('data', (t: Buffer) => trozos.push(t))
        req.on('end', () => {
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as Record<string, unknown>
          if (req.url === '/agentes/activaciones') {
            this.activaciones.push(c as (typeof this.activaciones)[number])
            return responder(201, c)
          }
          const fila = { id: randomUUID(), tools: null, model: null, projectId: null, ...c }
          this.recursos.push(fila)
          responder(200, fila)
        })
        return
      }
      responder(404, { message: 'no implementado en el servidor falso' })
    })
    await new Promise<void>((ok) => this.http.listen(0, '127.0.0.1', ok))
    this.url = `http://127.0.0.1:${(this.http.address() as AddressInfo).port}`
    return this
  }

  private atenderArranque(url: string, metodo: string, req: IncomingMessage, responder: (c: number, cuerpo?: unknown) => void): void {
    const filas = this.arranque as { id: string; projectId: string; name: string; command: string; cwd: string; port: number | null; position: number }[]
    const trozos: Buffer[] = []
    req.on('data', (t: Buffer) => trozos.push(t))
    req.on('end', () => {
      const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { id?: string; projectId?: string; ids?: string[]; name?: string; command?: string; cwd?: string; port?: number | null }
      if (metodo === 'GET') return responder(200, { commands: [...filas].sort((a, b) => a.projectId.localeCompare(b.projectId) || a.position - b.position) })
      if (metodo === 'DELETE') {
        const i = filas.findIndex((f) => f.id === url.split('/')[2])
        if (i < 0) return responder(404, { message: 'El comando no existe' })
        filas.splice(i, 1)
        return responder(204)
      }
      if (url === '/arranque/orden') {
        const ids = c.ids as string[]
        const del = filas.filter((f) => f.projectId === c.projectId)
        for (const [i, id] of ids.entries()) {
          const f = del.find((x) => x.id === id)
          if (!f) return responder(404, { message: 'Algún comando no existe en este proyecto' })
          f.position = i
        }
        return responder(200, { commands: del.sort((a, b) => a.position - b.position) })
      }
      const del = filas.filter((f) => f.projectId === c.projectId && f.id !== c.id)
      const igual = del.find((f) => f.command.toLowerCase() === String(c.command).toLowerCase() && f.cwd === (c.cwd ?? '')) ?? del.find((f) => f.name.toLowerCase() === String(c.name).toLowerCase()) ?? del.find((f) => c.port != null && f.port === c.port)
      if (igual) return responder(409, { message: `Ya existe «${igual.name}» con ese mismo comando, nombre o puerto` })
      const previo = filas.find((f) => f.id === c.id)
      if (c.id && !previo) return responder(404, { message: 'El comando no existe' })
      const fila = { id: randomUUID(), position: del.length, readyText: null, waitMs: 0, always: false, waitFor: 'nada', cwd: '', port: null, ...(previo ?? {}), ...c } as (typeof filas)[number]
      if (previo) Object.assign(previo, fila)
      else filas.push(fila)
      responder(200, fila)
    })
  }

  /** Apunta el cliente del escritorio a este servidor (antes de importar nada que lo use) y, tras importar, abre sesión. */
  apuntar(): void {
    vi.stubEnv('ODESK_API_URL', this.url)
  }

  async entrar(): Promise<void> {
    const { servidor } = await import('../src/main/servidor/cliente')
    await servidor.iniciar('test@desk.local', 'clave-de-prueba')
    await this.refrescar()
  }

  /** Tras cambiar `proyectos` a mano: descarta lo que el escritorio tenía guardado. */
  async refrescar(): Promise<void> {
    const { olvidarProyectos, rutasLocales } = await import('../src/main/proyectos')
    // El servidor real no guarda rutas: cada equipo conoce las suyas. Aquí «este equipo» tiene todas las del test.
    // `ruta` vacía = proyecto de la cuenta que aún no tiene carpeta en este equipo.
    for (const p of this.proyectos) if (p.ruta) await rutasLocales.fijar(p.id, p.ruta)
    olvidarProyectos()
  }

  cerrar(): Promise<void> {
    return new Promise((ok) => this.http.close(() => ok()))
  }
}
