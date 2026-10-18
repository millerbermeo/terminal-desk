import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HistorialComandos } from '../src/main/historial-comandos'
import { analizarHistorialShell, buscarSugerencia, comandoRegistrable, escritoEnLinea, primeraPalabra, sinRepetidos, terminaEnPrompt } from '../src/shared/sugerencias'

describe('sugerencias de historial: lógica pura', () => {
  it('reconoce el final de un prompt de shell', () => {
    for (const p of ['dev@pc:~/dev$ ', 'root@pc:/# ', 'ana% ', '❯ ', '➜  proyecto ➜ ', '$ ']) expect(terminaEnPrompt(p), p).toBe(true)
    for (const p of ['[sudo] password for dev: ', 'Compiling...', 'dev@pc:~$', 'cuántos? ']) expect(terminaEnPrompt(p), p).toBe(false)
  })

  it('no registra secretos, líneas con espacio inicial, varias líneas ni vacías', () => {
    expect(comandoRegistrable('git status')).toBe(true)
    expect(comandoRegistrable('docker run -p 80:80 nginx')).toBe(true)
    for (const c of ['', '   ', ' ls', 'a\nb', 'export API_KEY=abc', 'curl -H "Authorization: Bearer x" u', 'mysql --password=1', 'git clone https://u:pw@host/r.git', 'x'.repeat(501)]) {
      expect(comandoRegistrable(c), c).toBe(false)
    }
  })

  it('sugiere el más reciente que empieza igual y es más largo', () => {
    const h = ['git commit -m "b"', 'git checkout main', 'git status', 'ls']
    expect(buscarSugerencia(h, 'git c')).toBe('git commit -m "b"')
    expect(buscarSugerencia(h, 'git s')).toBe('git status')
    expect(buscarSugerencia(h, 'git status')).toBeUndefined() // ya está completo
    expect(buscarSugerencia(h, 'Git')).toBeUndefined() // distingue mayúsculas
    expect(buscarSugerencia(h, ' git')).toBeUndefined()
    expect(buscarSugerencia(h, '')).toBeUndefined()
  })

  it('Ctrl+→ acepta una palabra', () => {
    expect(primeraPalabra('mmit -m "x"')).toBe('mmit ')
    expect(primeraPalabra(' status now')).toBe(' status ')
    expect(primeraPalabra('uno')).toBe('uno')
  })

  it('lee lo escrito de la pantalla solo si el cursor está al final de la línea', () => {
    expect(escritoEnLinea({ antesDelCursor: 'dev$ git s', despuesDelCursor: '' }, 5)).toBe('git s')
    expect(escritoEnLinea({ antesDelCursor: 'dev$ git s', despuesDelCursor: '   ' }, 5)).toBe('git s')
    expect(escritoEnLinea({ antesDelCursor: 'dev$ git ', despuesDelCursor: 'status' }, 5)).toBeUndefined() // cursor en medio
    expect(escritoEnLinea({ antesDelCursor: 'dev', despuesDelCursor: '' }, 5)).toBeUndefined() // prompt más corto de lo esperado
  })

  it('quita repetidos conservando el más nuevo', () => {
    expect(sinRepetidos(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
    expect(sinRepetidos(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })

  it('analiza el historial de bash, zsh y fish', () => {
    expect(analizarHistorialShell('#1700000000\nls -la\n#1700000001\ncd /tmp\n')).toEqual(['ls -la', 'cd /tmp'])
    expect(analizarHistorialShell(': 1700000000:0;git status\n: 1700000005:0;echo hola\n')).toEqual(['git status', 'echo hola'])
    expect(analizarHistorialShell('- cmd: npm test\n  when: 1700000000\n- cmd: git push\n  when: 1700000010\n  paths:\n    - a\n')).toEqual(['npm test', 'git push'])
    expect(analizarHistorialShell('echo uno \\\n  dos\nls\nexport TOKEN=abc\n')).toEqual(['ls']) // multilínea y secretos fuera
  })
})

describe('HistorialComandos', () => {
  it('une lo ejecutado en la app (primero) con el historial del shell, sin repetidos y sin secretos', async () => {
    const casa = await mkdtemp(join(tmpdir(), 'hc-casa-'))
    const dir = await mkdtemp(join(tmpdir(), 'hc-dir-'))
    await writeFile(join(casa, '.bash_history'), 'ls\ngit status\nexport SECRET=1\nnpm test\n')
    const archivo = join(dir, 'historial-comandos.json')
    const h = new HistorialComandos(archivo, casa)
    expect(await h.lista()).toEqual(['npm test', 'git status', 'ls'])
    await h.agregar('git status')
    await h.agregar('docker ps')
    await h.agregar(' oculto')
    await h.agregar('echo $TOKEN=abc')
    expect(await h.lista()).toEqual(['docker ps', 'git status', 'npm test', 'ls'])
    expect(JSON.parse(await readFile(archivo, 'utf8'))).toEqual(['docker ps', 'git status']) // solo lo propio se guarda

    const otra = new HistorialComandos(archivo, casa)
    expect((await otra.lista()).slice(0, 2)).toEqual(['docker ps', 'git status'])
  })
})
