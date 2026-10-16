import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { EstadoCuenta, ProveedorModelo } from '@shared/core/cuenta'

// Estado compartido por todas las celdas del Asistente: una sola consulta al CLI, no una por celda.
let estado: EstadoCuenta | undefined
let ocupado = ''
let error = ''
let consulta: Promise<void> | undefined
const oyentes = new Set<() => void>()
let version = 0
let instantanea = { estado, ocupado, error, version }

const avisar = (): void => {
  instantanea = { estado, ocupado, error, version: ++version }
  for (const o of oyentes) o()
}
const mensajeDe = (err: unknown): string => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function refrescarCuenta(): Promise<void> {
  consulta ??= window.api.core
    .cuentaEstado()
    .then((e) => {
      estado = e
    })
    .catch((err) => {
      error = mensajeDe(err)
    })
    .finally(() => {
      consulta = undefined
      avisar()
    })
  return consulta
}

async function accion(nombre: string, f: () => Promise<EstadoCuenta>): Promise<void> {
  ocupado = nombre
  error = ''
  avisar()
  try {
    estado = await f()
  } catch (err) {
    error = mensajeDe(err)
  } finally {
    ocupado = ''
    avisar()
  }
}

export function useCuenta() {
  const s = useSyncExternalStore(
    (cb) => {
      oyentes.add(cb)
      return () => void oyentes.delete(cb)
    },
    () => instantanea
  )
  useEffect(() => {
    if (!estado) void refrescarCuenta()
    // Al volver a la ventana (p. ej. tras iniciar sesión en el navegador) se comprueba de nuevo.
    const alEnfocar = (): void => void refrescarCuenta()
    window.addEventListener('focus', alEnfocar)
    return () => window.removeEventListener('focus', alEnfocar)
  }, [])
  const elegir = useCallback((p: ProveedorModelo) => accion('proveedor', () => window.api.core.cuentaProveedor(p)), [])
  const iniciarSesion = useCallback(() => accion('iniciando', () => window.api.core.cuentaIniciarSesion()), [])
  const cerrarSesion = useCallback(() => accion('cerrando', () => window.api.core.cuentaCerrarSesion()), [])
  return { cuenta: s.estado, ocupado: s.ocupado, error: s.error, elegir, iniciarSesion, cerrarSesion }
}
