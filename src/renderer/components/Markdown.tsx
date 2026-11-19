import { createContext, Fragment, memo, useContext, useMemo, useState, type ReactNode } from 'react'
import { avisosComando, comandosDeBloque, esBloqueShell, parsearAcciones, parsearInline, parsearMarkdown, type AccionChat, type Bloque, type Inline } from '../agente/markdown'
import { confirmar } from '../confirmar'
import { ProyectoDelChat } from './DiffEdicion'
import { DiagramaMermaid } from './DiagramaMermaid'

/** Evento que recoge `App`: escribe el comando en una terminal del proyecto (la crea si hace falta). */
export const EVENTO_EJECUTAR_EN_TERMINAL = 'odesk:terminal-ejecutar'
export interface DetalleEjecutarEnTerminal {
  proyectoId: string
  comando: string
}

/** Lo que el chat ofrece a los botones de acción: enviar un mensaje como si lo escribiera la persona (con los permisos de siempre). */
export interface AccionesDelChat {
  enviar: (mensaje: string) => void
  /** Hay una ejecución en marcha: los botones esperan. */
  ocupado: boolean
}
export const AccionesChat = createContext<AccionesDelChat | undefined>(undefined)

/** Botones ya pulsados (por clave del bloque): sobreviven a repintar o recargar el chat. Solo en memoria. */
const pulsados = new Map<string, string>()

/** Bloque ```acciones: botones que mandan un mensaje al Asistente. Tras pulsar uno, el grupo queda desactivado marcando el elegido. */
function BotonesAccion({ acciones, clave }: { acciones: AccionChat[]; clave: string }) {
  const chat = useContext(AccionesChat)
  const [elegida, setElegida] = useState<string | undefined>(() => pulsados.get(clave))
  const usado = elegida !== undefined
  return (
    <div className="md-acciones" role="group" aria-label="Acciones sugeridas">
      {acciones.map((a) => (
        <button
          key={a.etiqueta}
          type="button"
          className={`md-accion${elegida === a.etiqueta ? ' elegida' : ''}`}
          disabled={!chat || usado || chat.ocupado}
          title={a.mensaje}
          onClick={() => {
            if (!chat || usado) return
            pulsados.set(clave, a.etiqueta)
            setElegida(a.etiqueta)
            chat.enviar(a.mensaje)
          }}
        >
          {elegida === a.etiqueta ? '✓ ' : ''}
          {a.etiqueta}
        </button>
      ))}
    </div>
  )
}

function InlineVista({ nodos }: { nodos: Inline[] }) {
  return (
    <>
      {nodos.map((n, i) => {
        switch (n.t) {
          case 'texto':
            return <Fragment key={i}>{n.v}</Fragment>
          case 'codigo':
            return <code key={i} className="md-codigo-linea">{n.v}</code>
          case 'negrita':
            return <strong key={i}><InlineVista nodos={n.hijos} /></strong>
          case 'cursiva':
            return <em key={i}><InlineVista nodos={n.hijos} /></em>
          case 'tachado':
            return <del key={i}><InlineVista nodos={n.hijos} /></del>
          case 'enlace':
            return (
              <a key={i} href={n.url} target="_blank" rel="noreferrer noopener" title={n.url}>
                <InlineVista nodos={n.hijos} />
              </a>
            )
        }
      })}
    </>
  )
}

const Texto = ({ v }: { v: string }) => <InlineVista nodos={useMemo(() => parsearInline(v), [v])} />

const IconoCopiar = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
)
const IconoHecho = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5 9-10" />
  </svg>
)
const IconoEjecutar = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 7 5 5-5 5M12 19h7" />
  </svg>
)

