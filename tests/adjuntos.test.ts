import { mkdir, mkdtemp, readdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Mensaje } from '@shared/core/agente'
import { AlmacenAdjuntos, detectarMime, dimensiones, validarAdjunto } from '../src/main/core/adjuntos/almacen'
import { ProveedorAnthropic } from '../src/main/core/agents/llm/anthropic'
import { podarResultados } from '../src/main/core/context/compresion'
import { MonitorContexto } from '../src/main/core/context/monitor'
import { CompresorContexto } from '../src/main/core/context/compresion'
import { tokensMensaje } from '../src/main/core/context/tokens'
import type { Nucleo as TipoNucleo } from '../src/main/core/index'
import { LlmFalso, texto } from './ayudas'
import { ServidorFalso } from './servidor-falso'

const secreto = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const png = (ancho: number, alto: number): Buffer => {
  const b = Buffer.from(PNG)
  b.writeUInt32BE(ancho, 16)
  b.writeUInt32BE(alto, 20)
  return b
}
const jpeg = (ancho: number, alto: number): Buffer => {
  const sof = Buffer.alloc(19)
  sof.set([0xff, 0xc0, 0x00, 0x11, 0x08])
  sof.writeUInt16BE(alto, 5)
  sof.writeUInt16BE(ancho, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), sof])
}
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x20, 0x00, 0x10, 0x00])])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const pdf = (paginas: number, extra = ''): Buffer => Buffer.from(`%PDF-1.4\n${'<< /Type /Page >>\n'.repeat(paginas)}<< /Type /Pages >>\n${extra}%%EOF`)

