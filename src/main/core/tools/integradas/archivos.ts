import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Herramienta } from '../registro'
import { rutaSegura } from './ruta'

const MAX_LECTURA = 200_000

export const leerArchivo: Herramienta = {
  nombre: 'leer_archivo',
  descripcion: 'Lee un archivo de texto del proyecto (ruta relativa a la raíz del proyecto).',
  esquema: { type: 'object', properties: { ruta: { type: 'string', description: 'Ruta relativa' } }, required: ['ruta'] },
  riesgo: 'lectura',
  async ejecutar(entrada, ctx) {
    const ruta = await rutaSegura(ctx.cwd, String(entrada.ruta))
    const texto = await readFile(ruta, 'utf8')
    return { texto: texto.length > MAX_LECTURA ? texto.slice(0, MAX_LECTURA) + '\n[… truncado]' : texto }
  }
}

export const listarDirectorio: Herramienta = {
  nombre: 'listar_directorio',
  descripcion: 'Lista los archivos y carpetas de un directorio del proyecto (las carpetas terminan en «/»).',
  esquema: { type: 'object', properties: { ruta: { type: 'string', description: 'Ruta relativa; «.» = raíz' } } },
  riesgo: 'lectura',
  async ejecutar(entrada, ctx) {
    const ruta = await rutaSegura(ctx.cwd, String(entrada.ruta ?? '.'))
    const items = await readdir(ruta, { withFileTypes: true })
    return { texto: items.map((i) => i.name + (i.isDirectory() ? '/' : '')).sort().join('\n') }
  }
}

export const escribirArchivo: Herramienta = {
  nombre: 'escribir_archivo',
  descripcion: 'Crea o sobrescribe un archivo de texto del proyecto.',
  esquema: {
    type: 'object',
    properties: { ruta: { type: 'string' }, contenido: { type: 'string' } },
    required: ['ruta', 'contenido']
  },
  riesgo: 'escritura',
  async ejecutar(entrada, ctx) {
    const ruta = await rutaSegura(ctx.cwd, String(entrada.ruta))
    await mkdir(dirname(ruta), { recursive: true })
    await writeFile(ruta, String(entrada.contenido), 'utf8')
    return { texto: `Escrito ${String(entrada.ruta)}` }
  }
}
