import { describe, expect, it } from 'vitest'
import { esDestructiva } from '../src/main/core/guardrails/destructivo'
import { MotorGuardrails } from '../src/main/core/guardrails/motor'
import { rutaProtegidaEscritura, rutaSensible } from '../src/main/core/guardrails/rutas'
import { detectarSecretos } from '../src/main/core/guardrails/secretos'

// Valores de prueba construidos en tiempo de ejecución para no dejar credenciales con forma real en el repo.
const fake = {
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  github: 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  anthropic: 'sk-ant-' + 'api03-abcdefghijklmnopqrstuv',
  clave: '-----BEGIN ' + 'RSA PRIVATE KEY-----'
}

describe('detectarSecretos', () => {
  it('detecta credenciales habituales y no revela el valor completo', () => {
    for (const v of Object.values(fake)) expect(detectarSecretos(`const x = "${v}"`), v).toHaveLength(1)
    const h = detectarSecretos(`linea1\nconst password = "s3cretoSuperLargo"`)
    expect(h).toHaveLength(1)
    expect(h[0]!.linea).toBe(2)
    expect(JSON.stringify(h)).not.toContain('s3cretoSuperLargo')
    expect(detectarSecretos('db: postgres://usuario:clave123@host:5432/app')).toHaveLength(1)
  })
  it('ignora ejemplos y código normal', () => {
    expect(detectarSecretos('const password = process.env.PASSWORD')).toEqual([])
    expect(detectarSecretos('apiKey: "your_api_key_here"')).toEqual([])
    expect(detectarSecretos('DATABASE_URL=postgres://user:<password>@host/db')).toEqual([])
    expect(detectarSecretos('function sumar(a, b) { return a + b }')).toEqual([])
  })
})

describe('rutas', () => {
  it('detecta archivos sensibles (pero no las plantillas)', () => {
    for (const r of ['.env', 'app/.env.local', 'cert.pem', 'id_rsa', '.npmrc', 'home/.ssh/config', '.aws/credentials'])
      expect(rutaSensible(r), r).not.toBeNull()
    for (const r of ['.env.example', 'src/index.ts', 'id_rsa.pub', 'README.md']) expect(rutaSensible(r), r).toBeNull()
  })
  it('protege .git y node_modules de escritura', () => {
    expect(rutaProtegidaEscritura('.git/config')).not.toBeNull()
    expect(rutaProtegidaEscritura('a/node_modules/x.js')).not.toBeNull()
    expect(rutaProtegidaEscritura('src/a.ts')).toBeNull()
  })
})

describe('esDestructiva', () => {
  const cmd = (comando: string, ...args: string[]) => esDestructiva('ejecutar_comando', { comando, args })
  it('marca borrados, git destructivo, red y publicación', () => {
    for (const [c, ...a] of [['rm', '-rf', 'x'], ['git', 'push'], ['git', 'reset', '--hard'], ['git', 'clean', '-fd'], ['git', 'branch', '-D', 'x'], ['/usr/bin/curl', 'http://x'], ['sudo', 'ls'], ['npm', 'publish']] as const)
      expect(cmd(c, ...a), `${c} ${a.join(' ')}`).not.toBeNull()
  })
  it('no marca comandos normales', () => {
    expect(cmd('git', 'status')).toBeNull()
    expect(cmd('git', 'commit', '-m', 'x')).toBeNull()
    expect(cmd('pnpm', 'test')).toBeNull()
    expect(esDestructiva('leer_archivo', {})).toBeNull()
  })
  it('herramientas MCP con nombre destructivo', () => {
    expect(esDestructiva('mcp__db__drop_table', {})).not.toBeNull()
    expect(esDestructiva('mcp__db__select', {})).toBeNull()
  })
})

describe('MotorGuardrails.validarLlamada', () => {
  const m = new MotorGuardrails()
  const v = (nombre: string, entrada: Record<string, unknown>) => m.validarLlamada({ id: '1', nombre, entrada })
  it('bloquea lectura de secretos, escritura con credenciales o JSON inválido', async () => {
    expect(await v('leer_archivo', { ruta: '.env' })).toMatch(/variables de entorno/)
    expect(await v('leer_archivo', { ruta: 'src/a.ts' })).toBeNull()
    expect(await v('escribir_archivo', { ruta: 'src/a.ts', contenido: `const k = "${fake.github}"` })).toMatch(/GitHub/)
    expect(await v('escribir_archivo', { ruta: '.git/hooks/pre-commit', contenido: 'x' })).toMatch(/git/)
    expect(await v('escribir_archivo', { ruta: 'package.json', contenido: '{ roto' })).toMatch(/JSON inválido/)
    expect(await v('escribir_archivo', { ruta: 'tsconfig.json', contenido: '{ // comentario\n}' })).toBeNull()
    expect(await v('escribir_archivo', { ruta: 'src/a.ts', contenido: 'export const a = 1' })).toBeNull()
  })
  it('bloquea comandos que leen secretos, memoria con credenciales y MCP que reciben secretos', async () => {
    expect(await v('ejecutar_comando', { comando: 'cat', args: ['.env'] })).toMatch(/credenciales/)
    expect(await v('ejecutar_comando', { comando: 'git', args: ['status'] })).toBeNull()
    expect(await v('guardar_memoria', { titulo: 't', contenido: `clave ${fake.aws}` })).toMatch(/AWS/)
    expect(await v('mcp__web__enviar', { texto: fake.anthropic })).toMatch(/Anthropic/)
    expect(await v('mcp__web__enviar', { texto: 'hola' })).toBeNull()
  })
  it('revisa texto libre (diff completo)', () => {
    expect(m.revisarTexto(`+const t = "${fake.clave}"`)).toHaveLength(1)
  })
})
