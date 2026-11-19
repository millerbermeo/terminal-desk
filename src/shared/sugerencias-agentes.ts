import type { Recurso } from './modelos'

/** Qué recurso conviene activar en un proyecto y por qué (las tecnologías detectadas que aparecen en su nombre o descripción). */
export interface SugerenciaRecurso {
  recursoId: string
  motivos: string[]
}

/** Archivos de dependencias que se leen (en la raíz y en las carpetas de primer nivel) para detectar el stack. */
export const ARCHIVOS_STACK = ['package.json', 'composer.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pubspec.yaml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'Dockerfile', 'docker-compose.yml', 'tsconfig.json'] as const

const sinAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tecnología → palabras con las que un recurso suele nombrarla (la primera es la etiqueta que se muestra). */
const SINONIMOS: Record<string, string[]> = {
  react: ['react', 'jsx', 'tsx'],
  'react native': ['react native', 'react-native', 'expo'],
  vue: ['vue', 'nuxt'],
  angular: ['angular'],
  svelte: ['svelte', 'sveltekit'],
  next: ['next', 'nextjs', 'next.js'],
  nest: ['nest', 'nestjs'],
  express: ['express'],
  electron: ['electron'],
  typescript: ['typescript'],
  tailwind: ['tailwind', 'tailwindcss'],
  prisma: ['prisma'],
  drizzle: ['drizzle'],
  vite: ['vite'],
  vitest: ['vitest'],
  jest: ['jest'],
  playwright: ['playwright'],
  node: ['node', 'nodejs', 'node.js'],
  php: ['php'],
  laravel: ['laravel', 'eloquent', 'blade'],
  symfony: ['symfony'],
  python: ['python'],
  django: ['django'],
  flask: ['flask'],
  fastapi: ['fastapi'],
  go: ['golang'],
  rust: ['rust', 'cargo'],
  flutter: ['flutter', 'dart'],
  java: ['java'],
  spring: ['spring'],
  kotlin: ['kotlin'],
  ruby: ['ruby'],
  rails: ['rails'],
  dotnet: ['dotnet', '.net', 'csharp', 'c#'],
  docker: ['docker', 'dockerfile', 'contenedor', 'container'],
  postgres: ['postgres', 'postgresql'],
  mysql: ['mysql', 'mariadb'],
  mongodb: ['mongodb', 'mongoose'],
  redis: ['redis'],
  graphql: ['graphql']
}

/** Dependencias de `package.json` (o texto de otros archivos) → tecnologías de `SINONIMOS`. */
const PISTAS: { archivo: string; patron: RegExp; tecnologia: string }[] = [
  { archivo: 'package.json', patron: /"react"\s*:/, tecnologia: 'react' },
  { archivo: 'package.json', patron: /"react-native"\s*:/, tecnologia: 'react native' },
  { archivo: 'package.json', patron: /"(vue|nuxt)"\s*:/, tecnologia: 'vue' },
  { archivo: 'package.json', patron: /"@angular\/core"\s*:/, tecnologia: 'angular' },
  { archivo: 'package.json', patron: /"svelte"\s*:/, tecnologia: 'svelte' },
  { archivo: 'package.json', patron: /"next"\s*:/, tecnologia: 'next' },
  { archivo: 'package.json', patron: /"@nestjs\/core"\s*:/, tecnologia: 'nest' },
  { archivo: 'package.json', patron: /"express"\s*:/, tecnologia: 'express' },
  { archivo: 'package.json', patron: /"electron"\s*:/, tecnologia: 'electron' },
  { archivo: 'package.json', patron: /"typescript"\s*:/, tecnologia: 'typescript' },
  { archivo: 'package.json', patron: /"tailwindcss"\s*:/, tecnologia: 'tailwind' },
  { archivo: 'package.json', patron: /"(prisma|@prisma\/client)"\s*:/, tecnologia: 'prisma' },
  { archivo: 'package.json', patron: /"drizzle-orm"\s*:/, tecnologia: 'drizzle' },
  { archivo: 'package.json', patron: /"vite"\s*:/, tecnologia: 'vite' },
  { archivo: 'package.json', patron: /"vitest"\s*:/, tecnologia: 'vitest' },
  { archivo: 'package.json', patron: /"jest"\s*:/, tecnologia: 'jest' },
  { archivo: 'package.json', patron: /"(@playwright\/test|playwright)"\s*:/, tecnologia: 'playwright' },
  { archivo: 'package.json', patron: /"(graphql|@apollo\/server)"\s*:/, tecnologia: 'graphql' },
  { archivo: 'package.json', patron: /"(mongoose|mongodb)"\s*:/, tecnologia: 'mongodb' },
  { archivo: 'package.json', patron: /"(ioredis|redis)"\s*:/, tecnologia: 'redis' },
  { archivo: 'package.json', patron: /"(pg|postgres)"\s*:/, tecnologia: 'postgres' },
  { archivo: 'package.json', patron: /"mysql2?"\s*:/, tecnologia: 'mysql' },
  { archivo: 'package.json', patron: /"name"\s*:/, tecnologia: 'node' },
  { archivo: 'composer.json', patron: /./, tecnologia: 'php' },
  { archivo: 'composer.json', patron: /"laravel\/framework"/, tecnologia: 'laravel' },
  { archivo: 'composer.json', patron: /"symfony\//, tecnologia: 'symfony' },
  { archivo: 'requirements.txt', patron: /./, tecnologia: 'python' },
  { archivo: 'pyproject.toml', patron: /./, tecnologia: 'python' },
  { archivo: 'requirements.txt', patron: /^\s*django\b/im, tecnologia: 'django' },
  { archivo: 'pyproject.toml', patron: /\bdjango\b/i, tecnologia: 'django' },
  { archivo: 'requirements.txt', patron: /^\s*flask\b/im, tecnologia: 'flask' },
  { archivo: 'pyproject.toml', patron: /\bflask\b/i, tecnologia: 'flask' },
  { archivo: 'requirements.txt', patron: /^\s*fastapi\b/im, tecnologia: 'fastapi' },
  { archivo: 'pyproject.toml', patron: /\bfastapi\b/i, tecnologia: 'fastapi' },
  { archivo: 'go.mod', patron: /./, tecnologia: 'go' },
  { archivo: 'Cargo.toml', patron: /./, tecnologia: 'rust' },
  { archivo: 'pubspec.yaml', patron: /./, tecnologia: 'flutter' },
  { archivo: 'pom.xml', patron: /./, tecnologia: 'java' },
  { archivo: 'pom.xml', patron: /spring/i, tecnologia: 'spring' },
  { archivo: 'build.gradle', patron: /./, tecnologia: 'java' },
  { archivo: 'build.gradle.kts', patron: /./, tecnologia: 'kotlin' },
  { archivo: 'Gemfile', patron: /./, tecnologia: 'ruby' },
  { archivo: 'Gemfile', patron: /\brails\b/i, tecnologia: 'rails' },
  { archivo: 'Dockerfile', patron: /./, tecnologia: 'docker' },
  { archivo: 'docker-compose.yml', patron: /./, tecnologia: 'docker' },
  { archivo: 'docker-compose.yml', patron: /postgres/i, tecnologia: 'postgres' },
  { archivo: 'docker-compose.yml', patron: /mysql|mariadb/i, tecnologia: 'mysql' },
  { archivo: 'tsconfig.json', patron: /./, tecnologia: 'typescript' }
]

/** Tecnologías detectadas a partir del contenido de los archivos de dependencias (clave = nombre del archivo; varios con el mismo nombre se concatenan). */
export function tecnologiasDe(contenidos: Record<string, string>): string[] {
  const salida = new Set<string>()
  for (const p of PISTAS) {
    const texto = contenidos[p.archivo]
    if (texto !== undefined && p.patron.test(texto)) salida.add(p.tecnologia)
  }
  return [...salida]
}

const escapar = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** La palabra aparece entera (no dentro de otra: `go` no cuenta en «algoritmo»). */
const contienePalabra = (texto: string, palabra: string): boolean => new RegExp(`(^|[^a-z0-9])${escapar(palabra)}($|[^a-z0-9])`).test(texto)

/**
 * Recursos compartidos que encajan con el stack del proyecto, de más a menos coincidencias. Se compara el nombre y la descripción con
 * los sinónimos de cada tecnología detectada. Los que ya están activos no se sugieren.
 */
export function sugerirPorStack(recursos: Recurso[], tecnologias: string[], yaActivos: ReadonlySet<string>): SugerenciaRecurso[] {
  const salida: SugerenciaRecurso[] = []
  for (const r of recursos) {
    if (r.ambito !== 'compartido' || yaActivos.has(r.id)) continue
    const texto = sinAcentos(`${r.nombre} ${r.descripcion}`)
    const motivos = tecnologias.filter((t) => (SINONIMOS[t] ?? [t]).some((w) => contienePalabra(texto, w)))
    if (motivos.length) salida.push({ recursoId: r.id, motivos })
  }
  return salida.sort((a, b) => b.motivos.length - a.motivos.length || a.recursoId.localeCompare(b.recursoId))
}