const NOMBRE_LENGUAJE: Record<string, string> = { ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', py: 'Python', sh: 'Shell', bash: 'Bash', console: 'Consola', json: 'JSON', yml: 'YAML', yaml: 'YAML', md: 'Markdown', mermaid: 'Diagrama (Mermaid)', css: 'CSS', html: 'HTML', sql: 'SQL', diff: 'Diff', text: 'Texto', txt: 'Texto', plain: 'Texto', plaintext: 'Texto' }

/** Bloques de prosa lista para pegar (mensajes, correos, descripciones de PR): se leen con ajuste de línea, no como código. */
const PROSA = new Set(['text', 'txt', 'plain', 'plaintext', 'markdown', 'md'])

/** Bloque de código: lenguaje, copiar y, si es de shell y hay proyecto, ejecutarlo en una terminal (siempre con confirmación). */
function BloqueCodigo({ lenguaje, codigo }: { lenguaje: string; codigo: string }) {
  const proyectoId = useContext(ProyectoDelChat)
  const [copiado, setCopiado] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const comandos = esBloqueShell(lenguaje) ? comandosDeBloque(lenguaje, codigo) : ''

  const copiar = (): void => {
    void navigator.clipboard.writeText(codigo).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1400)
    })
  }

  const ejecutar = async (): Promise<void> => {
    if (!proyectoId || !comandos) return
    const avisos = avisosComando(comandos)
    const n = comandos.split('\n').length
    const ok = await confirmar({
      titulo: n === 1 ? 'Ejecutar en la terminal' : `Ejecutar ${n} comandos en la terminal`,
      etiqueta: 'Ejecutar',
      tono: avisos.length ? 'peligro' : 'info',
      texto: `${avisos.length ? `⚠ Ojo: ${avisos.join('; ')}.\n\n` : ''}Se escribe en una terminal del proyecto y se ejecuta tal cual:\n\n${comandos.length > 1200 ? `${comandos.slice(0, 1200)}\n…` : comandos}`
    })
    if (!ok) return
    window.dispatchEvent(new CustomEvent<DetalleEjecutarEnTerminal>(EVENTO_EJECUTAR_EN_TERMINAL, { detail: { proyectoId, comando: comandos } }))
    setEnviado(true)
    setTimeout(() => setEnviado(false), 1800)
  }

  return (
    <div className={`md-bloque${PROSA.has(lenguaje) ? ' prosa' : ''}`}>
      <div className="md-bloque-cab">
        <span className="md-bloque-lenguaje">{NOMBRE_LENGUAJE[lenguaje] ?? (lenguaje || 'Código')}</span>
        <span className="md-bloque-acciones">
          {comandos && proyectoId && (
            <button type="button" onClick={() => void ejecutar()} title="Escribe estos comandos en una terminal del proyecto (te pide confirmación)">
              {enviado ? <IconoHecho /> : <IconoEjecutar />}
              {enviado ? 'Enviado' : 'Ejecutar en terminal'}
            </button>
          )}
          <button type="button" onClick={copiar} className={copiado ? 'hecho' : ''} aria-live="polite">
            {copiado ? <IconoHecho /> : <IconoCopiar />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </span>
      </div>
      {lenguaje === 'mermaid' ? <DiagramaMermaid codigo={codigo} /> : <pre className={`md-bloque-codigo${lenguaje === 'diff' ? ' diff' : ''}`}>
        <code>
          {lenguaje === 'diff'
            ? codigo.split('\n').map((l, i) => (
                <span key={i} className={l.startsWith('+') ? 'mas' : l.startsWith('-') ? 'menos' : l.startsWith('@@') ? 'meta' : undefined}>
                  {l}
                  {'\n'}
                </span>
              ))
            : codigo}
        </code>
      </pre>}
    </div>
  )
}

function BloqueVista({ b }: { b: Bloque }): ReactNode {
  switch (b.t) {
    case 'codigo': {
      const acciones = b.lenguaje === 'acciones' ? parsearAcciones(b.codigo) : null
      if (acciones) return <BotonesAccion acciones={acciones} clave={b.codigo} />
      return <BloqueCodigo lenguaje={b.lenguaje} codigo={b.codigo} />
    }
    case 'titulo': {
      const Etiqueta = (`h${Math.min(6, b.nivel + 2)}` as 'h3')
      return <Etiqueta className={`md-titulo n${b.nivel}`}><Texto v={b.texto} /></Etiqueta>
    }
    case 'parrafo':
      return <p className="md-parrafo"><Texto v={b.texto} /></p>
    case 'cita':
      return <blockquote className="md-cita"><MarkdownBloques bloques={parsearMarkdown(b.texto)} /></blockquote>
    case 'regla':
      return <hr className="md-regla" />
    case 'lista': {
      const Etiqueta = b.ordenada ? 'ol' : 'ul'
      return (
        <Etiqueta className="md-lista" {...(b.ordenada && b.inicio !== 1 ? { start: b.inicio } : {})}>
          {b.items.map((it, i) => (
            <li key={i} style={it.nivel ? { marginLeft: it.nivel * 18 } : undefined} className={it.marcado !== undefined ? 'tarea' : undefined}>
              {it.marcado !== undefined && <span className={`md-casilla${it.marcado ? ' on' : ''}`} aria-label={it.marcado ? 'hecho' : 'pendiente'} />}
              <Texto v={it.texto} />
            </li>
          ))}
        </Etiqueta>
      )
    }
    case 'tabla':
      return (
        <div className="md-tabla-marco">
          <table className="md-tabla">
            <thead>
              <tr>{b.cabecera.map((c, i) => <th key={i} style={{ textAlign: b.alineacion[i] === 'der' ? 'right' : b.alineacion[i] === 'centro' ? 'center' : 'left' }}><Texto v={c} /></th>)}</tr>
            </thead>
            <tbody>
              {b.filas.map((f, i) => (
                <tr key={i}>{b.cabecera.map((_, j) => <td key={j} style={{ textAlign: b.alineacion[j] === 'der' ? 'right' : b.alineacion[j] === 'centro' ? 'center' : 'left' }}><Texto v={f[j] ?? ''} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

function MarkdownBloques({ bloques }: { bloques: Bloque[] }) {
  return (
    <>
      {bloques.map((b, i) => (
        <BloqueVista key={i} b={b} />
      ))}
    </>
  )
}

/** Respuesta del Asistente con formato. Memoizado por texto: no se vuelve a analizar mientras otro turno recibe streaming. */
export const Markdown = memo(function Markdown({ texto }: { texto: string }) {
  const bloques = useMemo(() => parsearMarkdown(texto), [texto])
  return (
    <div className="md">
      <MarkdownBloques bloques={bloques} />
    </div>
  )
})
