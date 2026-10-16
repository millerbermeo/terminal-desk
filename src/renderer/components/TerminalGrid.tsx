import { TerminalPanel } from './TerminalPanel'
import type { TerminalInfo } from '../App'

export type Modo = 'rejilla' | 'pestanas'

interface Props {
  terminales: TerminalInfo[]
  activa: string | null
  modo: Modo
  onActivar: (id: string) => void
  onCerrar: (id: string) => void
}

export function TerminalGrid({ terminales, activa, modo, onActivar, onCerrar }: Props) {
  const columnas = Math.ceil(Math.sqrt(terminales.length)) || 1

  return (
    <div className="area">
      {modo === 'pestanas' && (
        <div className="pestanas">
          {terminales.map((t) => (
            <div key={t.id} className={`pestana${t.id === activa ? ' activa' : ''}`} onClick={() => onActivar(t.id)}>
              <span>{t.titulo}</span>
              <button
                title="Cerrar"
                onClick={(e) => {
                  e.stopPropagation()
                  onCerrar(t.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={`paneles ${modo}`}
        style={modo === 'rejilla' ? { gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` } : undefined}
      >
        {terminales.length === 0 && <div className="vacio">Sin terminales. Abre un proyecto o crea una nueva.</div>}
        {terminales.map((t) => {
          const visible = modo === 'rejilla' || t.id === activa
          return (
            <div
              key={t.id}
              className={`panel${t.id === activa ? ' activa' : ''}`}
              style={{ display: visible ? 'flex' : 'none' }}
            >
              {modo === 'rejilla' && (
                <div className="panel-barra">
                  <span>{t.titulo}</span>
                  <button title="Cerrar" onClick={() => onCerrar(t.id)}>
                    ×
                  </button>
                </div>
              )}
              <TerminalPanel
                id={t.id}
                cwd={t.cwd}
                visible={visible}
                activa={t.id === activa}
                onFoco={() => onActivar(t.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
