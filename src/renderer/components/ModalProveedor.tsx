import { useCallback, useEffect, useState } from 'react'
import type { Proveedor, ProveedorEstado } from '@shared/modelos'
import { IconoCerrar, IconoMas } from './Iconos'

interface Props {
  inicial?: ProveedorEstado // undefined = nuevo
  onGuardado: (p: ProveedorEstado[]) => void
  onCerrar: () => void
}

interface VarEnv {
  clave: string
  valor: string
}

export function ModalProveedor({ inicial, onGuardado, onCerrar }: Props) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [comando, setComando] = useState(inicial?.comando ?? '')
  const [vars, setVars] = useState<VarEnv[]>(
    Object.entries(inicial?.env ?? {}).map(([clave, valor]) => ({ clave, valor }))
  )
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [cerrando, setCerrando] = useState(false)

  const salir = useCallback((): void => {
    setCerrando(true)
    window.setTimeout(onCerrar, 200)
  }, [onCerrar])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') salir()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [salir])

  const cambiarVar = (i: number, campo: keyof VarEnv, valor: string): void => {
    setError(null)
    setVars((vs) => vs.map((v, j) => (j === i ? { ...v, [campo]: valor } : v)))
  }

  const enviar = async (): Promise<void> => {
    const env: Record<string, string> = {}
    for (const v of vars) if (v.clave.trim()) env[v.clave.trim()] = v.valor
    const proveedor: Proveedor = { id: inicial?.id ?? '', nombre, comando, env }
    setGuardando(true)
    const res = await window.api.proveedores.guardar(proveedor).catch(
      () => ({ ok: false as const, mensaje: 'No se pudo guardar. Reinicia la app (pnpm dev)' })
    )
    setGuardando(false)
    if (!res.ok) return setError(res.mensaje)
    onGuardado(res.proveedores)
    salir()
  }

  return (
    <div className={`modal-fondo${cerrando ? ' saliendo' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && salir()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={inicial ? 'Editar proveedor' : 'Agregar proveedor'}
        onSubmit={(e) => {
          e.preventDefault()
          if (nombre.trim() && comando.trim() && !guardando) void enviar()
        }}
      >
        <div className="modal-cab">
          <h3>{inicial ? 'Editar proveedor' : 'Agregar proveedor de IA'}</h3>
          <button type="button" className="icono" onClick={salir} title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>

        <label>
          Nombre
          <input value={nombre} onChange={(e) => { setNombre(e.target.value); setError(null) }} placeholder="Claude Code" autoFocus />
        </label>
        <label className="ancho">
          Comando
          <input
            className="mono"
            value={comando}
            onChange={(e) => { setComando(e.target.value); setError(null) }}
            placeholder="claude --model sonnet"
          />
          <span className="ayuda">Se escribe tal cual en la terminal del proyecto, igual que si lo tecleas tú.</span>
        </label>

        <div className="env">
          <div className="env-cab">
            <span>Variables de entorno (opcional)</span>
            <button type="button" onClick={() => setVars((vs) => [...vs, { clave: '', valor: '' }])}>
              <IconoMas /> Variable
            </button>
          </div>
          {vars.map((v, i) => (
            <div className="cfg-fila" key={i}>
              <input className="mono" placeholder="ANTHROPIC_API_KEY" value={v.clave} onChange={(e) => cambiarVar(i, 'clave', e.target.value)} />
              <input className="ruta mono" placeholder="valor" value={v.valor} onChange={(e) => cambiarVar(i, 'valor', e.target.value)} />
              <button type="button" className="icono" title="Quitar variable" onClick={() => setVars((vs) => vs.filter((_, j) => j !== i))}>
                <IconoCerrar />
              </button>
            </div>
          ))}
          {vars.length > 0 && (
            <span className="ayuda">Se guardan en texto plano en ~/.odesk-agent/proveedores.json (permisos 600). Si ya iniciaste sesión en el CLI no hace falta ponerlas.</span>
          )}
        </div>

        {error && <div className="cfg-error">{error}</div>}
        <div className="cfg-acciones">
          <button type="submit" className="primario" disabled={!nombre.trim() || !comando.trim() || guardando}>
            Guardar
          </button>
          <button type="button" onClick={salir}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