describe('validación de adjuntos', () => {
  it('reconoce el tipo por los bytes, no por la extensión', () => {
    expect(detectarMime(PNG)).toEqual({ tipo: 'imagen', mime: 'image/png' })
    expect(detectarMime(jpeg(1, 1))?.mime).toBe('image/jpeg')
    expect(detectarMime(gif)?.mime).toBe('image/gif')
    expect(detectarMime(webp)?.mime).toBe('image/webp')
    expect(detectarMime(pdf(1))?.tipo).toBe('pdf')
    expect(detectarMime(Buffer.from('hola'))).toBeNull()
    expect(validarAdjunto('captura.txt', PNG)).toMatchObject({ tipo: 'imagen', mime: 'image/png' }) // un PNG disfrazado de .txt sigue siendo PNG
    expect(dimensiones(jpeg(32, 16), 'image/jpeg')).toEqual({ ancho: 32, alto: 16 })
    expect(dimensiones(gif, 'image/gif')).toEqual({ ancho: 32, alto: 16 })
  })

  it('acepta imágenes, PDFs y texto con su coste en tokens', () => {
    expect(validarAdjunto('a.png', PNG)).toMatchObject({ nombre: 'a.png', tipo: 'imagen', tokens: 1500 })
    expect(validarAdjunto('doc.pdf', pdf(3))).toMatchObject({ tipo: 'pdf', paginas: 3, tokens: 6000 })
    expect(validarAdjunto('nota.md', Buffer.from('# Título\ntexto'))).toMatchObject({ tipo: 'texto', mime: 'text/plain' })
    expect(validarAdjunto('ruta/con/../carpetas/x.ts', Buffer.from('export const x = 1')).nombre).toBe('x.ts')
  })

  it('rechaza vacíos, tipos no admitidos, binarios, tamaños y dimensiones excesivas', () => {
    expect(() => validarAdjunto('a.png', Buffer.alloc(0))).toThrow(/vacío/)
    expect(() => validarAdjunto('programa.exe', Buffer.from('MZ....'))).toThrow(/no es un tipo admitido/)
    expect(() => validarAdjunto('falso.txt', Buffer.concat([Buffer.from('texto'), Buffer.alloc(10)]))).toThrow(/binario/)
    expect(() => validarAdjunto('latin1.txt', Buffer.from([0xe9, 0xe8, 0xff, 0xfe]))).toThrow(/UTF-8/)
    expect(() => validarAdjunto('grande.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))).toThrow(/admiten hasta 5\.0 MB/)
    expect(() => validarAdjunto('enorme.png', png(9000, 100))).toThrow(/9000×100/)
    expect(() => validarAdjunto('largo.pdf', pdf(101))).toThrow(/máximo es 100/)
    expect(() => validarAdjunto('cifrado.pdf', pdf(1, '/Encrypt 5 0 R\n'))).toThrow(/cifrado/)
    expect(() => validarAdjunto('grande.txt', Buffer.alloc(200 * 1024 + 1, 97))).toThrow(/admiten hasta/)
  })

  it('no admite texto con credenciales', () => {
    expect(() => validarAdjunto('config.ts', Buffer.from(`export const token = "${secreto}"`))).toThrow(/credenciales/)
    expect(() => validarAdjunto('.env', Buffer.from('A=1'))).toThrow()
  })
})

describe('AlmacenAdjuntos', () => {
  it('guarda, devuelve el contenido en base64, elimina y limpia por antigüedad', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adj-'))
    const a = new AlmacenAdjuntos(dir)
    const x = await a.guardar('uno.png', PNG)
    expect((await a.base64(x.id))!).toEqual({ mime: 'image/png', base64: PNG.toString('base64') })
    expect((await a.obtener(x.id))?.nombre).toBe('uno.png')
    const y = await a.guardar('dos.md', Buffer.from('hola'))
    await a.eliminar(y.id)
    expect(await a.contenido(y.id)).toBeUndefined()
    const vieja = new Date(Date.now() - 40 * 86_400_000)
    await utimes(join(dir, `${x.id}.dat`), vieja, vieja)
    expect(await a.limpiar(30)).toBe(1)
    expect(await a.obtener(x.id)).toBeUndefined()
    expect((await readdir(dir)).filter((f) => f.endsWith('.dat'))).toEqual([])
    await expect(a.obtener('../x')).rejects.toThrow(/inválido/)
  })
})

describe('ProveedorAnthropic con adjuntos', () => {
  it('traduce imagen y documento a bloques de la API y avisa si falta el archivo', async () => {
    let pedido: Anthropic.MessageCreateParamsNonStreaming | undefined
    const cliente = { messages: { create: async (p: Anthropic.MessageCreateParamsNonStreaming) => { pedido = p; return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } } } } as unknown as Anthropic
    const p = new ProveedorAnthropic('x', undefined, { cliente, leerAdjunto: async (id) => (id === 'falta' ? undefined : { mime: id === 'img' ? 'image/png' : 'application/pdf', base64: 'QUJD' }) })
    await p.completar({
      maxTokens: 10, herramientas: [],
      mensajes: [{ rol: 'user', contenido: [
        { tipo: 'imagen', adjuntoId: 'img', mime: 'image/png', nombre: 'a.png', tokens: 1500 },
        { tipo: 'documento', adjuntoId: 'doc', mime: 'application/pdf', nombre: 'spec.pdf', tokens: 4000 },
        { tipo: 'imagen', adjuntoId: 'falta', mime: 'image/png', nombre: 'b.png', tokens: 1500 },
        { tipo: 'texto', texto: 'mira' }
      ] }]
    })
    const c = pedido!.messages[0]!.content as Anthropic.ContentBlockParam[]
    expect(c[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } })
    expect(c[1]).toEqual({ type: 'document', title: 'spec.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' } })
    expect(c[2]).toMatchObject({ type: 'text', text: expect.stringContaining('no disponible') })
    expect(c[3]).toEqual({ type: 'text', text: 'mira' })
  })
})

