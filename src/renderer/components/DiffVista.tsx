import { useMemo } from 'react'
import { analizarDiff } from '@shared/versiones'
import { EstadoVacio } from './EstadoVacio'
import { IconoArchivo } from './Iconos'

interface Props {
  titulo?: string
  texto: string
  binario?: boolean
  truncado?: boolean
  cargando?: boolean
  /** Qué decir cuando no hay diferencias que mostrar. */
  vacio?: string
}

const MAX_LINEAS = 6000
const AVISOS = /^(new file mode|deleted file mode|rename from|rename to|similarity index|old mode|new mode)/

/** Visor de diff unificado: números de línea, colores por tipo y avisos de archivo nuevo, borrado o renombrado. */
export function DiffVista({ titulo, texto, binario, truncado, cargando, vacio = 'Sin diferencias que mostrar.' }: Props) {
  const d = useMemo(() => analizarDiff(texto), [texto])
  const avisos = d.lineas.filter((l) => l.tipo === 'meta' && AVISOS.test(l.texto)).map((l) => l.texto)
  const lineas = d.lineas.filter((l) => l.tipo !== 'meta')
  const recortado = lineas.length > MAX_LINEAS

  if (cargando) return <div className="vc-diff"><p className="tareas-vacio">Cargando diferencias…</p></div>
  if (binario) return <div className="vc-diff"><EstadoVacio variante="compacto" icono={<IconoArchivo />} titulo="Archivo binario" texto="No se puede mostrar la diferencia de un archivo binario." /></div>
  if (!texto.trim()) return <div className="vc-diff"><EstadoVacio variante="compacto" icono={<IconoArchivo />} titulo={vacio} /></div>

  return (
    <div className="vc-diff">
      <div className="vc-diff-cab">
        <strong>{titulo}</strong>
        <span className="vc-mas">+{d.adiciones}</span>
        <span className="vc-menos">−{d.eliminaciones}</span>
        {avisos.map((a) => (
          <span key={a} className="chip">
            {a}
          </span>
        ))}
      </div>
      <div className="vc-diff-cuerpo" role="table" aria-label="Diferencias">
        {lineas.slice(0, MAX_LINEAS).map((l, i) => (
          <div key={i} className={`vc-l vc-l-${l.tipo}`} role="row">
            <span className="vc-n">{l.viejo ?? ''}</span>
            <span className="vc-n">{l.nuevo ?? ''}</span>
            <span className="vc-signo">{l.tipo === 'add' ? '+' : l.tipo === 'del' ? '−' : ''}</span>
            <span className="vc-t">{l.texto || ' '}</span>
          </div>
        ))}
        {(recortado || truncado) && <p className="tareas-vacio">Diferencia muy grande: se muestra solo el principio.</p>}
      </div>
    </div>
  )
}
