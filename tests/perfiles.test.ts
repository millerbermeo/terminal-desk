import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARCHIVO_ACTIVO, cambiarPerfil } from '../src/main/perfiles'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

async function datos(dir: string, quien: string): Promise<void> {
  await mkdir(join(dir, 'tareas'), { recursive: true })
  await writeFile(join(dir, 'tareas', 'tareas.json'), `{"de":"${quien}"}`)
  await mkdir(join(dir, 'conversaciones'), { recursive: true })
  await writeFile(join(dir, 'conversaciones', 'c1.json'), `{"de":"${quien}"}`)
  await writeFile(join(dir, 'rutas.json'), `{"de":"${quien}"}`)
  await writeFile(join(dir, 'github.json'), `{"de":"${quien}"}`)
}
const leer = (ruta: string): Promise<string> => readFile(ruta, 'utf8')

describe('datos locales por cuenta', () => {
  it('la primera cuenta adopta lo que ya había; la misma cuenta no mueve nada', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'perfil-'))
    await datos(dir, 'antes')
    expect(await cambiarPerfil(dir, A)).toBe('adoptado')
    expect(await cambiarPerfil(dir, A)).toBe('igual')
    expect(await leer(join(dir, 'tareas', 'tareas.json'))).toBe('{"de":"antes"}')
  })

  it('otra cuenta no ve nada de la anterior; al volver, cada una recupera lo suyo; lo compartido no se toca', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'perfil-'))
    await datos(dir, 'A')
    await writeFile(join(dir, 'sesion.json'), 'token')
    await writeFile(join(dir, 'servidor.json'), '{"url":"https://x"}')
    await mkdir(join(dir, 'worktrees', 'w1'), { recursive: true })
    await cambiarPerfil(dir, A)

    expect(await cambiarPerfil(dir, B)).toBe('cambiado')
    const visibles = (await readdir(dir)).sort()
    expect(visibles).toEqual([ARCHIVO_ACTIVO, 'perfiles', 'servidor.json', 'sesion.json', 'worktrees'].sort())
    expect(existsSync(join(dir, 'tareas'))).toBe(false)
    await datos(dir, 'B') // B trabaja

    expect(await cambiarPerfil(dir, A)).toBe('cambiado')
    expect(await leer(join(dir, 'tareas', 'tareas.json'))).toBe('{"de":"A"}')
    expect(await leer(join(dir, 'github.json'))).toBe('{"de":"A"}')
    expect(await leer(join(dir, 'sesion.json'))).toBe('token')
    expect(existsSync(join(dir, 'worktrees', 'w1'))).toBe(true)

    expect(await cambiarPerfil(dir, B)).toBe('cambiado')
    expect(await leer(join(dir, 'conversaciones', 'c1.json'))).toBe('{"de":"B"}')
    expect(await leer(join(dir, 'rutas.json'))).toBe('{"de":"B"}')
  })

  it('si un cambio se cortó mientras se recuperaba un perfil, el siguiente acceso lo termina sin mezclar cuentas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'perfil-'))
    await datos(dir, 'A')
    await cambiarPerfil(dir, A)
    await cambiarPerfil(dir, B)
    await datos(dir, 'B')
    await cambiarPerfil(dir, A) // B apartado en perfiles/B
    // Simula un corte: se apartó lo de A y se empezó a recuperar B (solo llegó rutas.json).
    await mkdir(join(dir, 'perfiles', A), { recursive: true })
    for (const n of ['tareas', 'conversaciones', 'github.json']) {
      await import('node:fs/promises').then((f) => f.rename(join(dir, n), join(dir, 'perfiles', A, n)))
    }
    await import('node:fs/promises').then((f) => f.rename(join(dir, 'rutas.json'), join(dir, 'perfiles', A, 'rutas.json')))
    await import('node:fs/promises').then((f) => f.rename(join(dir, 'perfiles', B, 'rutas.json'), join(dir, 'rutas.json')))
    await writeFile(join(dir, ARCHIVO_ACTIVO), JSON.stringify({ usuarioId: null, entrando: B }))

    // Entra A: primero se termina de recuperar B, luego se aparta B y vuelve A completo.
    expect(await cambiarPerfil(dir, A)).toBe('cambiado')
    expect(await leer(join(dir, 'tareas', 'tareas.json'))).toBe('{"de":"A"}')
    expect(await leer(join(dir, 'rutas.json'))).toBe('{"de":"A"}')
    expect(await leer(join(dir, 'perfiles', B, 'rutas.json'))).toBe('{"de":"B"}')
    expect(await leer(join(dir, 'perfiles', B, 'tareas', 'tareas.json'))).toBe('{"de":"B"}')
  })

  it('rechaza ids que podrían salir de la carpeta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'perfil-'))
    await expect(cambiarPerfil(dir, '../fuera')).rejects.toThrow(/no válido/)
  })
})
