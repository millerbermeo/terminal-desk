import { useEffect, useMemo, useState } from 'react'
import type { BibliotecaAgentes, DatosProyectos, Recurso } from '@shared/modelos'
import type { RecursoCarpeta } from '@shared/ipc'
import { activosDe } from '@shared/agentes'

interface Props {
  datos: DatosProyectos
  biblioteca: BibliotecaAgentes
  destino: { tipo: 'grupo' | 'proyecto'; id: string }
  onBiblioteca: (b: BibliotecaAgentes) => void
  onCerrar: () => void
}

/**
 * Copia la configuración de agentes y skills de OTRO proyecto al destino elegido: activa aquí los compartidos que allí están activos
 * (por proyecto o por su grupo) y, si se pide, copia los archivos `.claude/agents|skills` del repo. Solo suma: nunca desactiva ni pisa.
 */
export function CopiarConfig({ datos, biblioteca, destino, onBiblioteca, onCerrar }: Props) {
  const orígenes = datos.proyectos.filter((p) => !(destino.tipo === 'proyecto' && p.id === destino.id))
  const [origenId, setOrigenId] = useState(orígenes[0]?.id ?? '')
  const [conArchivos, setConArchivos] = useState(false)
  const [archivos, setArchivos] = useState<RecursoCarpeta[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  const origen = datos.proyectos.find((p) => p.id === origenId)
  const proyectoDestino = destino.tipo === 'proyecto' ? datos.proyectos.find((p) => p.id === destino.id) : undefined
  const nombreDestino = destino.tipo === 'grupo' ? datos.grupos.find((g) => g.id === destino.id)?.nombre : proyectoDestino?.nombre

  // Lo que el origen tiene activo (compartidos, vengan de su proyecto o de su grupo)
  const delOrigen = useMemo(() => (origen ? activosDe(biblioteca, origen).filter((a) => a.origen !== 'individual').map((a) => a.recurso) : []), [biblioteca, origen])
  // Lo que el destino ya tiene (propio o heredado del grupo)
  const yaEnDestino = useMemo(() => {
    const grupoId = destino.tipo === 'grupo' ? destino.id : proyectoDestino?.grupo
    const s = new Set<string>((grupoId && biblioteca.activaciones.grupos[grupoId]) || [])
    if (destino.tipo === 'proyecto') (biblioteca.activaciones.proyectos[destino.id] ?? []).forEach((id) => s.add(id))
    return s
  }, [biblioteca, destino, proyectoDestino])
  const nuevos: Recurso[] = delOrigen.filter((r) => !yaEnDestino.has(r.id))

  useEffect(() => {
    setArchivos([])
    if (origenId) void window.api.agentes.delProyecto(origenId).then(setArchivos).catch(() => setArchivos([]))
  }, [origenId])

  useEffect(() => {
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !trabajando) onCerrar()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [trabajando, onCerrar])

  const copiar = async (): Promise<void> => {
    setTrabajando(true)
    const partes: string[] = []
    try {
      let ultima: BibliotecaAgentes | undefined
      for (const r of nuevos) ultima = await window.api.agentes.activar(destino, r.id, true)
      if (ultima) onBiblioteca(ultima)
      partes.push(`${nuevos.length} activados`)
      if (conArchivos && proyectoDestino && archivos.length) {
        const res = await window.api.agentes.copiar({ origenId, destinoId: proyectoDestino.id, items: archivos.map((a) => ({ tipo: a.tipo, clave: a.clave })) })
        const n = (e: string): number => res.filter((r) => r.estado === e).length
        partes.push(`${n('copiado')} archivos copiados`)
        if (n('existe')) partes.push(`${n('existe')} ya existían (no se tocaron)`)
        if (n('error')) partes.push(`${n('error')} con error: ${res.find((r) => r.estado === 'error')?.mensaje ?? ''}`)
      }
      setResultado(partes.join(' · '))
    } catch (err) {
      setResultado(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTrabajando(false)
    }
  }

  const nada = nuevos.length === 0 && !(conArchivos && archivos.length)

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && !trabajando && onCerrar()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Copiar de otro proyecto">
        <div className="modal-cab">
          <h3>Copiar a «{nombreDestino}»</h3>
        </div>
        <div className="modal-cuerpo">
          {orígenes.length === 0 ? (
            <p className="modal-texto">No hay otros proyectos de los que copiar.</p>
          ) : (
            <>
              <label className="campo">
                <span>Copiar desde el proyecto</span>
                <select value={origenId} onChange={(e) => (setOrigenId(e.target.value), setResultado(null))}>
                  {orígenes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <p className="modal-texto">
                {delOrigen.length} activos en «{origen?.nombre}» · <b>{nuevos.length}</b> se activarán aquí
                {delOrigen.length - nuevos.length > 0 ? ` (${delOrigen.length - nuevos.length} ya lo estaban)` : ''}.
              </p>
              {nuevos.length > 0 && (
                <p className="modal-texto mono" style={{ maxHeight: 140, overflow: 'auto' }}>
                  {nuevos.map((r) => r.nombre).join(', ')}
                </p>
              )}
              {proyectoDestino && (
                <label className="ak-fila" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={conArchivos} disabled={archivos.length === 0} onChange={(e) => setConArchivos(e.target.checked)} />
                  <span className="ak-fila-txt">
                    <strong>Copiar también los archivos de .claude/ del repo</strong>
                    <span>
                      {archivos.length ? `${archivos.length} (agentes y skills propios del proyecto). Lo que ya exista no se pisa.` : 'El proyecto de origen no trae agentes ni skills en .claude/'}
                    </span>
                  </span>
                </label>
              )}
              {resultado && <p className="modal-texto">{resultado}</p>}
            </>
          )}
        </div>
        <div className="modal-acciones">
          <button onClick={onCerrar} disabled={trabajando}>
            {resultado ? 'Cerrar' : 'Cancelar'}
          </button>
          {!resultado && (
            <button className="primario" disabled={trabajando || nada || !origen} onClick={() => void copiar()}>
              {trabajando ? 'Copiando…' : 'Copiar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
