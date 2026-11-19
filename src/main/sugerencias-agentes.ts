import { join } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { activosDe } from '@shared/agentes'
import { ARCHIVOS_STACK, sugerirPorStack, tecnologiasDe, type SugerenciaRecurso } from '@shared/sugerencias-agentes'
import { leerBiblioteca } from './agentes'
import { leerProyectos } from './proyectos'

const MAX_BYTES = 200_000
const MAX_CARPETAS = 12

/** Lee los archivos de dependencias de la raíz y de las carpetas de primer nivel (sin ocultas ni `node_modules`) y los agrupa por nombre. */
async function leerArchivosStack(raiz: string): Promise<Record<string, string>> {
  const salida: Record<string, string> = {}
  const leer = async (dir: string): Promise<void> => {
    for (const nombre of ARCHIVOS_STACK) {
      const ruta = join(dir, nombre)
      try {
        const st = await stat(ruta)
        if (!st.isFile() || st.size > MAX_BYTES) continue
        salida[nombre] = `${salida[nombre] ?? ''}\n${await readFile(ruta, 'utf8')}`
      } catch {
        /* no existe o no se puede leer */
      }
    }
  }
  await leer(raiz)
  const hijas = (await readdir(raiz, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'vendor')
    .slice(0, MAX_CARPETAS)
  for (const e of hijas) await leer(join(raiz, e.name))
  return salida
}

/** Agentes y skills compartidos que encajan con el stack del proyecto y aún no están activos en él. */
export async function sugerirRecursos(proyectoId: string): Promise<SugerenciaRecurso[]> {
  const { proyectos } = await leerProyectos()
  const p = proyectos.find((x) => x.id === proyectoId)
  if (!p) return []
  const [biblioteca, contenidos] = await Promise.all([leerBiblioteca(), leerArchivosStack(p.ruta)])
  const yaActivos = new Set(activosDe(biblioteca, p).map((a) => a.recurso.id))
  return sugerirPorStack(biblioteca.recursos, tecnologiasDe(contenidos), yaActivos)
}
