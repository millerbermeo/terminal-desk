import { describe, expect, it } from 'vitest'
import { AVISO_RUTA_INICIAL, entradaParaCli, esComandoSlash } from '../src/shared/core/comandos'

describe('comando «/» o ruta', () => {
  it('reconoce comandos con y sin argumentos', () => {
    for (const t of ['/plan', '/plan una función', '/explicar /home/dev/app/src/a.ts', '/compact', '/modo autonomo', '  /ayuda', '/mi-comando_2\nmás texto']) expect(esComandoSlash(t)).toBe(true)
  })

  it('una ruta al principio NO es un comando (aunque tenga espacios)', () => {
    for (const t of ['/home/dev/dev/envios web page/mobile_enviosw/assets', '/home/dev/dev/envios web page/mobile_enviosw/assets revisa esto', '/etc/hosts', '/tmp/', '/home/', '/.env', '/src/a.ts tiene un error', '/~algo', '//comentario', '/']) {
      expect(esComandoSlash(t)).toBe(false)
    }
  })

  it('al CLI: la ruta inicial lleva un aviso delante; los comandos y el texto normal van tal cual', () => {
    const ruta = '/home/dev/dev/envios web page/mobile_enviosw/assets'
    expect(entradaParaCli(ruta)).toBe(`${AVISO_RUTA_INICIAL}\n${ruta}`)
    expect(entradaParaCli(ruta).startsWith('/')).toBe(false)
    expect(entradaParaCli('/compact')).toBe('/compact')
    expect(entradaParaCli('hola')).toBe('hola')
    expect(entradaParaCli(ruta, 'contexto')).toBe(`contexto\n\n${ruta}`)
  })
})
