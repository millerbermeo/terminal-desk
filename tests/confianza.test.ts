import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { confiarCarpeta } from '../src/main/core/confianza'

describe('confiarCarpeta', () => {
  it('marca la carpeta como confiable en el .claude.json de la cuenta y conserva lo demás', async () => {
    const cuenta = await mkdtemp(join(tmpdir(), 'cuenta-'))
    await writeFile(join(cuenta, '.claude.json'), JSON.stringify({ oauthAccount: { x: 1 }, projects: { '/otro': { hasTrustDialogAccepted: false, a: 1 } } }))
    await confiarCarpeta(cuenta, '/repo/app')
    const d = JSON.parse(await readFile(join(cuenta, '.claude.json'), 'utf8'))
    expect(d.oauthAccount).toEqual({ x: 1 })
    expect(d.projects['/otro']).toEqual({ hasTrustDialogAccepted: false, a: 1 })
    expect(d.projects['/repo/app']).toEqual({ hasTrustDialogAccepted: true })
  })

  it('sin cuenta secundaria, sin archivo o con JSON ilegible no hace nada ni lanza', async () => {
    await expect(confiarCarpeta(undefined, '/repo')).resolves.toBeUndefined()
    const vacia = await mkdtemp(join(tmpdir(), 'cuenta-'))
    await expect(confiarCarpeta(vacia, '/repo')).resolves.toBeUndefined()
    await writeFile(join(vacia, '.claude.json'), '{roto')
    await confiarCarpeta(vacia, '/repo')
    expect(await readFile(join(vacia, '.claude.json'), 'utf8')).toBe('{roto')
  })
})
