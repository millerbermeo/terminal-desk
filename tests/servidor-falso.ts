import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { vi } from 'vitest'

export interface ProyectoFalso {
  id: string
  nombre: string
  ruta: string
  grupo?: string
  repo?: string
}

/**
 * Servidor de la API en memoria (solo lo que usa el escritorio): acepta cualquier login y devuelve la lista de proyectos que se
 * le dé. `proyectos` se puede modificar durante el test.
 */
export class ServidorFalso {
  readonly proyectos: ProyectoFalso[]
  /** Comandos con `/` de la cuenta, tal como los guarda la API. */
  readonly comandos: Record<string, unknown>[] = []
  readonly grupos: { id: string; nombre: string }[] = []
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
      if (req.url === '/auth/login' && req.method === 'POST') return responder(200, { token: 'token-falso', usuario: { id: 'u1', email: 'test@desk.local' } })
      if (req.url === '/projects' && req.method === 'GET') {
        return responder(200, {
          groups: this.grupos.map((g) => ({ id: g.id, name: g.nombre })),
          projects: this.proyectos.map((p) => ({ id: p.id, name: p.nombre, repo: p.repo ?? null, groupId: p.grupo ?? null }))
        })
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
          const c = JSON.parse(Buffer.concat(trozos).toString() || '{}') as { name: string; groupId?: string; repo?: string }
          const p: ProyectoFalso = { id: randomUUID(), nombre: c.name, ruta: '', ...(c.groupId ? { grupo: c.groupId } : {}), ...(c.repo ? { repo: c.repo } : {}) }
          this.proyectos.push(p)
          responder(201, { id: p.id, name: p.nombre, repo: p.repo ?? null, groupId: p.grupo ?? null })
        })
        return
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
      if (req.url === '/agentes' && req.method === 'GET') return responder(200, { resources: [], activations: [] })
      responder(404, { message: 'no implementado en el servidor falso' })
    })
    await new Promise<void>((ok) => this.http.listen(0, '127.0.0.1', ok))
    this.url = `http://127.0.0.1:${(this.http.address() as AddressInfo).port}`
    return this
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
