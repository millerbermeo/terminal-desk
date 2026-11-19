import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { comprobarAhora, exigirConexion, rutaCaida, sondear } from '../src/main/montajes'

let tmp: string
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'montajes-'))
})
afterEach(() => rm(tmp, { recursive: true, force: true }))

describe('carpetas de red caídas', () => {
  it('sondea una carpeta local que responde y una que no existe', async () => {
    expect(await sondear(tmp)).toBe(true)
    expect(await sondear(join(tmp, 'no-existe'))).toBe(false)
  })

  it('una carpeta local pasa sin marcarse como caída', async () => {
    expect(await comprobarAhora(tmp)).toBe(true)
    expect(rutaCaida(tmp)).toBe(false)
    expect(() => exigirConexion(tmp)).not.toThrow()
  })
})