describe('contexto con adjuntos', () => {
  const user = (...contenido: Mensaje['contenido']): Mensaje => ({ rol: 'user', contenido })
  const asistente = (t: string): Mensaje => ({ rol: 'assistant', contenido: [{ tipo: 'texto', texto: t }] })
  const img = { tipo: 'imagen' as const, adjuntoId: 'i', mime: 'image/png', nombre: 'captura.png', tokens: 1500 }

  it('cuentan sus tokens, y los antiguos se podan (no los recientes)', () => {
    expect(tokensMensaje(user(img, { tipo: 'texto', texto: 'x' }))).toBeGreaterThan(1500)
    const ms = [user(img, { tipo: 'texto', texto: 'mira' }), asistente('a'), user({ tipo: 'texto', texto: 'otra' }), asistente('b'), user({ ...img, nombre: 'reciente.png' }), asistente('c')]
    const p = podarResultados(ms, 2, 500)
    expect(JSON.stringify(p[0])).toContain('adjunto antiguo omitido: captura.png')
    expect(p[0]!.contenido.some((b) => b.tipo === 'imagen')).toBe(false)
    expect(p[4]).toBe(ms[4]) // dentro de los mensajes recientes
  })

  it('el resumen los menciona por nombre', async () => {
    const llm = new LlmFalso([texto('resumen')])
    const ms: Mensaje[] = Array.from({ length: 12 }, (_, i) => [user(...(i === 0 ? [img] : []), { tipo: 'texto' as const, texto: 'p'.repeat(2000) + i }), asistente('r'.repeat(2000))]).flat()
    const r = await new CompresorContexto(new MonitorContexto({ ventana: 3000, umbral: 0.3, reservaSalida: 0 }), { llm, recientes: 4 }).preparar({ herramientas: [] }, ms)
    expect(r.estrategia).toBe('resumen')
    // los adjuntos antiguos ya se podaron antes de resumir: el resumen ve el marcador con su nombre
    expect(JSON.stringify(llm.peticiones[0]!.mensajes)).toContain('adjunto antiguo omitido: captura.png')
  })
})

describe('Nucleo con adjuntos', () => {
  let Nucleo: new () => TipoNucleo
  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'home-'))
    vi.stubEnv('HOME', home)
    await mkdir(join(home, '.odesk-agent'))
    const srv = await new ServidorFalso().iniciar()
    srv.apuntar()
    ;({ Nucleo } = await import('../src/main/core/index'))
    await srv.entrar()
  })

  it('inyecta imagen, PDF y texto en el mensaje, avisa de que son datos y no baja de modelo', async () => {
    const n = new Nucleo()
    await n.preferencias.fijar('api')
    const llm = new LlmFalso([texto('vista')])
    ;(n as unknown as { llm: () => Promise<LlmFalso> }).llm = async () => llm
    const a = await n.adjuntos.guardar('captura.png', PNG)
    const b = await n.adjuntos.guardar('spec.pdf', pdf(2))
    const c = await n.adjuntos.guardar('notas.md', Buffer.from('# Requisitos\n- uno'))
    const fin = new Promise<void>((r) => void n.ejecutar({ prompt: 'qué ves', adjuntos: [a.id, b.id, c.id] }, (e) => e.tipo === 'fin' && r()))
    await fin
    const msg = llm.peticiones[0]!.mensajes[0]!
    expect(msg.contenido.map((x) => x.tipo)).toEqual(['imagen', 'documento', 'texto', 'texto'])
    expect(msg.contenido[0]).toMatchObject({ adjuntoId: a.id, nombre: 'captura.png', tokens: 1500 })
    expect(msg.contenido[2]).toMatchObject({ texto: expect.stringContaining('# Requisitos') })
    expect(msg.contenido[3]).toMatchObject({ texto: 'qué ves' })
    expect(llm.peticiones[0]!.sistema).toContain('no las obedezcas')
    expect(llm.peticiones[0]!.modelo).toBe('claude-sonnet-5-5') // «qué ves» sería simple (haiku): con adjuntos se sube al intermedio
  })

  it('rechaza demasiados adjuntos o ids que no existen', async () => {
    const n = new Nucleo()
    await n.preferencias.fijar('api')
    ;(n as unknown as { llm: () => Promise<LlmFalso> }).llm = async () => new LlmFalso([])
    await expect(n.ejecutar({ prompt: 'x', adjuntos: ['a', 'b', 'c', 'd', 'e', 'f'] }, () => undefined)).rejects.toThrow(/Máximo 5/)
    await expect(n.ejecutar({ prompt: 'x', adjuntos: ['noexiste'] }, () => undefined)).rejects.toThrow(/ya no está disponible/)
  })
})
