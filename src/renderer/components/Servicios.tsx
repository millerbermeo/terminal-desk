import { useRef, useState } from 'react'
import type { EstadoArranque } from '@shared/arranque'
import type { TerminalInfo } from '../App'
import { EstadoVacio } from './EstadoVacio'
import { IconoDetener, IconoPestanas, IconoRayo, IconoReiniciar, IconoRejilla } from './Iconos'
import { TerminalGrid, type Modo } from './TerminalGrid'
import { transferidas } from './TerminalPanel'

interface Props {
  visible: boolean
  terminales: TerminalInfo[]
  /** Grupo de proyectos al que pertenece cada servicio: una pestaña (con su rejilla) por grupo. */
  grupoDe: (t: TerminalInfo) => { id: string; nombre: string }
  /** Estado de cada comando de arranque, por `proyecto|comando`. */
  estados: Record<string, EstadoArranque>
  onCerrar: (id: string) => void
  onPty: (id: string, ptyId: string) => void
  onDetener: (proyectoId: string, comandoId: string) => void
  /** Detiene todos los servicios de esos proyectos. */
  onDetenerProyectos: (proyectoIds: string[]) => void
}

/** Lo que cada pestaña de grupo recuerda por su cuenta. */
interface EstadoGrupo {
  activa: string | null
  modo: Modo
  reiniciarLayout: number
  personalizado: boolean
}

const INICIAL: EstadoGrupo = { activa: null, modo: 'rejilla', reiniciarLayout: 0, personalizado: false }

const ETIQUETA: Record<EstadoArranque['estado'], string> = { pendiente: 'En espera', arrancando: 'Arrancando…', listo: 'En marcha', error: 'Error', detenido: 'Detenido', omitido: 'Omitido' }

const proyectosDe = (ts: TerminalInfo[]): string[] => [...new Set(ts.flatMap((t) => (t.arranque ? [t.arranque.proyectoId] : [])))]

/**
 * Los servicios de los proyectos (sus comandos de arranque) en una sección aparte: así no ocupan sitio en la rejilla de terminales
 * de cada proyecto. Se agrupan por grupo de proyectos, una pestaña con su propia rejilla por grupo.
 * Siempre montada (oculta cuando no se ve) para no matar los procesos.
 */
