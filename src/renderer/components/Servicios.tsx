import type { EstadoArranque } from '@shared/arranque'
import type { TerminalInfo } from '../App'
import { EstadoVacio } from './EstadoVacio'
import { IconoDetener, IconoPestanas, IconoRayo, IconoRejilla } from './Iconos'
import { TerminalGrid, type Modo } from './TerminalGrid'

interface Props {
  visible: boolean
  terminales: TerminalInfo[]
  activa: string | null
  modo: Modo
  reiniciarLayout: number
  /** Estado de cada comando de arranque, por `proyecto|comando`. */
  estados: Record<string, EstadoArranque>
  onModo: (m: Modo) => void
  onActivar: (id: string) => void
  onCerrar: (id: string) => void
  onPty: (id: string, ptyId: string) => void
  onPersonalizado: (v: boolean) => void
  onReorganizar: () => void
  personalizado: boolean
  onDetener: (proyectoId: string, comandoId: string) => void
  onDetenerTodo: () => void
}

const ETIQUETA: Record<EstadoArranque['estado'], string> = { pendiente: 'En espera', arrancando: 'Arrancando…', listo: 'En marcha', error: 'Error', detenido: 'Detenido', omitido: 'Omitido' }

/**
 * Los servicios de los proyectos (sus comandos de arranque) en una sección aparte: así no ocupan sitio en la rejilla de terminales
 * de cada proyecto. Siempre montada (oculta cuando no se ve) para no matar los procesos.
 */
export function Servicios({ visible, terminales, activa, modo, reiniciarLayout, estados, onModo, onActivar, onCerrar, onPty, onPersonalizado, onReorganizar, personalizado, onDetener, onDetenerTodo }: Props) {
  return (
    <main className="principal servicios" style={{ display: visible ? 'flex' : 'none' }} aria-label="Servicios en marcha">
      <div className="barra servicios-barra">
        <span className="barra-info">
          <span className="punto" /> {terminales.length} {terminales.length === 1 ? 'servicio' : 'servicios'}
        </span>
        <div className="servicios-chips" role="tablist" aria-label="Servicios">
          {terminales.map((t) => {
            const e = t.arranque ? estados[`${t.arranque.proyectoId}|${t.arranque.comandoId}`] : undefined
            return (
              <span key={t.id} className={`serv-chip est-${e?.estado ?? 'pendiente'}${t.id === activa ? ' activo' : ''}`}>
                <button role="tab" aria-selected={t.id === activa} className="serv-chip-nombre" onClick={() => onActivar(t.id)} title={`${t.titulo} · ${e ? ETIQUETA[e.estado] : ''}${e?.mensaje ? ` · ${e.mensaje}` : ''}`}>
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
          <button disabled={terminales.length === 0} onClick={onDetenerTodo} title="Detener todos los servicios">
            <IconoDetener /> Detener todo
          </button>
          {modo === 'rejilla' && personalizado && <button onClick={onReorganizar} title="Volver a la cuadrícula automática">Reorganizar</button>}
          <div className="segmentado" role="group" aria-label="Vista">
            <button className={modo === 'rejilla' ? 'on' : ''} onClick={() => onModo('rejilla')} title="Todos a la vez">
              <IconoRejilla /> Rejilla
            </button>
            <button className={modo === 'pestanas' ? 'on' : ''} onClick={() => onModo('pestanas')} title="Uno a la vez">
              <IconoPestanas /> Pestañas
            </button>
          </div>
        </div>
      </div>
      {terminales.length === 0 ? (
        <EstadoVacio icono={<IconoRayo />} titulo="Ningún servicio en marcha" texto="Define los comandos de arranque de un proyecto con el ⚡ de su fila en la barra lateral. Al lanzarlos, cada uno aparece aquí con su terminal." />
      ) : (
        <TerminalGrid
          terminales={terminales}
          activa={activa}
          modo={modo}
          reiniciarLayout={reiniciarLayout}
          claveLayout="__servicios__"
          onPersonalizado={onPersonalizado}
          onActivar={onActivar}
          onCerrar={onCerrar}
          onPty={onPty}
        />
      )}
    </main>
  )
}
