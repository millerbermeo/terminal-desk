import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoriaArranque } from '../src/main/arranque/almacen'
import { ejecutarOperacionArranque } from '../src/main/arranque/operaciones'
import { ServicioArranque, type DepsArranque } from '../src/main/arranque/servicio'
import type { ComandoArranque, EntradaComandoArranque, EstadoArranque, ProcesoPuerto, ProyectoRuta, TerminalArranque } from '../src/shared/arranque'

const esperar = async (cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> => {
  const fin = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > fin) throw new Error('tiempo agotado esperando la condición')
    await new Promise((r) => setTimeout(r, 5))
  }
}
const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Terminales falsas: guardan lo que se les escribe y dejan al test decidir cuándo «termina» el comando. */
class TerminalesFalsas {
  n = 0
  creadas: { id: string; cwd: string; pid: number }[] = []
  escrito = new Map<string, string[]>()
  cerradas: string[] = []
  enShellDe = new Set<string>()
  alEscribir?: (id: string, datos: string) => void
  crear({ cwd }: { cwd: string }): string {
    const id = `pty${++this.n}`
    this.creadas.push({ id, cwd, pid: 1000 + this.n })
    this.escrito.set(id, [])
    return id
  }
  escribir(id: string, datos: string): void {
    this.escrito.get(id)!.push(datos)
    this.alEscribir?.(id, datos)
  }
  cerrar(id: string): void {
    this.cerradas.push(id)
  }
  enShell(id: string): boolean {
    return this.enShellDe.has(id)
  }
  pid(id: string): number | undefined {
    return this.creadas.find((c) => c.id === id)?.pid
  }
}