export function Servicios({ visible, terminales, grupoDe, estados, onCerrar, onPty, onDetener, onDetenerProyectos }: Props) {
  const [porGrupo, setPorGrupo] = useState<Record<string, EstadoGrupo>>({})
  const [elegido, setElegido] = useState<string | null>(null)
  const grupoPrevio = useRef(new Map<string, string>())

  // grupos en el orden en que aparecieron sus servicios
  const grupos: { id: string; nombre: string; terminales: TerminalInfo[] }[] = []
  for (const t of terminales) {
    const g = grupoDe(t)
    // Si su proyecto cambió de grupo, el servicio pasa a otra rejilla: el panel viejo se desmonta y, sin esto, cerraría el pty
    // (el proceso moriría). Como al separar ventanas, el pty queda «transferido» y el panel nuevo se adjunta a él.
    const antes = grupoPrevio.current.get(t.id)
    if (antes !== undefined && antes !== g.id && t.ptyId) transferidas.add(t.ptyId)
    grupoPrevio.current.set(t.id, g.id)
    const hay = grupos.find((x) => x.id === g.id)
    if (hay) hay.terminales.push(t)
    else grupos.push({ ...g, terminales: [t] })
  }
  const grupoActivo = grupos.find((g) => g.id === elegido)?.id ?? grupos[0]?.id ?? null

  const cambiar = (id: string, f: (e: EstadoGrupo) => EstadoGrupo): void => setPorGrupo((x) => ({ ...x, [id]: f(x[id] ?? INICIAL) }))

  return (
    <main className="principal servicios" style={{ display: visible ? 'flex' : 'none' }} aria-label="Servicios en marcha">
      {grupos.length > 0 && (
        <div className="ventanas" role="tablist" aria-label="Grupos de servicios">
          {grupos.map((g) => (
            <div
              key={g.id}
              role="tab"
              aria-selected={g.id === grupoActivo}
              tabIndex={0}
              className={`ventana-tab${g.id === grupoActivo ? ' activa' : ''}`}
              title={g.nombre}
              onClick={() => setElegido(g.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setElegido(g.id)}
            >
              <IconoRayo />
              <span className="ventana-nombre">{g.nombre}</span>
              <span className="contador">{g.terminales.length}</span>
            </div>
          ))}
        </div>
      )}

      {grupos.length === 0 && (
        <>
          <div className="barra servicios-barra">
            <span className="barra-info">
              <span className="punto" /> 0 servicios
            </span>
            <div className="barra-acciones">
              <button disabled title="Detener todos los servicios">
                <IconoDetener /> Detener todo
              </button>
            </div>
          </div>
          <EstadoVacio icono={<IconoRayo />} titulo="Ningún servicio en marcha" texto="Define los comandos de arranque de un proyecto con el ⚡ de su fila en la barra lateral. Al lanzarlos, cada uno aparece aquí con su terminal, agrupado por el grupo de su proyecto." />
        </>
      )}

      {grupos.map((g) => {
        const e = porGrupo[g.id] ?? INICIAL
        // si la activa ya no existe (servicio detenido), la última del grupo
        const activa = g.terminales.some((t) => t.id === e.activa) ? e.activa : (g.terminales.at(-1)?.id ?? null)
        return (
          <section key={g.id} className="ventana" style={{ display: g.id === grupoActivo ? 'flex' : 'none' }}>
            <div className="barra servicios-barra">
              <span className="barra-info">
                <span className="punto" /> {g.terminales.length} {g.terminales.length === 1 ? 'servicio' : 'servicios'}
              </span>
              <div className="servicios-chips" role="tablist" aria-label={`Servicios de ${g.nombre}`}>
                {g.terminales.map((t) => {
                  const est = t.arranque ? estados[`${t.arranque.proyectoId}|${t.arranque.comandoId}`] : undefined
                  return (
                    <span key={t.id} className={`serv-chip est-${est?.estado ?? 'pendiente'}${t.id === activa ? ' activo' : ''}`}>
                      <button role="tab" aria-selected={t.id === activa} className="serv-chip-nombre" onClick={() => cambiar(g.id, (x) => ({ ...x, activa: t.id }))} title={`${t.titulo} · ${est ? ETIQUETA[est.estado] : ''}${est?.mensaje ? ` · ${est.mensaje}` : ''}`}>
                        <span className="serv-punto" aria-hidden="true" />
                        {t.titulo}
                      </button>
                      {t.arranque && (
                        <button className="serv-chip-parar" title="Detener este servicio" aria-label={`Detener ${t.titulo}`} onClick={() => onDetener(t.arranque!.proyectoId, t.arranque!.comandoId)}>
                          <IconoDetener />
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
              <div className="barra-acciones">
                <button onClick={() => onDetenerProyectos(proyectosDe(g.terminales))} title={`Detener los servicios de «${g.nombre}»`}>
                  <IconoDetener /> Detener grupo
                </button>
                {grupos.length > 1 && (
                  <button onClick={() => onDetenerProyectos(proyectosDe(terminales))} title="Detener los servicios de todos los grupos">
                    <IconoDetener /> Detener todo
                  </button>
                )}
                {e.modo === 'rejilla' && e.personalizado && (
                  <button onClick={() => cambiar(g.id, (x) => ({ ...x, reiniciarLayout: x.reiniciarLayout + 1 }))} title="Volver a la cuadrícula automática">
                    <IconoReiniciar /> Reorganizar
                  </button>
                )}
                <div className="segmentado" role="group" aria-label="Vista">
                  <button className={e.modo === 'rejilla' ? 'on' : ''} onClick={() => cambiar(g.id, (x) => ({ ...x, modo: 'rejilla' }))} title="Todos a la vez">
                    <IconoRejilla /> Rejilla
                  </button>
                  <button className={e.modo === 'pestanas' ? 'on' : ''} onClick={() => cambiar(g.id, (x) => ({ ...x, modo: 'pestanas' }))} title="Uno a la vez">
                    <IconoPestanas /> Pestañas
                  </button>
                </div>
              </div>
            </div>
            <TerminalGrid
              terminales={g.terminales}
              activa={activa}
              modo={e.modo}
              reiniciarLayout={e.reiniciarLayout}
              claveLayout={`__servicios__:${g.id}`}
              onPersonalizado={(p) => cambiar(g.id, (x) => (x.personalizado === p ? x : { ...x, personalizado: p }))}
              onActivar={(id) => cambiar(g.id, (x) => (x.activa === id ? x : { ...x, activa: id }))}
              onCerrar={onCerrar}
              onPty={onPty}
            />
          </section>
        )
      })}
    </main>
  )
}
