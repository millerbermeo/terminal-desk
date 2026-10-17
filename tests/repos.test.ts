import { describe, expect, it } from 'vitest'
import { candidatosPorRepo, claveRepo, mismoRepo, type ProyectoRemoto } from '../src/shared/repos'

describe('clave de repositorio', () => {
  it('da la misma clave por https, ssh y forma corta', () => {
    const esperada = 'github.com/millerbermeo/terminal-desk'
    for (const url of [
      'https://github.com/millerbermeo/terminal-desk.git',
      'https://github.com/millerbermeo/terminal-desk',
      'git@github.com:millerbermeo/terminal-desk.git',
      'ssh://git@github.com/millerbermeo/terminal-desk.git',
      'ssh://git@github.com:443/millerbermeo/terminal-desk.git',
      'https://github.com/millerbermeo/terminal-desk.git/'
    ])
      expect(claveRepo(url), url).toBe(esperada)
  })

  it('ignora credenciales incrustadas y mayúsculas', () => {
    expect(claveRepo('https://usuario:ghp_token@github.com/Miller/Terminal-Desk.git')).toBe('github.com/miller/terminal-desk')
    expect(claveRepo('git@GITHUB.com:Miller/Terminal-Desk.git')).toBe('github.com/miller/terminal-desk')
  })

  it('trata ssh.github.com (puerto 443) como el mismo servidor', () => {
    expect(claveRepo('git@ssh.github.com:millerbermeo/terminal-desk.git')).toBe(claveRepo('git@github.com:millerbermeo/terminal-desk.git'))
  })

  it('con un alias de ~/.ssh/config usa el servidor ya resuelto', () => {
    expect(claveRepo('git@github-miller:millerbermeo/terminal-desk.git')).toBe('github-miller/millerbermeo/terminal-desk')
    expect(claveRepo('git@github-miller:millerbermeo/terminal-desk.git', 'ssh.github.com')).toBe('github.com/millerbermeo/terminal-desk')
  })

  it('no empareja lo que no identifica un repositorio compartido', () => {
    for (const v of ['', '   ', '/home/dev/repos/cosa.git', 'file:///home/dev/repos/cosa.git', 'C:/repos/cosa', null, undefined])
      expect(claveRepo(v as string), String(v)).toBeUndefined()
  })

  it('mismoRepo compara por clave, y dos rutas locales nunca son «el mismo»', () => {
    expect(mismoRepo('git@github.com:a/b.git', 'https://github.com/A/B')).toBe(true)
    expect(mismoRepo('git@github.com:a/b.git', 'git@github.com:a/otro.git')).toBe(false)
    expect(mismoRepo('git@gitlab.com:a/b.git', 'git@github.com:a/b.git')).toBe(false)
    expect(mismoRepo('/home/dev/x', '/home/dev/x')).toBe(false)
  })
})

describe('candidatos para retomar un proyecto', () => {
  const proyectos: ProyectoRemoto[] = [
    { id: '1', name: 'Backend', repo: 'git@github.com:miller/tienda.git' },
    { id: '2', name: 'Frontend', repo: 'https://github.com/miller/tienda.git' }, // monorepo: mismo origin
    { id: '3', name: 'Otro', repo: 'git@github.com:miller/otro.git' },
    { id: '4', name: 'Sin repo', repo: null }
  ]

  it('encuentra los del mismo repositorio aunque el remoto esté escrito de otra forma', () => {
    const r = candidatosPorRepo(proyectos, 'https://usuario@github.com/Miller/Tienda.git', new Set())
    expect(r.map((p) => p.name)).toEqual(['Backend', 'Frontend'])
  })

  it('descarta los que ya tienen carpeta en este equipo', () => {
    const r = candidatosPorRepo(proyectos, 'git@github.com:miller/tienda.git', new Set(['1']))
    expect(r.map((p) => p.name)).toEqual(['Frontend'])
  })

  it('sin remoto, con una ruta local o sin coincidencias no propone nada', () => {
    expect(candidatosPorRepo(proyectos, null, new Set())).toEqual([])
    expect(candidatosPorRepo(proyectos, '/home/dev/tienda', new Set())).toEqual([])
    expect(candidatosPorRepo(proyectos, 'git@github.com:miller/nuevo.git', new Set())).toEqual([])
  })

  it('un proyecto sin repo nunca se propone', () => {
    expect(candidatosPorRepo(proyectos, '', new Set()).length).toBe(0)
    expect(candidatosPorRepo([{ id: '4', name: 'Sin repo', repo: null }], null, new Set())).toEqual([])
  })
})