describe('servicio de arranque', () => {
  let raiz: string
  let proyectos: ProyectoRuta[]
  let term: TerminalesFalsas
  let abiertos: Set<number>
  let duenos: Map<number, ProcesoPuerto>
  let cerrados: number[]
  let estados: EstadoArranque[]
  let terminales: TerminalArranque[]
  let almacen: MemoriaArranque
  let s: ServicioArranque
  let bloquearCierre = false

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'arranque-'))
    await mkdir(join(raiz, 'tienda', 'api'), { recursive: true })
    await mkdir(join(raiz, 'blog'), { recursive: true })
    proyectos = [
      { id: 'tienda', nombre: 'Tienda', ruta: join(raiz, 'tienda') },
      { id: 'blog', nombre: 'Blog', ruta: join(raiz, 'blog') }
    ]
    term = new TerminalesFalsas()
    abiertos = new Set()
    duenos = new Map()
    cerrados = []
    estados = []
    terminales = []
    bloquearCierre = false
    almacen = new MemoriaArranque()
    const deps: DepsArranque = {
      almacen,
      proyectos: async () => proyectos,
      terminales: term,
      puertoAbierto: async (p) => abiertos.has(p),
      duenoDePuerto: async (p) => duenos.get(p),
      cerrarProceso: async (pid) => {
        cerrados.push(pid)
        if (bloquearCierre) return false
        for (const [p, d] of [...duenos]) {
          if (d.pid !== pid) continue
          duenos.delete(p)
          abiertos.delete(p)
        }
        return true
      },
      alEstado: (e) => estados.push(e),
      alTerminal: (t) => terminales.push(t)
    }
    s = new ServicioArranque(deps, { sondeoMs: 10, graciaShellMs: 40, vigilanciaMs: 15, liberarEsperaMs: 200 })
  })
  afterEach(() => s.cerrar())

  const guardar = async (proyectoId: string, e: EntradaComandoArranque): Promise<ComandoArranque> => {
    const r = await s.guardar(proyectoId, e)
    if (!r.ok) throw new Error(r.mensaje)
    return r.comandos.find((c) => c.nombre === e.nombre)!
  }
  const estadoDe = (proyectoId: string, comandoId: string): string | undefined => s.estadosDe(proyectoId).find((e) => e.comandoId === comandoId)?.estado
  const historia = (comandoId: string): string[] => estados.filter((e) => e.comandoId === comandoId).map((e) => e.estado)
  /** Cuando se escribe el comando `texto`, abre el puerto tras `ms`. */
  const abrirAlEscribir = (texto: string, puerto: number, ms: number): void => {
    const previo = term.alEscribir
    term.alEscribir = (id, datos) => {
      previo?.(id, datos)
      if (datos.startsWith(texto)) setTimeout(() => void abiertos.add(puerto), ms)
    }
  }

  it('guarda por proyecto, sin repetir, y avisa si el puerto lo usa otro proyecto', async () => {
    await guardar('tienda', { nombre: 'API', comando: 'pnpm dev', cwd: 'api', puerto: 3000, esperar: 'puerto' })
    const dup = await s.guardar('tienda', { nombre: 'API bis', comando: ' PNPM   dev ', cwd: './api' })
    expect(dup).toMatchObject({ ok: false, mensaje: expect.stringContaining('mismo comando') })
    expect(await s.guardar('tienda', { nombre: 'x', comando: 'vite', puerto: 3000 })).toMatchObject({ ok: false })
    const otro = await s.guardar('blog', { nombre: 'Blog dev', comando: 'astro dev', puerto: 3000 })
    expect(otro).toMatchObject({ ok: true, avisos: [expect.stringContaining('«API» de «Tienda»')] })
    expect(await s.listar('tienda')).toHaveLength(1)
    expect((await s.listar('blog'))[0]!.nombre).toBe('Blog dev')
    await expect(s.listar('../etc')).rejects.toThrow('proyecto no válido')
  })

  it('arranca en orden, uno por uno: el siguiente espera a que el anterior esté listo (puerto, texto, nada)', async () => {
    const base = await guardar('tienda', { nombre: 'Base de datos', comando: 'docker compose up', esperar: 'puerto', puerto: 5432 })
    const api = await guardar('tienda', { nombre: 'API', comando: 'pnpm api', cwd: 'api', esperar: 'texto', textoListo: 'listening on' })
    const web = await guardar('tienda', { nombre: 'Web', comando: 'pnpm web', esperar: 'nada' })
    abrirAlEscribir('docker compose up', 5432, 120)
    const t0 = Date.now()
    expect(await s.arrancar('tienda')).toEqual({ ok: true, comandos: 3 })

    await esperar(() => term.creadas.length === 1)
    await pausa(60)
    expect(term.creadas).toHaveLength(1) // la API no arranca mientras la base de datos no abre su puerto
    expect(estadoDe('tienda', base.id)).toBe('arrancando')
    expect(estadoDe('tienda', api.id)).toBe('pendiente')
    expect(estadoDe('tienda', web.id)).toBe('pendiente')

    await esperar(() => term.creadas.length === 2)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110)
    expect(estadoDe('tienda', base.id)).toBe('listo')
    expect(term.creadas[1]!.cwd).toBe(join(raiz, 'tienda', 'api')) // la subcarpeta del comando
    expect(term.escrito.get('pty2')).toEqual(['pnpm api\r'])
    await pausa(60)
    expect(term.creadas).toHaveLength(2) // la web espera al texto de la API
    s.alDatos('pty2', '\u001b[32mServer Listening On\u001b[0m 4000\n')
    await esperar(() => estadoDe('tienda', web.id) === 'listo')
    expect(term.creadas.map((c) => c.cwd)).toEqual([join(raiz, 'tienda'), join(raiz, 'tienda', 'api'), join(raiz, 'tienda')])
    expect(historia(base.id)).toEqual(['pendiente', 'arrancando', 'arrancando', 'listo'])
    expect(terminales.map((t) => [t.nombre, t.ptyId])).toEqual([['Base de datos', 'pty1'], ['API', 'pty2'], ['Web', 'pty3']])
  })

  it('no confunde el eco del propio comando con el texto de «listo»', async () => {
    const c = await guardar('tienda', { nombre: 'API', comando: 'node servidor.js', esperar: 'texto', textoListo: 'servidor listo', esperaMs: 300 })
    await s.arrancar('tienda')
    await esperar(() => term.creadas.length === 1)
    s.alDatos('pty1', '$ node servidor.js\r\n')
    await pausa(60)
    expect(estadoDe('tienda', c.id)).toBe('arrancando')
    s.alDatos('pty1', 'Servidor listo en 3000\r\n')
    await esperar(() => estadoDe('tienda', c.id) === 'listo')
  })

  it('«tiempo» espera una pausa fija', async () => {
    const c = await guardar('tienda', { nombre: 'Seed', comando: 'sleep 1', esperar: 'tiempo', esperaMs: 100 })
    const t0 = Date.now()
    await s.arrancar('tienda')
    await esperar(() => estadoDe('tienda', c.id) === 'listo')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(95)
  })

  it('si un comando falla, corta la tanda y marca el resto como omitido; con «continuar» sigue', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a', esperar: 'puerto', puerto: 4001, esperaMs: 1000 })
    const b = await guardar('tienda', { nombre: 'B', comando: 'b', esperar: 'nada' })
    await s.arrancar('tienda')
    // la terminal de A termina sin abrir el puerto
    await esperar(() => term.creadas.length === 1)
    term.enShellDe.add('pty1')
    await esperar(() => estadoDe('tienda', a.id) === 'error')
    expect(s.estadosDe('tienda').find((e) => e.comandoId === a.id)!.mensaje).toContain('terminó sin abrir el puerto 4001')
    await esperar(() => estadoDe('tienda', b.id) === 'omitido')
    expect(term.creadas).toHaveLength(1)
    expect(term.cerradas).toEqual([]) // la terminal con el error se deja abierta para verlo

    await s.arrancar('tienda', { continuarSiFalla: true })
    await esperar(() => estadoDe('tienda', b.id) === 'listo')
    expect(estadoDe('tienda', a.id)).toBe('error')
  })

  it('un puerto que no se abre a tiempo es un error con el tiempo en el mensaje', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a', esperar: 'puerto', puerto: 4002, esperaMs: 1000 })
    const rapido = new ServicioArranque({ ...(s as unknown as { deps: DepsArranque }).deps }, { sondeoMs: 5, graciaShellMs: 10_000 })
    await rapido.arrancar('tienda')
    await esperar(() => rapido.estadosDe('tienda').some((e) => e.comandoId === a.id && e.estado === 'error'), 4000)
    expect(rapido.estadosDe('tienda')[0]!.mensaje).toBe('El puerto 4002 no se abrió en 1 s')
    rapido.cerrar()
  }, 8000)

  describe('puertos ocupados', () => {
    it('lo que ya es de este proyecto se da por en marcha y la tanda sigue', async () => {
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4010, esperar: 'puerto' })
      const b = await guardar('tienda', { nombre: 'B', comando: 'b' })
      abiertos.add(4010)
      duenos.set(4010, { pid: 7777, proceso: 'node', cwd: join(raiz, 'tienda', 'web'), ancestros: [] })
      await s.arrancar('tienda')
      await esperar(() => estadoDe('tienda', b.id) === 'listo')
      expect(estadoDe('tienda', a.id)).toBe('omitido')
      expect(s.estadosDe('tienda').find((e) => e.comandoId === a.id)!.mensaje).toContain('Ya estaba en marcha')
      expect(term.creadas).toHaveLength(1) // solo B
      expect(cerrados).toEqual([])
    })

    it('si lo ocupa otro proyecto (por su carpeta) NO lo pisa: error y corta la tanda', async () => {
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4011, esperar: 'puerto' })
      const b = await guardar('tienda', { nombre: 'B', comando: 'b' })
      abiertos.add(4011)
      duenos.set(4011, { pid: 7001, proceso: 'node', cwd: join(raiz, 'blog'), ancestros: [] })
      await s.arrancar('tienda')
      await esperar(() => estadoDe('tienda', b.id) === 'omitido')
      const e = s.estadosDe('tienda').find((x) => x.comandoId === a.id)!
      expect(e.estado).toBe('error')
      expect(e.mensaje).toContain('«Blog», de otro proyecto')
      expect(term.creadas).toHaveLength(0)
      expect(cerrados).toEqual([])
    })

    it('si lo ocupa un proceso de una terminal que lanzó el arranque de otro proyecto, lo sabe por los procesos padre', async () => {
      const web = await guardar('blog', { nombre: 'Web', comando: 'astro dev', puerto: 4012, esperar: 'puerto' })
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4012, esperar: 'puerto' })
      abrirAlEscribir('astro dev', 4012, 20)
      await s.arrancar('blog')
      await esperar(() => estadoDe('blog', web.id) === 'listo')
      const pidTerminal = term.creadas[0]!.pid
      duenos.set(4012, { pid: 5555, proceso: 'node', ancestros: [4444, pidTerminal] }) // cwd desconocido: solo se sabe por el padre
      const conflictos = await s.revisar('tienda')
      expect(conflictos).toEqual([expect.objectContaining({ comandoId: a.id, tipo: 'otro-proyecto', bloquea: true, proyectoNombre: 'Blog', otroComando: 'Web', pid: 5555, puedeLiberar: true })])
      await s.arrancar('tienda')
      await esperar(() => estadoDe('tienda', a.id) === 'error')
    })

    it('un programa ajeno bloquea; omitir lo salta y sigue; liberar lo cierra y arranca', async () => {
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4013, esperar: 'puerto' })
      const b = await guardar('tienda', { nombre: 'B', comando: 'b', puerto: 4014, esperar: 'nada' })
      abiertos.add(4013)
      abiertos.add(4014)
      duenos.set(4013, { pid: 8001, proceso: 'postgres', cwd: '/var/lib', ancestros: [] })
      duenos.set(4014, { pid: 8002, proceso: 'nginx', ancestros: [] })

      const conflictos = await s.revisar('tienda')
      expect(conflictos.map((c) => [c.puerto, c.tipo, c.bloquea, c.pid])).toEqual([[4013, 'ajeno', true, 8001], [4014, 'ajeno', true, 8002]])

      await s.arrancar('tienda', { resoluciones: { [a.id]: 'omitir', [b.id]: 'liberar' } })
      await esperar(() => estadoDe('tienda', b.id) === 'listo')
      expect(estadoDe('tienda', a.id)).toBe('omitido')
      expect(cerrados).toEqual([8002]) // solo el que se eligió liberar
      expect(duenos.has(4013)).toBe(true)
      expect(term.creadas).toHaveLength(1)
    })

    it('al liberar solo cierra el proceso que de verdad sigue escuchando; si cambió, no mata nada', async () => {
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4015 })
      abiertos.add(4015)
      duenos.set(4015, { pid: 9001, ancestros: [] })
      const original = (s as unknown as { deps: DepsArranque }).deps.duenoDePuerto
      let llamadas = 0
      ;(s as unknown as { deps: DepsArranque }).deps.duenoDePuerto = async (p) => {
        llamadas++
        return llamadas === 1 ? original(p) : { pid: 9002, ancestros: [] } // otro proceso tomó el puerto entre la revisión y el cierre
      }
      await s.arrancar('tienda', { resoluciones: { [a.id]: 'liberar' } })
      await esperar(() => estadoDe('tienda', a.id) === 'error')
      expect(s.estadosDe('tienda')[0]!.mensaje).toContain('otro proceso (9002)')
      expect(cerrados).toEqual([])
    })

    it('si no se puede cerrar el proceso, es un error', async () => {
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4016 })
      abiertos.add(4016)
      duenos.set(4016, { pid: 9100, ancestros: [] })
      bloquearCierre = true
      await s.arrancar('tienda', { resoluciones: { [a.id]: 'liberar' } })
      await esperar(() => estadoDe('tienda', a.id) === 'error')
      expect(s.estadosDe('tienda')[0]!.mensaje).toContain('No se pudo cerrar el proceso 9100')
    })

    it('sin saber quién lo usa no hay nada que liberar', async () => {
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4017 })
      abiertos.add(4017)
      expect((await s.revisar('tienda'))[0]).toMatchObject({ tipo: 'ajeno', puedeLiberar: false })
      await s.arrancar('tienda', { resoluciones: { [a.id]: 'liberar' } })
      await esperar(() => estadoDe('tienda', a.id) === 'error')
      expect(s.estadosDe('tienda')[0]!.mensaje).toContain('No se sabe qué proceso usa el puerto 4017')
    })

    it('revisar avisa (sin bloquear) cuando otro proyecto tiene configurado el mismo puerto aunque esté libre', async () => {
      await guardar('blog', { nombre: 'Web', comando: 'astro dev', puerto: 4018 })
      const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4019 })
      almacen.forzar('tienda', (l) => l.map((c) => ({ ...c, puerto: 4018 }))) // como si se hubiera editado a mano
      const r = await s.revisar('tienda')
      expect(r).toEqual([expect.objectContaining({ comandoId: a.id, tipo: 'configurado-en-otro', bloquea: false, proyectoNombre: 'Blog', otroComando: 'Web', puedeLiberar: false })])
    })
  })

  it('no lanza dos veces el mismo comando ni dos tandas a la vez', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a', esperar: 'tiempo', esperaMs: 150 })
    expect(await s.arrancar('tienda')).toMatchObject({ ok: true })
    expect(await s.arrancar('tienda')).toMatchObject({ ok: false, mensaje: expect.stringContaining('en curso') })
    await esperar(() => estadoDe('tienda', a.id) === 'listo')
    await pausa(20)
    expect(await s.arrancar('tienda')).toMatchObject({ ok: true })
    await esperar(() => historia(a.id).filter((x) => x === 'listo').length === 2)
    expect(term.creadas).toHaveLength(1) // ya estaba en marcha: no se abre otra terminal
    expect(s.estadosDe('tienda')[0]!.mensaje).toBe('Ya estaba en marcha')
  })

  it('un comando que terminó (o falló) se relanza en una terminal nueva y cierra la vieja', async () => {
    const a = await guardar('tienda', { nombre: 'Migrar', comando: 'pnpm migrate', esperar: 'nada' })
    await s.arrancar('tienda')
    await esperar(() => estadoDe('tienda', a.id) === 'listo')
    term.enShellDe.add('pty1') // el comando acabó y el shell espera
    await esperar(() => estadoDe('tienda', a.id) === 'detenido')
    expect(s.estadosDe('tienda')[0]!.mensaje).toBe('El comando terminó')
    await s.arrancar('tienda')
    await esperar(() => term.creadas.length === 2)
    await esperar(() => estadoDe('tienda', a.id) === 'listo')
    expect(term.cerradas).toEqual(['pty1'])
    expect(estados.some((e) => e.estado === 'detenido' && e.ptyId === 'pty1')).toBe(true) // la interfaz quita la celda vieja
  })

  it('«siempre»: autoarrancar lanza solo los marcados y no repite los que ya corren', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a', siempre: true })
    const b = await guardar('tienda', { nombre: 'B', comando: 'b', siempre: false })
    const c = await guardar('tienda', { nombre: 'C', comando: 'c', siempre: true })
    expect(await s.autoarrancar('tienda')).toEqual({ ok: true, comandos: 2 })
    await esperar(() => estadoDe('tienda', c.id) === 'listo')
    expect(estadoDe('tienda', a.id)).toBe('listo')
    expect(s.estadosDe('tienda').some((e) => e.comandoId === b.id)).toBe(false)
    expect(term.creadas).toHaveLength(2)
    await pausa(20)
    await s.autoarrancar('tienda') // al volver a abrir el proyecto
    await esperar(() => s.estadosDe('tienda').every((e) => e.mensaje === 'Ya estaba en marcha'))
    expect(term.creadas).toHaveLength(2)
    expect(await s.autoarrancar('blog')).toEqual({ ok: true, comandos: 0 })
  })

  it('autoarrancar no cierra procesos ajenos aunque choquen: da error', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a', puerto: 4020, siempre: true })
    abiertos.add(4020)
    duenos.set(4020, { pid: 4242, ancestros: [], cwd: '/otro' })
    await s.autoarrancar('tienda')
    await esperar(() => estadoDe('tienda', a.id) === 'error')
    expect(cerrados).toEqual([])
  })

  it('detener cierra las terminales y cancela lo que faltaba por lanzar', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a', esperar: 'texto', textoListo: 'listo' })
    const b = await guardar('tienda', { nombre: 'B', comando: 'b' })
    await s.arrancar('tienda')
    await esperar(() => term.creadas.length === 1)
    const r = s.detener('tienda')
    expect(term.cerradas).toEqual(['pty1'])
    expect(r.find((e) => e.comandoId === a.id)).toMatchObject({ estado: 'detenido', ptyId: 'pty1' })
    expect(r.find((e) => e.comandoId === b.id)?.estado).toBe('omitido')
    await pausa(60)
    expect(term.creadas).toHaveLength(1) // B no llegó a lanzarse
    expect(estadoDe('tienda', a.id)).toBe('detenido') // la espera cancelada no lo pisa con «error»
  })

  it('detener uno suelto solo cierra ese', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a' })
    const b = await guardar('tienda', { nombre: 'B', comando: 'b' })
    await s.arrancar('tienda')
    await esperar(() => estadoDe('tienda', b.id) === 'listo')
    s.detener('tienda', [a.id])
    expect(term.cerradas).toEqual(['pty1'])
    expect(estadoDe('tienda', a.id)).toBe('detenido')
    expect(estadoDe('tienda', b.id)).toBe('listo')
  })

  it('si el usuario cierra la terminal, el comando pasa a detenido; si pasa mientras arrancaba, es error', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a' })
    const b = await guardar('tienda', { nombre: 'B', comando: 'b', esperar: 'texto', textoListo: 'listo' })
    await s.arrancar('tienda')
    await esperar(() => term.creadas.length === 2)
    s.alSalir('pty1')
    expect(estadoDe('tienda', a.id)).toBe('detenido')
    s.alSalir('pty2')
    await esperar(() => estadoDe('tienda', b.id) === 'error')
    expect(s.estadosDe('tienda').find((e) => e.comandoId === b.id)!.mensaje).toContain('terminal se cerró')
    s.alSalir('pty99') // desconocida: no hace nada
    expect(term.cerradas).toEqual([]) // alSalir no vuelve a matar nada
  })

  it('eliminar un comando en marcha lo detiene y lo quita de la lista', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a' })
    await guardar('tienda', { nombre: 'B', comando: 'b' })
    await s.arrancar('tienda', { ids: [a.id] })
    await esperar(() => estadoDe('tienda', a.id) === 'listo')
    const lista = await s.eliminar('tienda', a.id)
    expect(lista.map((c) => [c.nombre, c.orden])).toEqual([['B', 0]])
    expect(term.cerradas).toEqual(['pty1'])
    expect(s.estadosDe('tienda')).toEqual([])
  })

  it('mover cambia el orden de arranque', async () => {
    await guardar('tienda', { nombre: 'A', comando: 'a' })
    const b = await guardar('tienda', { nombre: 'B', comando: 'b' })
    await s.mover('tienda', b.id, 0)
    await s.arrancar('tienda')
    await esperar(() => term.creadas.length === 2)
    expect(term.escrito.get('pty1')).toEqual(['b\r'])
    expect(term.escrito.get('pty2')).toEqual(['a\r'])
  })

  it('carpeta que no existe o proyecto desconocido: error claro', async () => {
    const a = await guardar('tienda', { nombre: 'A', comando: 'a', cwd: 'no-existe' })
    await s.arrancar('tienda')
    await esperar(() => estadoDe('tienda', a.id) === 'error')
    expect(s.estadosDe('tienda')[0]!.mensaje).toContain('«no-existe» no existe')
    expect(await s.arrancar('fantasma')).toMatchObject({ ok: false, mensaje: expect.stringContaining('no está en este equipo') })
    expect(await s.arrancar('blog')).toMatchObject({ ok: false, mensaje: expect.stringContaining('No hay comandos') })
  })

  it('el canal valida lo que llega de la interfaz', async () => {
    const op = (o: string, e: unknown): Promise<unknown> => ejecutarOperacionArranque(s, o as never, e as never)
    await expect(op('listar', { proyectoId: '../x' })).rejects.toThrow('proyecto no válido')
    await expect(op('listar', {})).rejects.toThrow('proyecto no válido')
    await expect(op('nada', { proyectoId: 'tienda' })).rejects.toThrow('operación desconocida')
    expect(await op('guardar', { proyectoId: 'tienda', comando: { nombre: 'A', comando: 'a' } })).toMatchObject({ ok: true })
    expect(await op('guardar', { proyectoId: 'tienda', comando: { nombre: 'A', comando: 'otro' } })).toMatchObject({ ok: false })
    expect(await op('estados', {})).toEqual([])
    // resoluciones basura se ignoran: no se puede colar «liberar» con otros valores
    const a = (await s.listar('tienda'))[0]!
    abiertos.add(4030)
    almacen.forzar('tienda', (l) => l.map((c) => ({ ...c, puerto: 4030 })))
    duenos.set(4030, { pid: 31337, ancestros: [], cwd: '/otro' })
    await op('arrancar', { proyectoId: 'tienda', resoluciones: { [a.id]: 'matar-todo' } })
    await esperar(() => estadoDe('tienda', a.id) === 'error')
    expect(cerrados).toEqual([])
  })
})
