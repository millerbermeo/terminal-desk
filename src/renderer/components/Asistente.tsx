import { useState, type ReactNode } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import { useAgente } from '../agente/useAgente'
import { ChatAgente } from './ChatAgente'
import { CredencialesAgente } from './CredencialesAgente'
import { ComandosAgente } from './ComandosAgente'
import { EvalsAgente } from './EvalsAgente'
import { MemoriaAgente } from './MemoriaAgente'
import { PermisosAgente } from './PermisosAgente'
import { RamasAgente } from './RamasAgente'
import { TrazasAgente } from './TrazasAgente'

type Pestana = 'chat' | 'trazas' | 'memoria' | 'permisos' | 'credenciales' | 'comandos' | 'ramas' | 'evals'
const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'chat', nombre: 'Conversación' },
  { id: 'trazas', nombre: 'Trazas' },
  { id: 'memoria', nombre: 'Memoria' },
  { id: 'permisos', nombre: 'Permisos' },
  { id: 'credenciales', nombre: 'Credenciales' },
  { id: 'comandos', nombre: 'Comandos /' },
  { id: 'ramas', nombre: 'Ramas' },
  { id: 'evals', nombre: 'Evals' }
]

interface Props {
  datos: DatosProyectos
  visible: boolean
}

/** Asistente de desarrollo: conversación con agentes, trazas, memoria, ramas aisladas y evals. */
export function Asistente({ datos, visible }: Props) {
  const agente = useAgente() // siempre montado: la conversación y sus eventos no se pierden al cambiar de pantalla
  const [pestana, setPestana] = useState<Pestana>('chat')
  return (
    <main className="asistente" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="ag-pestanas" role="tablist">
        {PESTANAS.map((p) => (
          <button key={p.id} role="tab" aria-selected={pestana === p.id} className={pestana === p.id ? 'on' : ''} onClick={() => setPestana(p.id)}>
            {p.nombre}
            {p.id === 'chat' && agente.enCurso && <span className="punto" />}
          </button>
        ))}
      </div>
      <div className="ag-cuerpo">
        <div className="ag-vista" style={{ display: pestana === 'chat' ? 'flex' : 'none' }}>
          <ChatAgente datos={datos} agente={agente} />
        </div>
        <div className="ag-vista scroll" style={{ display: pestana === 'trazas' ? 'flex' : 'none' }}>
          <TrazasAgente visible={visible && pestana === 'trazas'} />
        </div>
        <div className="ag-vista scroll" style={{ display: pestana === 'memoria' ? 'block' : 'none' }}>
          <MemoriaAgente datos={datos} visible={visible && pestana === 'memoria'} />
        </div>
        <div className="ag-vista scroll" style={{ display: pestana === 'permisos' ? 'block' : 'none' }}>
          <AmbitoGlobal datos={datos}>{(ambito) => <PermisosAgente {...(ambito ? { proyectoId: ambito } : {})} visible={visible && pestana === 'permisos'} />}</AmbitoGlobal>
        </div>
        <div className="ag-vista scroll" style={{ display: pestana === 'credenciales' ? 'block' : 'none' }}>
          <CredencialesAgente datos={datos} visible={visible && pestana === 'credenciales'} />
        </div>
        <div className="ag-vista scroll" style={{ display: pestana === 'comandos' ? 'block' : 'none' }}>
          <AmbitoGlobal datos={datos}>{(ambito) => <ComandosAgente {...(ambito ? { proyectoId: ambito } : {})} visible={visible && pestana === 'comandos'} />}</AmbitoGlobal>
        </div>
        <div className="ag-vista scroll" style={{ display: pestana === 'ramas' ? 'block' : 'none' }}>
          <RamasAgente datos={datos} visible={visible && pestana === 'ramas'} />
        </div>
        <div className="ag-vista scroll" style={{ display: pestana === 'evals' ? 'block' : 'none' }}>
          <EvalsAgente visible={visible && pestana === 'evals'} />
        </div>
      </div>
    </main>
  )
}

/** Elige el ámbito (global o un proyecto) y pinta su contenido: pestañas «Permisos» y «Comandos /». */
function AmbitoGlobal({ datos, children }: { datos: DatosProyectos; children: (ambito: string) => ReactNode }) {
  const [ambito, setAmbito] = useState('')
  return (
    <div className="mem">
      <div className="ag-opciones">
        <select value={ambito} onChange={(e) => setAmbito(e.target.value)} aria-label="Ámbito">
          <option value="">Global (todos los proyectos)</option>
          {datos.proyectos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>
      {children(ambito)}
    </div>
  )
}
