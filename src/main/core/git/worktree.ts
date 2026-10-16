import { randomUUID } from 'node:crypto'
import { readFile, stat, symlink } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute } from 'node:path'
import type { InfoWorktree } from '@shared/core/agente'
import { validarId } from '../memory/almacen'
import { git, gitOk } from './git'

const EXCLUIR_DEPENDENCIAS = [':(exclude)node_modules']
const MAX_ARCHIVO_ESCANEO = 200_000

const slug = (t: string): string =>
  t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'tarea'

export interface CambiosWorktree {
  hayCambios: boolean
  resumen: string // git status --short
  /** Texto de todo lo cambiado (diff + archivos nuevos) para escanear credenciales antes de confirmar. */
  texto: string
}

/**
 * Directorios de trabajo aislados (git worktree + rama propia) para las tareas de los agentes.
 * Viven fuera del repo (`raiz`), así que el agente no puede tocar el árbol de trabajo del usuario.
 */
export class GestorWorktrees {
  constructor(private readonly raiz: string) {}

  async esRepoConCommits(repo: string): Promise<boolean> {
    return (await git(repo, ['rev-parse', '--verify', '--quiet', 'HEAD'])).ok
  }

  async crear(repo: string, proyectoId: string, etiqueta: string): Promise<InfoWorktree> {
    const id = randomUUID().slice(0, 8)
    const rama = `agente/${slug(etiqueta)}-${id}`
    const ruta = join(this.raiz, validarId(proyectoId), id)
    await gitOk(repo, ['worktree', 'add', '-b', rama, ruta, 'HEAD'])
    // Sin node_modules las pruebas no arrancan: se enlazan las dependencias del repo (git las ignora al confirmar).
    const deps = join(repo, 'node_modules')
    if (await stat(deps).then((s) => s.isDirectory(), () => false)) await symlink(deps, join(ruta, 'node_modules'), 'dir').catch(() => undefined)
    return { id, proyectoId, rama, ruta }
  }

  async listar(repo: string, proyectoId: string): Promise<InfoWorktree[]> {
    const base = join(this.raiz, validarId(proyectoId))
    const r = await git(repo, ['worktree', 'list', '--porcelain'])
    if (!r.ok) return []
    const salida: InfoWorktree[] = []
    for (const bloque of r.stdout.split('\n\n')) {
      const ruta = /^worktree (.+)$/m.exec(bloque)?.[1]
      const rama = /^branch refs\/heads\/(.+)$/m.exec(bloque)?.[1]
      if (!ruta || !rama || resolve(ruta, '..') !== base) continue
      salida.push({ id: ruta.slice(base.length + 1), proyectoId, rama, ruta })
    }
    return salida
  }

  async cambios(wt: InfoWorktree): Promise<CambiosWorktree> {
    const resumen = (await gitOk(wt.ruta, ['status', '--short', '--', '.', ...EXCLUIR_DEPENDENCIAS])).trim()
    if (!resumen) return { hayCambios: false, resumen: '', texto: '' }
    const diff = await gitOk(wt.ruta, ['diff', 'HEAD', '--', '.', ...EXCLUIR_DEPENDENCIAS])
    const nuevos = (await gitOk(wt.ruta, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ...EXCLUIR_DEPENDENCIAS])).split('\0').filter(Boolean)
    let texto = diff
    for (const f of nuevos) {
      const contenido = await readFile(join(wt.ruta, f)).then((b) => b.subarray(0, MAX_ARCHIVO_ESCANEO), () => Buffer.alloc(0))
      if (!contenido.includes(0)) texto += `\n+++ ${f} (nuevo)\n${contenido.toString('utf8')}`
    }
    return { hayCambios: true, resumen, texto }
  }

  /** Confirma los cambios en la rama del worktree. Devuelve el hash corto, o null si no había nada. */
  async confirmar(wt: InfoWorktree, mensaje: string): Promise<string | null> {
    await gitOk(wt.ruta, ['add', '-A', '--', '.', ...EXCLUIR_DEPENDENCIAS])
    if ((await git(wt.ruta, ['diff', '--cached', '--quiet'])).ok) return null
    await gitOk(wt.ruta, ['commit', '-m', mensaje.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Cambios del agente'])
    return (await gitOk(wt.ruta, ['rev-parse', '--short', 'HEAD'])).trim()
  }

  /** `git push -u origin <rama>`. La confirmación humana la pide quien llama. */
  async publicar(wt: InfoWorktree): Promise<string> {
    const r = await git(wt.ruta, ['push', '-u', 'origin', wt.rama], { timeoutMs: 120_000 })
    if (!r.ok) throw new Error(r.stderr.trim() || 'git push falló')
    return (r.stderr || r.stdout).trim()
  }

  async descartar(repo: string, wt: InfoWorktree): Promise<void> {
    const rel = relative(join(this.raiz, validarId(wt.proyectoId)), resolve(wt.ruta))
    if (rel.startsWith('..') || isAbsolute(rel) || rel === '') throw new Error('El worktree no pertenece a esta aplicación')
    await gitOk(repo, ['worktree', 'remove', '--force', wt.ruta])
    await git(repo, ['branch', '-D', wt.rama])
  }
}
