import { useCallback, useEffect, useState } from 'react'
import type { EntradaMemoria, TipoMemoria } from '@shared/core/memoria'
import type { DatosProyectos } from '@shared/modelos'
import { EstadoVacio } from './EstadoVacio'
import { IconoCerebro } from './Iconos'

const TIPOS: { id: TipoMemoria; nombre: string; ayuda: string }[] = [
  { id: 'regla', nombre: 'Regla', ayuda: 'Se incluye siempre en el contexto del agente' },
  { id: 'decision', nombre: 'Decisión técnica', ayuda: 'Se incluye cuando es relevante para la petición' },
  { id: 'hecho', nombre: 'Hecho', ayuda: 'Dato del proyecto, se incluye cuando es relevante' }
]

export function MemoriaAgente({ datos, visible }: { datos: DatosProyectos; visible: boolean }) {
  const [ambito, setAmbito] = useState('') // '' = global
  const [entradas, setEntradas] = useState<EntradaMemoria[]>([])
  const [tipo, setTipo] = useState<TipoMemoria>('regla')
  const [titulo, setTitulo] = useState('')
  const [contenido, setContenido] = useState('')
  const [etiquetas, setEtiquetas] = useState('')
  const [error, setError] = useState('')

  const cargar = useCallback(() => void window.api.core.memoriaListar(ambito || undefined).then(setEntradas), [ambito])
  useEffect(() => {
    if (visible) cargar()
  }, [visible, cargar])

  const guardar = (): void => {
    setError('')
    window.api.core
      .memoriaGuardar({ tipo, titulo, contenido, etiquetas: etiquetas.split(',').map((e) => e.trim()).filter(Boolean) }, ambito || undefined)
      .then((lista) => {
        setEntradas(lista)
        setTitulo('')
        setContenido('')
        setEtiquetas('')
      })
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }

  return (
    <div className="mem">
      <p className="cfg-intro">
        Reglas y decisiones que el agente recuerda entre sesiones. Se guardan fuera de tu repositorio (<code>~/.centro-proyectos/memoria</code>). Las reglas van siempre
        en su contexto; el resto, solo cuando son relevantes para lo que le pides. No guardes credenciales: se rechazan.
      </p>
      <div className="ag-opciones">
        <select value={ambito} onChange={(e) => setAmbito(e.target.value)} aria-label="Ámbito">
          <option value="">Global (todos los proyectos)</option>
          {datos.proyectos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>
      <section className="cfg-grupo">
        {entradas.length === 0 && <EstadoVacio variante="compacto" icono={<IconoCerebro />} titulo="Sin memoria en este ámbito" texto="Las reglas y decisiones que guardes aquí se recordarán en futuras conversaciones." />}
        {entradas.map((e) => (
          <div className="cfg-proyecto mem-fila" key={e.id}>
            <span className={`chip tipo-${e.tipo}`}>{e.tipo}</span>
            <div className="mem-texto">
              <strong>{e.titulo}</strong>
              <span>{e.contenido}</span>
              {e.etiquetas.length > 0 && <small>{e.etiquetas.join(' · ')}</small>}
            </div>
            <button className="peligro" title="Eliminar" onClick={() => void window.api.core.memoriaEliminar(e.id, ambito || undefined).then(setEntradas)}>✕</button>
          </div>
        ))}
      </section>
      <section className="cfg-grupo mem-nueva">
        <div className="cfg-grupo-cab"><h3>Añadir</h3></div>
        <div className="mem-form">
          <div className="ag-opciones">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMemoria)}>
              {TIPOS.map((t) => <option key={t.id} value={t.id} title={t.ayuda}>{t.nombre}</option>)}
            </select>
            <input placeholder="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            <input placeholder="Etiquetas (separadas por comas)" value={etiquetas} onChange={(e) => setEtiquetas(e.target.value)} />
          </div>
          <textarea rows={3} placeholder="Contenido" value={contenido} onChange={(e) => setContenido(e.target.value)} />
          {error && <div className="cfg-error">{error}</div>}
          <div className="cfg-acciones">
            <button className="primario" disabled={!titulo.trim() || !contenido.trim()} onClick={guardar}>Guardar</button>
          </div>
        </div>
      </section>
    </div>
  )
}
