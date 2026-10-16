import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { DatosProyectos } from '@shared/modelos'

const DIR = join(homedir(), '.centro-proyectos')
const ARCHIVO = join(DIR, 'proyectos.json')

function ejemplo(): DatosProyectos {
  const home = homedir()
  return {
    grupos: [
      { id: 'personal', nombre: 'Personal' },
      { id: 'trabajo', nombre: 'Trabajo' }
    ],
    proyectos: [
      { id: 'home', nombre: 'Inicio', ruta: home, grupo: 'personal' },
      { id: 'documentos', nombre: 'Documentos', ruta: join(home, 'Documents'), grupo: 'personal' },
      { id: 'dev', nombre: 'Dev', ruta: join(home, 'dev'), grupo: 'trabajo' },
      { id: 'sin-grupo', nombre: 'Sin grupo', ruta: home }
    ]
  }
}

export async function leerProyectos(): Promise<DatosProyectos> {
  try {
    const crudo = JSON.parse(await readFile(ARCHIVO, 'utf8')) as Partial<DatosProyectos>
    return { grupos: crudo.grupos ?? [], proyectos: crudo.proyectos ?? [] }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('proyectos.json inválido:', err)
      return { grupos: [], proyectos: [] }
    }
    const datos = ejemplo()
    await mkdir(DIR, { recursive: true })
    await writeFile(ARCHIVO, JSON.stringify(datos, null, 2) + '\n', 'utf8')
    return datos
  }
}
