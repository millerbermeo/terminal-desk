import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/proyectos', () => ({ DIR: '/nonexistent' }))
import { archivosGuardia, pluginGuardia } from '../src/main/guardia'

describe('plugin de guardia de consumo', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ''
    delete process.env.ODESK_SIN_GUARDIA
  })

  const ejecutar = (script: string, evento: unknown, env: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [script], { input: typeof evento === 'string' ? evento : JSON.stringify(evento), env: { ...process.env, ...env }, encoding: 'utf8' })
    return { codigo: r.status, salida: r.stdout.trim() ? (JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string; updatedInput?: { file_path: string } } }) : undefined }
  }

  it('genera un plugin inmutable y reutilizable con el gancho de Read', async () => {
    dir = await mkdtemp(join(tmpdir(), 'guardia-'))
    const a = await pluginGuardia(dir)
    const b = await pluginGuardia(dir)
    expect(a).toBeDefined()
    expect(b).toBe(a)
    const hooks = JSON.parse(await readFile(join(a!, 'hooks', 'hooks.json'), 'utf8'))
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('Read')
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toContain('imagenes.cjs')
    expect((await stat(join(a!, '.claude-plugin', 'plugin.json'))).isFile()).toBe(true)
    expect(Object.keys(archivosGuardia())).toContain('hooks/imagenes.cjs')
  })

  it('ODESK_SIN_GUARDIA=1 lo apaga', async () => {
    dir = await mkdtemp(join(tmpdir(), 'guardia-'))
    process.env.ODESK_SIN_GUARDIA = '1'
    expect(await pluginGuardia(dir)).toBeUndefined()
  })

  it('el gancho deja pasar lo que no es una imagen y no falla con basura', async () => {
    dir = await mkdtemp(join(tmpdir(), 'guardia-'))
    const a = (await pluginGuardia(dir))!
    const script = join(a, 'hooks', 'imagenes.cjs')
    expect(ejecutar(script, { tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } })).toEqual({ codigo: 0, salida: undefined })
    expect(ejecutar(script, { tool_name: 'Bash', tool_input: { command: 'ls' } })).toEqual({ codigo: 0, salida: undefined })
    expect(ejecutar(script, 'esto no es json')).toEqual({ codigo: 0, salida: undefined })
    expect(ejecutar(script, { tool_name: 'Read', tool_input: { file_path: '/no/existe.png' } })).toEqual({ codigo: 0, salida: undefined })
  })

  it('el gancho limita las imágenes por sesión', async () => {
    dir = await mkdtemp(join(tmpdir(), 'guardia-'))
    const script = join((await pluginGuardia(dir))!, 'hooks', 'imagenes.cjs')
    const png = join(dir, 'pequena.png')
    await writeFile(png, Buffer.from('iVBORw0KGgo=', 'base64')) // pequeña: no se reduce, solo se cuenta
    const sesion = `prueba-${process.pid}-${Date.now()}`
    const ev = { session_id: sesion, tool_name: 'Read', tool_input: { file_path: png } }
    const env = { ODESK_MAX_IMAGENES: '2' }
    expect(ejecutar(script, ev, env).salida).toBeUndefined()
    expect(ejecutar(script, ev, env).salida).toBeUndefined()
    const tercera = ejecutar(script, ev, env)
    expect(tercera.salida?.hookSpecificOutput.permissionDecision).toBe('deny')
    await rm(join(tmpdir(), 'odesk-guardia', `${sesion}.json`), { force: true })
  })

  it('el gancho reduce una imagen grande si hay con qué (si no, la deja pasar o la niega)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'guardia-'))
    const script = join((await pluginGuardia(dir))!, 'hooks', 'imagenes.cjs')
    const hay = spawnSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }).status === 0
    if (!hay) return // sin Pillow/ImageMagick/ffmpeg en esta máquina no hay nada que comprobar
    const png = join(dir, 'grande.png')
    const py = spawnSync('python3', ['-c', `import os,sys\nfrom PIL import Image\nIm=Image.frombytes('RGB',(1200,1200),os.urandom(1200*1200*3))\nIm.save(sys.argv[1])`, png])
    expect(py.status).toBe(0)
    const sesion = `grande-${process.pid}-${Date.now()}`
    const r = ejecutar(script, { session_id: sesion, tool_name: 'Read', tool_input: { file_path: png } })
    expect(r.salida?.hookSpecificOutput.permissionDecision).toBe('allow')
    const reducida = r.salida!.hookSpecificOutput.updatedInput!.file_path
    expect((await stat(reducida)).size).toBeLessThan((await stat(png)).size)
    await rm(reducida, { force: true })
    await rm(join(tmpdir(), 'odesk-guardia', `${sesion}.json`), { force: true })
  })
})
