import { useEffect, useState } from 'react'
import { ModalConfirmar, type OpcionesConfirmar } from './components/ModalConfirmar'

interface Solicitud {
  opciones: OpcionesConfirmar
  resolver: (aceptado: boolean) => void
}

let mostrar: ((s: Solicitud) => void) | null = null

/** Confirmación con el diseño de la app (sustituye a `window.confirm`): resuelve `true` si se acepta. */
export function confirmar(opciones: OpcionesConfirmar): Promise<boolean> {
  return new Promise((resolver) => {
    if (mostrar) mostrar({ opciones, resolver })
    else resolver(window.confirm(`${opciones.titulo}\n\n${opciones.texto}`))
  })
}

/** Se monta una vez en cada raíz del renderer; pinta las confirmaciones pedidas con `confirmar()`. */
export function AnfitrionConfirmar() {
  const [cola, setCola] = useState<Solicitud[]>([])
  useEffect(() => {
    mostrar = (s) => setCola((c) => [...c, s])
    return () => {
      mostrar = null
    }
  }, [])
  const actual = cola[0]
  if (!actual) return null
  const cerrar = (aceptado: boolean): void => {
    actual.resolver(aceptado)
    setCola((c) => c.slice(1))
  }
  return <ModalConfirmar key={cola.length} {...actual.opciones} onConfirmar={() => cerrar(true)} onCerrar={() => cerrar(false)} />
}
