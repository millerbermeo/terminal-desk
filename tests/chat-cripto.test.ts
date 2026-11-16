import { describe, expect, it } from 'vitest'
import {
  aadMensaje,
  abrirSobre,
  cerrarSobre,
  clavePareja,
  cifrarArchivo,
  descifrarArchivo,
  desenvolverPrivada,
  envolverPrivada,
  generarIdentidad,
  idDeClave,
  leerSobre,
  numeroSeguridad,
  problemaFrase,
  publicaDe
} from '../src/main/chat/e2e/cripto'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CONV = '33333333-3333-4333-8333-333333333333'

describe('cripto del chat', () => {
  it('las dos partes calculan la misma clave de pareja y la pública sale de la privada', () => {
    const a = generarIdentidad()
    const b = generarIdentidad()
    expect(a.claveId).toBe(idDeClave(a.publica))
    expect(publicaDe(a.privada).equals(a.publica)).toBe(true)
    const kab = clavePareja({ usuarioId: A, claveId: a.claveId, privada: a.privada }, { usuarioId: B, claveId: b.claveId, publica: b.publica })
    const kba = clavePareja({ usuarioId: B, claveId: b.claveId, privada: b.privada }, { usuarioId: A, claveId: a.claveId, publica: a.publica })
    expect(kab.equals(kba)).toBe(true)
    // Una clave que no corresponde a su id se rechaza (el servidor no puede colar otra).
    expect(() => clavePareja({ usuarioId: A, claveId: a.claveId, privada: a.privada }, { usuarioId: B, claveId: a.claveId, publica: b.publica })).toThrow('no coincide')
  })

  it('un sobre solo se abre con la misma clave y los mismos datos asociados', () => {
    const a = generarIdentidad()
    const b = generarIdentidad()
    const k = clavePareja({ usuarioId: A, claveId: a.claveId, privada: a.privada }, { usuarioId: B, claveId: b.claveId, publica: b.publica })
    const aad = aadMensaje({ conversacionId: CONV, emisorId: A, clienteId: 'cliente-1', tipo: 'text' })
    const s = cerrarSobre(k, a.claveId, b.claveId, { v: 1, t: 'hola 👋' }, aad)
    expect(s).toMatch(/^e2e1\.[0-9a-f]{32}\.[0-9a-f]{32}\./)
    expect(s).not.toContain('hola')
    // La longitud se redondea (no delata el texto exacto).
    expect(leerSobre(cerrarSobre(k, a.claveId, b.claveId, { v: 1, t: 'a' }, aad)).cifrado.length).toBe(leerSobre(cerrarSobre(k, a.claveId, b.claveId, { v: 1, t: 'ab' }, aad)).cifrado.length)
    expect(abrirSobre(k, leerSobre(s), aad)).toEqual({ v: 1, t: 'hola 👋' })
    // Cambiar el emisor, el id de cliente o el tipo (lo que podría hacer el servidor) rompe el sobre.
    expect(() => abrirSobre(k, leerSobre(s), aadMensaje({ conversacionId: CONV, emisorId: B, clienteId: 'cliente-1', tipo: 'text' }))).toThrow('No se pudo descifrar')
    expect(() => abrirSobre(k, leerSobre(s), aadMensaje({ conversacionId: CONV, emisorId: A, clienteId: 'otro-cliente', tipo: 'text' }))).toThrow('No se pudo descifrar')
    expect(() => abrirSobre(k, leerSobre(s), aadMensaje({ conversacionId: CONV, emisorId: A, clienteId: 'cliente-1', tipo: 'image' }))).toThrow('No se pudo descifrar')
    // Un byte cambiado tampoco pasa.
    const roto = leerSobre(s)
    roto.cifrado[0] ^= 1
    expect(() => abrirSobre(k, roto, aad)).toThrow('No se pudo descifrar')
    // Y un tercero con su propia clave no puede abrirlo.
    const c = generarIdentidad()
    const kc = clavePareja({ usuarioId: A, claveId: c.claveId, privada: c.privada }, { usuarioId: B, claveId: b.claveId, publica: b.publica })
    expect(() => abrirSobre(kc, leerSobre(s), aad)).toThrow('No se pudo descifrar')
  })

  it('archivos: solo se abren con su clave y en su conversación', () => {
    const datos = new Uint8Array([1, 2, 3, 4, 5])
    const { blob, clave } = cifrarArchivo(datos, CONV)
    expect(blob.length).toBe(5 + 28)
    expect([...descifrarArchivo(blob, clave, CONV)]).toEqual([1, 2, 3, 4, 5])
    expect(() => descifrarArchivo(blob, clave, A)).toThrow('No se pudo descifrar')
    expect(() => descifrarArchivo(blob, Buffer.alloc(32), CONV)).toThrow('No se pudo descifrar')
  })

  it('respaldo: la frase correcta abre la privada; otra frase o cuenta no', async () => {
    const a = generarIdentidad()
    expect(problemaFrase('corta')).toMatch(/al menos 12/)
    expect(problemaFrase('aaaaaaaaaaaaaaaa')).toMatch(/simple/)
    await expect(envolverPrivada(a.privada, 'corta', A, a.claveId)).rejects.toThrow('al menos')
    const r = await envolverPrivada(a.privada, 'mi frase de seguridad larga', A, a.claveId)
    expect(r).toMatch(/^r1\.17\.8\.1\./)
    expect((await desenvolverPrivada(r, 'mi frase de seguridad larga', A, a.claveId)).equals(a.privada)).toBe(true)
    await expect(desenvolverPrivada(r, 'otra frase de seguridad', A, a.claveId)).rejects.toThrow('no es correcta')
    await expect(desenvolverPrivada(r, 'mi frase de seguridad larga', B, a.claveId)).rejects.toThrow('no es correcta')
    // Parámetros desorbitados en un respaldo manipulado: no se intenta.
    await expect(desenvolverPrivada(r.replace('r1.17.', 'r1.30.'), 'mi frase de seguridad larga', A, a.claveId)).rejects.toThrow('no es válido')
  }, 20_000)

  it('número de seguridad: 60 cifras, igual desde los dos lados y distinto si cambia una clave', () => {
    const a = generarIdentidad()
    const b = generarIdentidad()
    const n = numeroSeguridad({ usuarioId: A, publica: a.publica }, { usuarioId: B, publica: b.publica })
    expect(n).toMatch(/^\d{60}$/)
    expect(numeroSeguridad({ usuarioId: B, publica: b.publica }, { usuarioId: A, publica: a.publica })).toBe(n)
    expect(numeroSeguridad({ usuarioId: A, publica: a.publica }, { usuarioId: B, publica: generarIdentidad().publica })).not.toBe(n)
  })
})
