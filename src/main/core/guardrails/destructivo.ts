import { basename } from 'node:path'

const BINARIOS: Record<string, string> = {
  rm: 'elimina archivos',
  rmdir: 'elimina directorios',
  shred: 'destruye archivos',
  dd: 'escribe bytes sobre archivos o dispositivos',
  mkfs: 'formatea un dispositivo',
  mv: 'mueve o sobrescribe archivos',
  chmod: 'cambia permisos',
  chown: 'cambia propietarios',
  kill: 'termina procesos',
  killall: 'termina procesos',
  pkill: 'termina procesos',
  sudo: 'se ejecuta con privilegios de administrador',
  su: 'cambia de usuario',
  curl: 'accede a la red',
  wget: 'accede a la red',
  ssh: 'accede a otra máquina',
  scp: 'copia archivos a otra máquina',
  rsync: 'sincroniza archivos (puede borrar en destino)'
}

const PUBLICAR = new Set(['publish', 'deploy', 'unpublish'])

function destructivoGit(args: readonly string[]): string | null {
  // `git -c clave=valor` y similares permiten ejecutar programas arbitrarios (core.pager, alias con «!»…).
  if (args.some((a) => a === '-c' || a.startsWith('--exec-path') || a.startsWith('--config-env') || a === '--upload-pack')) return 'cambia la configuración de git en línea (puede ejecutar programas)'
  const [sub = '', ...resto] = args
  switch (sub) {
    case 'push':
      return 'sube cambios a un repositorio remoto (push)'
    case 'reset':
      return resto.includes('--hard') ? 'descarta cambios locales (reset --hard)' : null
    case 'clean':
      return 'borra archivos sin seguimiento'
    case 'rebase':
    case 'filter-branch':
      return 'reescribe el historial'
    case 'checkout':
    case 'restore':
      return resto.includes('--') || resto.includes('-f') || resto.includes('--force') || sub === 'restore' ? 'descarta cambios en archivos' : null
    case 'branch':
      return resto.some((a) => /^-[dD]$|^--delete$/.test(a)) ? 'elimina ramas' : null
    case 'stash':
      return resto[0] === 'drop' || resto[0] === 'clear' ? 'descarta cambios guardados' : null
    case 'tag':
      return resto.some((a) => a === '-d') ? 'elimina etiquetas' : null
    case 'worktree':
      return resto[0] === 'remove' ? 'elimina un worktree' : null
    default:
      return null
  }
}

/** Herramientas de la aplicación que publican fuera de la máquina: siempre piden confirmación y nunca se recuerdan ni se permiten por regla. */
const PUBLICAN: Record<string, string> = {
  git_enviar: 'sube commits a un repositorio remoto (push)',
  github_crear_repo: 'crea un repositorio en GitHub',
  github_crear_pr: 'publica un pull request en GitHub',
  github_crear_issue: 'publica una incidencia en GitHub',
  github_comentar: 'publica un comentario en GitHub'
}

/** Motivo por el que una llamada es destructiva o sale de la máquina (siempre exige confirmación explícita). */
export function esDestructiva(herramienta: string, entrada: Record<string, unknown>): string | null {
  if (Object.hasOwn(PUBLICAN, herramienta)) return PUBLICAN[herramienta]!
  if (herramienta === 'ejecutar_comando') {
    const bin = basename(String(entrada.comando ?? ''))
    const args = Array.isArray(entrada.args) ? entrada.args.map(String) : []
    if (bin === 'git') return destructivoGit(args)
    if (['npm', 'pnpm', 'yarn', 'cargo', 'docker'].includes(bin) && args.some((a) => PUBLICAR.has(a) || a === 'push')) return 'publica artefactos'
    return BINARIOS[bin] ?? null
  }
  if (herramienta.startsWith('mcp__') && /delete|remove|drop|destroy|truncate|push|publish|kill|reset/i.test(herramienta)) {
    return 'herramienta externa potencialmente destructiva'
  }
  return null
}
