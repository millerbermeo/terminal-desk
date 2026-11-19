import { appendFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clasificarFallo, diagnosticar, informeMarkdown, resumir, type EntradaTurno } from '../src/shared/bitacora-asistente'
import { BitacoraAsistente } from '../src/main/core/uso/bitacora'
import { diaLocal } from '../src/main/core/uso/medidor'

const turno = (o: Partial<EntradaTurno> = {}): EntradaTurno => ({ tipo: 'turno', ts: Date.now(), conversacion: 'c', mensaje: 'hola', mensajeChars: 4, respuestaChars: 10, modelo: 'claude-sonnet-5-5', estado: 'completado', entrada: 40_000, salida: 800, cacheLeida: 38_000, costo: 0.05, contexto: 40_000, pasos: 4, herramientas: 3, duracionMs: 9000, reanudada: true, ...o })

describe('análisis de consumo', () => {
  it('conversación sana: consumo normal', () => {
    const h = diagnosticar(Array.from({ length: 6 }, () => turno()))
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ gravedad: 'ok', titulo: 'Consumo normal' })
  })

  it('contexto enorme, caché fría y mensajes pesados se señalan', () => {
    const malos = Array.from({ length: 6 }, () => turno({ entrada: 180_000, cacheLeida: 20_000, contexto: 150_000, pasos: 30 }))
    const titulos = diagnosticar(malos).map((x) => x.titulo)
    expect(titulos.some((t) => /Contexto muy grande/.test(t))).toBe(true)
    expect(titulos.some((t) => /caché casi no se aprovecha/.test(t))).toBe(true)
    expect(titulos.some((t) => /sin caché/.test(t))).toBe(true)
    expect(titulos.some((t) => /Muchos pasos/.test(t))).toBe(true)
  })

  it('resumen y sin datos', () => {
    expect(diagnosticar([])[0]!.titulo).toBe('Sin datos todavía')
    const r = resumir([turno({ entrada: 100, cacheLeida: 50, salida: 10 }), turno({ entrada: 100, cacheLeida: 100, salida: 30 })])
    expect(r).toMatchObject({ turnos: 2, entrada: 200, salida: 40, aciertoCache: 0.75 })
  })

  it('clasifica los fallos', () => {
    expect(clasificarFallo('Claude AI usage limit reached|1731')).toBe('limite')
    expect(clasificarFallo('Not logged in · Please run /login')).toBe('sesion')
    expect(clasificarFallo('Prompt is too long')).toBe('contexto')
    expect(clasificarFallo('fetch failed ECONNRESET')).toBe('red')
    expect(clasificarFallo('algo raro')).toBe('otro')
  })

  it('el informe no trae el contenido, solo tamaños y un recorte', () => {
    const md = informeMarkdown([turno(), { tipo: 'fallo', ts: Date.now(), conversacion: 'c', mensaje: 'x', error: 'boom', causa: 'otro', duracionMs: 1 }], 'Hoy')
    expect(md).toContain('# Registro del Asistente · Hoy')
    expect(md).toContain('## Fallos')
  })
})

describe('BitacoraAsistente', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bitacora-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('guarda por día, lee lo reciente y saneas secretos y rutas personales', async () => {
    const b = new BitacoraAsistente(dir, '/home/miller')
    b.anotar(turno({ mensaje: 'usa la clave sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 en /home/miller/app' }))
    b.anotar({ tipo: 'fallo', ts: Date.now(), conversacion: 'c', mensaje: 'x', error: 'ENOENT /home/miller/dev/x', causa: 'otro', duracionMs: 5 })
    const lista = await b.leer(1)
    expect(lista).toHaveLength(2)
    const texto = JSON.stringify(lista)
    expect(texto).not.toContain('sk-ant-api03-ABCDEFGH')
    expect(texto).not.toContain('/home/miller')
    expect((await readdir(dir)).filter((f) => f.endsWith('.jsonl'))).toHaveLength(1)
  })

  it('ignora líneas rotas y borra archivos de más de 30 días', async () => {
    await writeFile(join(dir, '2000-01-01.jsonl'), JSON.stringify(turno({ ts: 946684800000 })) + '\n')
    const b = new BitacoraAsistente(dir)
    b.anotar(turno())
    await b.leer(1) // espera a que termine de escribir
    await appendFile(join(dir, `${diaLocal()}.jsonl`), '{roto\n')
    expect(await b.leer(30)).toHaveLength(1) // la línea rota no estorba
    expect((await readdir(dir)).includes('2000-01-01.jsonl')).toBe(false)
  })
})
