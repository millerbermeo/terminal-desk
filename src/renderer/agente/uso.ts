import { useEffect, useState, useSyncExternalStore } from 'react'
import { MODELOS_CONOCIDOS, type InfoModelo, type ResumenUso } from '@shared/core/uso'

// ---- consumo y límites, en tiempo real (el proceso principal avisa tras cada llamada al modelo) ----
let uso: ResumenUso | undefined
const oyentes = new Set<() => void>()
let iniciado = false

function iniciarUso(): void {
  if (iniciado) return
  iniciado = true
  const publicar = (r: ResumenUso): void => {
    uso = r
    for (const o of oyentes) o()
  }
  void window.api.core.uso().then(publicar).catch(() => undefined)
  window.api.core.onUso(publicar)
}

export function useUso(): ResumenUso | undefined {
  return useSyncExternalStore(
    (cb) => {
      iniciarUso()
      oyentes.add(cb)
      return () => oyentes.delete(cb)
    },
    () => uso
  )
}

// ---- modelos disponibles (una sola consulta; el proceso principal los guarda 10 minutos) ----
let modelos: InfoModelo[] | undefined
let pendiente: Promise<InfoModelo[]> | undefined

export function useModelos(): InfoModelo[] {
  const [lista, setLista] = useState<InfoModelo[]>(modelos ?? [...MODELOS_CONOCIDOS])
  useEffect(() => {
    if (modelos) return setLista(modelos)
    pendiente ??= window.api.core.modelos().then((m) => (modelos = m), () => (modelos = [...MODELOS_CONOCIDOS]))
    let vivo = true
    void pendiente.then((m) => vivo && setLista(m))
    return () => {
      vivo = false
    }
  }, [])
  return lista
}

export const ventanaDe = (lista: readonly InfoModelo[], id?: string): number | undefined => lista.find((m) => m.id === id)?.ventana

/** 950 -> «950», 12 400 -> «12k», 1 250 000 -> «1,25M». */
export function fmt(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.', ',')}k`
  return `${(n / 1_000_000).toFixed(2).replace('.', ',')}M`
}
