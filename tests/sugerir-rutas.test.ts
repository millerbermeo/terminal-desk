import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sugerirRutas } from '../src/main/proyectos'

it('sugiere solo carpetas que empiezan por lo escrito y oculta las ocultas', async () => {
  const base = await mkdtemp(join(tmpdir(), 'rutas-'))
  for (const d of ['api', 'app-web', 'docs', '.oculta']) await mkdir(join(base, d))
  await writeFile(join(base, 'archivo.txt'), 'x')
  expect(await sugerirRutas(`${base}/a`)).toEqual([join(base, 'api'), join(base, 'app-web')])
  expect(await sugerirRutas(`${base}/`)).toEqual([join(base, 'api'), join(base, 'app-web'), join(base, 'docs')])
  expect(await sugerirRutas(`${base}/.o`)).toEqual([join(base, '.oculta')])
  expect(await sugerirRutas(`${base}/zzz`)).toEqual([])
  expect(await sugerirRutas('')).toEqual([])
})
