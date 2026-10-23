import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { analizarLsof, analizarNetstat, analizarSs, ancestrosDe, cerrarProceso, cwdDe, duenoDePuerto, procesoEnPuerto, puertoAbierto, type Ejecutar } from '../src/main/puertos'

describe('puertos: lectura de la salida de ss / lsof / netstat', () => {
  it('ss (Linux)', () => {
    const linea = 'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=12345,fd=21),("node",pid=12346,fd=21))'
    expect(analizarSs(linea)).toEqual({ pid: 12345, proceso: 'node' })
    expect(analizarSs('LISTEN 0 4096 *:5432 *:*')).toBeUndefined() // sin permiso para ver el proceso
    expect(analizarSs('')).toBeUndefined()
  })
  it('lsof -Fpc', () => {
    expect(analizarLsof('p4321\ncnode\nf21\n')).toEqual({ pid: 4321, proceso: 'node' })
    expect(analizarLsof('p77\n')).toEqual({ pid: 77 })
    expect(analizarLsof('')).toBeUndefined()
  })
  it('netstat (Windows)', () => {
    const t = '  Proto  Local Address  Foreign Address  State  PID\r\n  TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   4321\r\n  TCP    [::]:5173   [::]:0   LISTENING   99\r\n  TCP   127.0.0.1:30001  1.1.1.1:443  ESTABLISHED  5\r\n'
    expect(analizarNetstat(t, 3000)).toEqual({ pid: 4321 })
    expect(analizarNetstat(t, 5173)).toEqual({ pid: 99 })
    expect(analizarNetstat(t, 30001)).toBeUndefined()
    expect(analizarNetstat(t, 80)).toBeUndefined()
  })
  it('usa ss y, si no existe o no ve nada, lsof', async () => {
    const llamadas: string[] = []
    const ej: Ejecutar = async (prog) => {
      llamadas.push(prog)
      if (prog === 'ss') throw new Error('ENOENT')
      return 'p10\ncpython\n'
    }
    if (process.platform !== 'win32') {
      expect(await procesoEnPuerto(3000, ej)).toEqual({ pid: 10, proceso: 'python' })
      expect(llamadas).toEqual(['ss', 'lsof'])
    }
  })
})

describe.skipIf(process.platform === 'win32')('puertos: con procesos de verdad', () => {
  const abiertos: Server[] = []
  afterEach(() => {
    for (const s of abiertos.splice(0)) s.close()
  })
  const escuchar = (): Promise<{ s: Server; puerto: number }> =>
    new Promise((resolver) => {
      const s = createServer()
      abiertos.push(s)
      s.listen(0, '127.0.0.1', () => resolver({ s, puerto: (s.address() as { port: number }).port }))
    })

  it('puertoAbierto y duenoDePuerto encuentran este proceso, su carpeta y sus padres', async () => {
    const { s, puerto } = await escuchar()
    expect(await puertoAbierto(puerto)).toBe(true)
    const d = await duenoDePuerto(puerto)
    expect(d?.pid).toBe(process.pid)
    expect(d?.cwd).toBe(process.cwd())
    expect(d?.ancestros).toContain(process.ppid)
    await new Promise((r) => s.close(r))
    expect(await puertoAbierto(puerto)).toBe(false)
    expect(await duenoDePuerto(puerto)).toBeUndefined()
  })

  it('ancestrosDe y cwdDe', async () => {
    const a = await ancestrosDe(process.pid)
    expect(a[0]).toBe(process.ppid)
    expect(await cwdDe(process.pid)).toBe(process.cwd())
    expect(await ancestrosDe(999_999_999)).toEqual([])
  })

  it('cerrarProceso cierra un proceso hijo que ocupa un puerto, y no toca el propio ni pids no válidos', async () => {
    const hijo = spawn(process.execPath, ['-e', "require('net').createServer().listen(0,'127.0.0.1',()=>console.log(this.address?.()?.port??'listo'));setInterval(()=>{},1000)"], { stdio: 'ignore' })
    const pid = hijo.pid!
    await new Promise((r) => setTimeout(r, 400))
    expect(await cerrarProceso(pid, 2000)).toBe(true)
    expect(await cerrarProceso(process.pid)).toBe(false)
    expect(await cerrarProceso(1)).toBe(false)
    expect(await cerrarProceso(-5)).toBe(false)
  })
})
