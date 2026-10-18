import { useState } from 'react'
import { trabajandoAhora, type AvisoEquipo } from '@shared/equipos'
import { fechaRelativa } from '@shared/versiones'

/** Texto corto de lo que tiene pendiente otro equipo: «5 archivos sin guardar, 2 commits sin enviar». */
export function resumenAviso(a: Pick<AvisoEquipo, 'cambios' | 'adelante'>): string {
  const partes: string[] = []
  if (a.cambios > 0) partes.push(`${a.cambios} archivo${a.cambios === 1 ? '' : 's'} sin guardar`)
  if (a.adelante > 0) partes.push(`${a.adelante} commit${a.adelante === 1 ? '' : 's'} sin enviar`)
  return partes.join(', ')
}

interface Props {
  avisos: AvisoEquipo[]
  onVerEquipos: () => void
}

/** Antes de editar: otro equipo de tu cuenta tiene trabajo en este proyecto que aún no está en el remoto. */
export function AvisoEquipos({ avisos, onVerEquipos }: Props) {
  const [ocultos, setOcultos] = useState<Set<string>>(new Set())
  const ahora = Date.now()
  const visibles = avisos.filter((a) => !ocultos.has(a.idEquipo))
  if (visibles.length === 0) return null
  return (
    <div className="vc-banner aviso eq-aviso" role="status">
      <div className="eq-aviso-lista">
        {visibles.map((a) => {
          const activo = trabajandoAhora(a, ahora)
          return (
            <p key={a.idEquipo}>
              <strong>{a.equipo}</strong>
              {a.rama && <span className="chip mono">{a.rama}</span>} tiene {resumenAviso(a)}
              {a.lineasMas + a.lineasMenos > 0 && (
                <span className="mono eq-lineas">
                  {' '}
                  <b className="mas">+{a.lineasMas}</b> <b className="menos">−{a.lineasMenos}</b>
                </span>
              )}
              {activo ? <span className="chip chip-ok eq-trabajando">trabajando ahora</span> : a.ultimaActividad ? <span className="eq-visto"> · editó {fechaRelativa(a.ultimaActividad, ahora)}</span> : null}
            </p>
          )
        })}
        <p className="eq-aviso-pista">Eso no está en el remoto: pídele que haga commit y push antes de editar aquí, o habrá conflictos.</p>
      </div>
      <button onClick={onVerEquipos}>Ver equipos</button>
      <button className="icono" aria-label="Ocultar el aviso" title="Ocultar" onClick={() => setOcultos(new Set(avisos.map((a) => a.idEquipo)))}>
        ✕
      </button>
    </div>
  )
}
