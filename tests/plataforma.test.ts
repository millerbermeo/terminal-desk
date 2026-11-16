import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buscarEnPath, destinoDeGuion, escaparArgumentoCmd, lanzar, prepararComando, rutasHabituales } from '../src/main/plataforma'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'odesk-plataforma-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const crear = (rel: string, contenido = ''): string => {
  const ruta = join(dir, rel)
  mkdirSync(join(ruta, '..'), { recursive: true })
  writeFileSync(ruta, contenido)
  return ruta
}

// Guion que deja `npm install -g` (cmd-shim) para un paquete con un .js como binario.
const GUION_NPM_JS = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
`
const GUION_NPM_EXE = `@ECHO off\r\nGOTO start\r\n:start\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`
const GUION_VSCODE = `@echo off\r\nsetlocal\r\nset VSCODE_DEV=\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\Code.exe" "%~dp0..\\resources\\app\\out\\cli.js" --ms-enable-electron-run-as-node %*\r\nIF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%\r\nendlocal\r\n`

describe('buscarEnPath', () => {
  it('en Windows usa PATHEXT y prefiere el ejecutable al guion sin extensión de npm', () => {
    crear('npm/claude', '#!/bin/sh\n')
    const cmd = crear('npm/claude.cmd', GUION_NPM_JS)
    expect(buscarEnPath('claude', { Path: join(dir, 'npm'), PATHEXT: '.COM;.EXE;.BAT;.CMD' }, true)).toBe(cmd)
  })

  it('en Windows respeta el orden de PATHEXT (.exe antes que .cmd)', () => {
    crear('bin/claude.cmd')
    const exe = crear('bin/claude.exe')
    expect(buscarEnPath('claude', { PATH: join(dir, 'bin'), PATHEXT: '.EXE;.CMD' }, true)).toBe(exe)
  })

  it('en Linux/macOS busca el nombre tal cual', () => {
    const ruta = crear('bin/claude')
    expect(buscarEnPath('claude', { PATH: `/no/existe:${join(dir, 'bin')}` }, false)).toBe(ruta)
    expect(buscarEnPath('nada', { PATH: join(dir, 'bin') }, false)).toBeUndefined()
  })
})

describe('destinoDeGuion', () => {
  it('saca el .js o el .exe que envuelve un guion de npm', () => {
    expect(destinoDeGuion('C:\\npm\\claude.cmd', GUION_NPM_JS)).toMatch(/node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js$/)
    expect(destinoDeGuion('C:\\npm\\claude.cmd', GUION_NPM_EXE)).toMatch(/claude\.exe$/)
  })

  it('no toca guiones que no son de un gestor de paquetes (VS Code prepara su entorno)', () => {
    expect(destinoDeGuion('C:\\VSCode\\bin\\code.cmd', GUION_VSCODE)).toBeUndefined()
  })
})

describe('prepararComando', () => {
  it('en Linux/macOS no cambia nada', () => {
    expect(prepararComando('claude', ['-p', 'hola mundo'], {}, false)).toEqual({ archivo: 'claude', args: ['-p', 'hola mundo'], literal: false })
  })

  it('en Windows lanza directamente el .exe de un guion de npm, con los argumentos intactos', () => {
    const exe = crear('npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
    crear('npm/claude.cmd', GUION_NPM_EXE)
    const c = prepararComando('claude', ['--append-system-prompt', 'línea 1\nlínea "2"'], { PATH: join(dir, 'npm'), PATHEXT: '.EXE;.CMD' }, true)
    expect(c.literal).toBe(false)
    expect(c.archivo.toLowerCase()).toBe(exe.toLowerCase())
    expect(c.args).toEqual(['--append-system-prompt', 'línea 1\nlínea "2"'])
  })

  it('en Windows pasa otros .cmd por cmd.exe con cada argumento citado', () => {
    const cmd = crear('bin/pnpm.cmd', '@echo off\r\nnode "%~dp0\\pnpm.cjs" %*\r\n')
    const c = prepararComando('pnpm', ['run', 'mi script & rm'], { PATH: join(dir, 'bin'), PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\cmd.exe' }, true)
    expect(c.archivo).toBe('C:\\Windows\\cmd.exe')
    expect(c.literal).toBe(true)
    expect(c.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(c.args[3]).toContain('^"mi^ script^ ^&^ rm^"')
    expect(c.args[3]).toContain(cmd.replace(/([()\][%!^"`<>&|;, *?])/g, '^$1'))
  })

  it('no deja pasar un salto de línea por cmd.exe', () => {
    crear('bin/otro.bat', '@echo off\r\n')
    expect(() => prepararComando('otro', ['a\nb'], { PATH: join(dir, 'bin'), PATHEXT: '.BAT' }, true)).toThrow(/saltos de línea/)
  })
})

describe('escaparArgumentoCmd', () => {
  it('cita y escapa metacaracteres; dobla el escape para node_modules/.bin', () => {
    expect(escaparArgumentoCmd('a b', false)).toBe('^"a^ b^"')
    expect(escaparArgumentoCmd('di "hola"', false)).toBe('^"di^ \\^"hola\\^"^"')
    expect(escaparArgumentoCmd('x&y', true)).toBe('^^^"x^^^&y^^^"')
  })
})

describe('rutasHabituales', () => {
  it('incluye el instalador oficial y los gestores de paquetes de cada sistema', () => {
    expect(rutasHabituales('claude', false, '/home/ana')).toContain('/home/ana/.local/bin/claude')
    expect(rutasHabituales('claude', false, '/Users/ana')).toContain('/opt/homebrew/bin/claude')
    expect(rutasHabituales('claude', true, 'C:\\Users\\ana').some((r) => r.endsWith('claude.exe'))).toBe(true)
  })
})

describe('lanzar', () => {
  it('ejecuta un programa real y devuelve sus flujos', async () => {
    const hijo = lanzar(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'hola "mundo"\ny más'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let salida = ''
    hijo.stdout.on('data', (d: Buffer) => (salida += d))
    await new Promise((res) => hijo.on('close', res))
    expect(salida).toBe('hola "mundo"\ny más')
  })
})
