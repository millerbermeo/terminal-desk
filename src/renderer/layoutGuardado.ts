import type { Nodo } from './arbol'
import { hojas } from './arbol'

const PREFIJO = 'odesk.layout.'

interface Identificable {
  id: string
  titulo: string
  proyectoId?: string
}

/** Los ids de terminal cambian en cada sesión: lo que se guarda usa el proyecto (y su orden si hay varias del mismo). */
function clavesEstables(terminales: Identificable[]): Map<string, string> {
  const vistos = new Map<string, number>()
  const claves = new Map<string, string>()
  for (const t of terminales) {
    const base = t.proyectoId ?? `t:${t.titulo}`
    const n = vistos.get(base) ?? 0
    vistos.set(base, n + 1)
    claves.set(t.id, `${base}#${n}`)
  }
  return claves
}

function renombrar(n: Nodo, f: (id: string) => string | undefined): Nodo | null {
  if (n.t === 'hoja') {
    const id = f(n.id)
    return id === undefined ? null : { ...n, id }
  }
  const a = renombrar(n.a, f)
  const b = renombrar(n.b, f)
  return a && b ? { ...n, a, b } : null
}

/** Guarda la distribución de una pestaña (por su clave de grupo). */
export function guardarLayout(clave: string, arbol: Nodo, terminales: Identificable[]): void {
  try {
    const claves = clavesEstables(terminales)
    const estable = renombrar(arbol, (id) => claves.get(id))
    if (estable) localStorage.setItem(PREFIJO + clave, JSON.stringify(estable))
  } catch {
    // sin almacenamiento: la distribución solo dura esta sesión
  }
}

export function olvidarLayout(clave: string): void {
  try {
    localStorage.removeItem(PREFIJO + clave)
  } catch {
    // nada que borrar
  }
}

/** Distribución guardada, si encaja exactamente con las terminales actuales; si no, `null` (cuadrícula automática). */
export function cargarLayout(clave: string, terminales: Identificable[]): Nodo | null {
  try {
    const crudo = localStorage.getItem(PREFIJO + clave)
    if (!crudo || terminales.length === 0) return null
    const guardado = JSON.parse(crudo) as Nodo
    const claves = clavesEstables(terminales)
    const porClave = new Map([...claves].map(([id, k]) => [k, id]))
    const hojasGuardadas = hojas(guardado)
    if (hojasGuardadas.length !== terminales.length || !hojasGuardadas.every((k) => porClave.has(k))) return null
    return renombrar(guardado, (k) => porClave.get(k))
  } catch {
    return null
  }
}
