import { useCallback, useEffect, useState } from 'react'
import type { BibliotecaAgentes, DatosProyectos, Recurso, TipoRecurso } from '@shared/modelos'
import { IconoCerrar } from './Iconos'

interface Props {
  tipo: TipoRecurso
  inicial?: Recurso // undefined = nuevo
  datos: DatosProyectos
  onGuardado: (b: BibliotecaAgentes) => void
  onCerrar: () => void
}

const HERRAMIENTAS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch']
const MODELOS = [
  { valor: '', texto: 'Heredar (el de la sesión)' },
  { valor: 'sonnet', texto: 'Sonnet' },
  { valor: 'opus', texto: 'Opus' },
  { valor: 'haiku', texto: 'Haiku' }
]

export function ModalRecurso({ tipo, inicial, datos, onGuardado, onCerrar }: Props) {
  const esAgente = tipo === 'agente'
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '')
  const [contenido, setContenido] = useState(inicial?.contenido ?? '')
  const [herramientas, setHerramientas] = useState<string[]>(inicial?.herramientas ?? [])
  const [modelo, setModelo] = useState(inicial?.modelo ?? '')
  const [ambito, setAmbito] = useState<'compartido' | 'proyecto'>(inicial?.ambito ?? 'compartido')
  const [proyectoId, setProyectoId] = useState(inicial?.proyectoId ?? datos.proyectos[0]?.id ?? '')
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

  const alternar = (h: string): void => setHerramientas((hs) => (hs.includes(h) ? hs.filter((x) => x !== h) : [...hs, h]))
  const valido = nombre.trim() && descripcion.trim() && contenido.trim()

  const enviar = async (): Promise<void> => {
    setGuardando(true)
    const res = await window.api.agentes
      .guardar({
        id: inicial?.id ?? '',
        tipo,
        nombre,
        descripcion,
        contenido,
        ambito,
        ...(ambito === 'proyecto' ? { proyectoId } : {}),
        ...(esAgente ? { herramientas, modelo } : {})
      })
      .catch(() => ({ ok: false as const, mensaje: 'No se pudo guardar. Reinicia la app (pnpm dev)' }))
    setGuardando(false)
    if (!res.ok) return setError(res.mensaje)
    onGuardado(res.biblioteca)
    salir()
  }

  const limpio = <T,>(f: (v: T) => void) => (v: T): void => {
    setError(null)
    f(v)
  }

  return (
    <div className={`modal-fondo${cerrando ? ' saliendo' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && salir()}>
      <form
        className="modal modal-ancho"
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault()
          if (valido && !guardando) void enviar()
        }}
      >
        <div className="modal-cab">
          <h3>
            {inicial ? 'Editar' : 'Nuevo'} {esAgente ? 'subagente' : 'skill'}
          </h3>
          <button type="button" className="icono" onClick={salir} title="Cerrar (Esc)">
            <IconoCerrar />
          </button>
        </div>

        <label className="ancho">
          Nombre
          <input className="mono" value={nombre} onChange={(e) => limpio(setNombre)(e.target.value)} placeholder={esAgente ? 'revisor-de-codigo' : 'revisar-sql'} autoFocus />
          <span className="ayuda">Se convierte en kebab-case (letras, números y guiones).</span>
        </label>
        <label className="ancho">
          Descripción
          <input value={descripcion} onChange={(e) => limpio(setDescripcion)(e.target.value)} placeholder={esAgente ? 'Revisa cambios de código buscando bugs. Úsalo tras editar.' : 'Revisa consultas SQL: índices, N+1 y seguridad.'} />
          <span className="ayuda">Claude la lee para decidir cuándo usarlo: sé concreto sobre el cuándo.</span>
        </label>
        <label className="ancho">
          {esAgente ? 'Prompt del subagente' : 'Instrucciones de la skill'}
          <textarea
            className="mono"
            rows={9}
            value={contenido}
            onChange={(e) => limpio(setContenido)(e.target.value)}
            placeholder={esAgente ? 'Eres un revisor de código estricto. Devuelve solo problemas reales…' : 'Cuando se pida revisar SQL, comprueba…'}
          />
        </label>

        {esAgente && (
          <div className="fila-opciones">
            <div className="ancho">
              <span className="etiqueta">Herramientas</span>
              <div className="chips-sel">
                {HERRAMIENTAS.map((h) => (
                  <label key={h} className={`chip-sel${herramientas.includes(h) ? ' on' : ''}`}>
                    <input type="checkbox" checked={herramientas.includes(h)} onChange={() => alternar(h)} />
                    {h}
                  </label>
                ))}
              </div>
              <span className="ayuda">Sin marcar ninguna = tiene acceso a todas.</span>
            </div>
            <label>
              Modelo
              <select value={modelo} onChange={(e) => setModelo(e.target.value)}>
                {MODELOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.texto}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="fila-opciones">
          <label>
            Ámbito
            <select value={ambito} onChange={(e) => setAmbito(e.target.value as 'compartido' | 'proyecto')}>
              <option value="compartido">Compartido (se activa por grupo o proyecto)</option>
              <option value="proyecto">Individual (de un solo proyecto)</option>
            </select>
          </label>
          {ambito === 'proyecto' && (
            <label>
              Proyecto
              <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)}>
                {datos.proyectos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <div className="cfg-error">{error}</div>}
        <div className="cfg-acciones">
          <button type="submit" className="primario" disabled={!valido || guardando}>
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
