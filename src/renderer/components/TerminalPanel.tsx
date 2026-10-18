import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { MarcaAgua } from './MarcaAgua'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { IconoChispa, IconoCopiar, IconoPegar, IconoSeleccionar, IconoLimpiar } from './Iconos'
import { fijarSugerencias, SugerenciasTerminal, sugerenciasActivadas } from '../terminal/sugerencias'

interface Props {
  id: string
  cwd?: string
  proveedorId?: string
  proyectoId?: string
  ptyExistente?: string // si viene de otra ventana: se adjunta a ese pty en vez de crear uno
  onPty?: (id: string, ptyId: string) => void
  visible: boolean
  activa: boolean
  onActivar: (id: string) => void
}

/**
 * Chromium reparte unos 16 contextos WebGL por proceso; con muchas celdas (y más ventanas) los más viejos se pierden y dejan la terminal
 * en blanco. Solo las primeras 8 usan WebGL; el resto usa el renderer normal de xterm, que no tiene ese límite.
 */
const MAX_WEBGL = 8
let contextosWebgl = 0

/** ptys que pasan a otra ventana: al desmontar el panel no se matan. */
export const transferidas = new Set<string>()

export const TerminalPanel = memo(function TerminalPanel({ id, cwd, proveedorId, proyectoId, ptyExistente, onPty, visible, activa, onActivar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const alPty = useRef(onPty)
  alPty.current = onPty
  const [menu, setMenu] = useState<{ x: number; y: number; haySeleccion: boolean } | null>(null)

  // Menú contextual (clic derecho). Si el programa de la terminal usa el ratón (vim, tmux, htop…)
  // el clic derecho es suyo; con Mayús+clic derecho se abre igualmente el menú.
  const alMenuContextual = (e: MouseEvent): void => {
    const t = term.current
    if (!t) return
    if (t.modes.mouseTrackingMode !== 'none' && !e.shiftKey) return
    e.preventDefault()
    onActivar(id)
    setMenu({ x: e.clientX, y: e.clientY, haySeleccion: t.hasSelection() })
  }

  useEffect(() => {
    if (!menu) return
    const cerrar = (): void => setMenu(null)
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('mousedown', cerrar)
    window.addEventListener('keydown', tecla, true) // en captura: xterm no deja que la tecla suba hasta window
    window.addEventListener('blur', cerrar)
    window.addEventListener('resize', cerrar)
    return () => {
      window.removeEventListener('mousedown', cerrar)
      window.removeEventListener('keydown', tecla, true)
      window.removeEventListener('blur', cerrar)
      window.removeEventListener('resize', cerrar)
    }
  }, [menu])

  const accion = (f: (t: Terminal) => void): void => {
    const t = term.current
    setMenu(null)
    if (t) {
      f(t)
      t.focus()
    }
  }

  useEffect(() => {
    const el = contenedor.current!
    let liberarWebgl: () => void = () => undefined
    const t = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', Menlo, Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      allowTransparency: true, // deja ver la marca de agua de `.terminal`
      theme: {
        background: '#00000000',
        foreground: '#e4e4e9',
        cursor: '#818cf8',
        selectionBackground: 'rgba(129, 140, 248, 0.32)',
        black: '#16181e', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
        blue: '#818cf8', magenta: '#c084fc', cyan: '#67e8f9', white: '#d4d4dc',
        brightBlack: '#52525e', brightRed: '#fca5a5', brightGreen: '#6ee7b7', brightYellow: '#fde68a',
        brightBlue: '#a5b4fc', brightMagenta: '#d8b4fe', brightCyan: '#a5f3fc', brightWhite: '#f4f4f8'
      }
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)))
    t.open(el)

    try {
      if (contextosWebgl < MAX_WEBGL) {
        const gl = new WebglAddon()
        contextosWebgl++
        liberarWebgl = (): void => {
          liberarWebgl = () => undefined
          contextosWebgl--
        }
        gl.onContextLoss(() => {
          gl.dispose()
          liberarWebgl()
          window.api.registro.enviar({ level: 'info', kind: 'webgl-context-lost', message: 'Se perdió el contexto WebGL de una terminal (usa el renderer normal)', context: { activos: contextosWebgl } })
        })
        t.loadAddon(gl)
      }
    } catch {
      liberarWebgl()
      // sin WebGL: xterm usa el renderer DOM
    }

    let ptyActual: string | null = null
    const sugerencias = new SugerenciasTerminal(t, () => ptyActual)

        // Ctrl+Shift+C / Ctrl+Shift+V; Ctrl+C copia solo si hay selección.
    // Pulsar y soltar Mayús solo (sin otra tecla en medio: las mayúsculas al escribir no cuentan) acepta la sugerencia entera.
    let mayusSola = false
    t.attachCustomKeyEventHandler((e) => {
      if (e.key === 'Shift') {
        if (e.type === 'keydown') mayusSola = !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey
        else if (e.type === 'keyup' && mayusSola) {
          mayusSola = false
          sugerencias.aceptar(false)
        }
        return true
      }
      if (e.type === 'keydown') mayusSola = false
      if (e.type === 'keydown' && !e.shiftKey && !e.altKey && !e.metaKey) {
        // Tab, → o End aceptan todo; Ctrl+→ una palabra; Ctrl+E (fin de línea en readline) también acepta todo. Sin sugerencia visible la tecla sigue su camino
        // (Tab vuelve a ser el autocompletado normal del shell).
        const aceptada = (e.key === 'Tab' && !e.ctrlKey && sugerencias.aceptar(false)) || (e.key === 'ArrowRight' && sugerencias.aceptar(e.ctrlKey)) || (e.key === 'End' && !e.ctrlKey && sugerencias.aceptar(false)) || (e.ctrlKey && e.key.toLowerCase() === 'e' && sugerencias.aceptar(false))
        if (aceptada) {
          e.preventDefault() // sin esto, Tab movería el foco fuera de la terminal
          return false
        }
      }
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true
      const k = e.key.toLowerCase()
      if (k === 'c' && (e.shiftKey || t.hasSelection())) {
        if (t.hasSelection()) void navigator.clipboard.writeText(t.getSelection())
        return false
      }
      if (k === 'v' && e.shiftKey) {
        e.preventDefault() // evita doble pegado nativo
        void navigator.clipboard.readText().then((txt) => t.paste(txt))
        return false
      }
      return true
    })

    term.current = t
    fit.current = f

    let vivo = true
    let ptyId: string | null = null
    const bajas: Array<() => void> = []

    // Redimensionar un panel dispara muchos eventos: se ajusta como mucho cada INTERVALO ms
    // (con ajuste final garantizado) para no saturar ni el render de xterm ni el SIGWINCH del shell.
    const INTERVALO = 50
    let ultimo = 0
    let temporizador = 0
    const ajustarYa = (): void => {
      ultimo = performance.now()
      if (!el.offsetWidth || !el.offsetHeight) return
      f.fit()
      // solo se avisa al pty si el tamaño en celdas cambió respecto al último enviado
      if (ptyId && (t.cols !== enviado.cols || t.rows !== enviado.rows)) {
        enviado = { cols: t.cols, rows: t.rows }
        window.api.terminal.redimensionar(ptyId, t.cols, t.rows)
      }
    }
    const ajustar = (): void => {
      clearTimeout(temporizador)
      const espera = INTERVALO - (performance.now() - ultimo)
      if (espera <= 0) requestAnimationFrame(ajustarYa)
      else temporizador = window.setTimeout(ajustarYa, espera)
    }
    f.fit()
    let enviado = { cols: t.cols, rows: t.rows } // tamaño con el que nace el pty
    const conectar = (pid: string): void => {
      ptyId = pid
      ptyActual = pid
      const entrada = t.onData((d) => window.api.terminal.escribir(pid, d))
      bajas.push(() => entrada.dispose())
    }

    if (ptyExistente) {
      // Viene de otra ventana: se escucha primero (en cola), se repinta lo que ya mostraba y se suelta la cola.
      const pid = ptyExistente
      ptyId = pid
      let cola: { datos: string; fin: number }[] | null = []
      bajas.push(
        window.api.terminal.onDatos((e) => {
          if (e.id !== pid) return
          if (cola) cola.push({ datos: e.datos, fin: e.fin })
          else t.write(e.datos)
        }),
        window.api.terminal.onSalida((e) => e.id === pid && t.write('\r\n[proceso terminado]\r\n'))
      )
      void window.api.terminal.adjuntar(pid, t.cols, t.rows).then(({ texto, fin }) => {
        if (!vivo) return
        t.write(texto)
        // lo que ya viene incluido en el historial (fin <= histórico) no se vuelve a escribir
        cola?.forEach((d) => d.fin > fin && t.write(d.datos))
        cola = null
        conectar(pid)
        ajustarYa()
      })
    } else {
      void window.api.terminal.crear({ cols: t.cols, rows: t.rows, cwd, proveedorId, proyectoId }).then((pid) => {
        if (!vivo) {
          window.api.terminal.cerrar(pid)
          return
        }
        bajas.push(
          window.api.terminal.onDatos((e) => e.id === pid && t.write(e.datos)),
          window.api.terminal.onSalida((e) => e.id === pid && t.write('\r\n[proceso terminado]\r\n'))
        )
        conectar(pid)
        alPty.current?.(id, pid)
        ajustarYa()
      })
    }

    const ro = new ResizeObserver(ajustar)
    ro.observe(el)

    return () => {
      vivo = false
      ro.disconnect()
      clearTimeout(temporizador)
      bajas.forEach((b) => b())
      sugerencias.destruir()
      liberarWebgl()
      if (ptyId && !transferidas.delete(ptyId)) window.api.terminal.cerrar(ptyId)
      t.dispose()
    }
  }, [id])

  useEffect(() => {
    if (visible && activa) term.current?.focus()
  }, [visible, activa])

  return (
    <>
      <div className="terminal-caja" onMouseDown={() => onActivar(id)} onContextMenu={alMenuContextual}>
        <MarcaAgua />
        <div ref={contenedor} className="terminal" />
      </div>
      {menu &&
        createPortal(
          <div
            className="menu-ia menu-terminal"
            role="menu"
            style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 240) }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button role="menuitem" disabled={!menu.haySeleccion} onClick={() => accion((t) => void navigator.clipboard.writeText(t.getSelection()))}>
              <IconoCopiar />
              <span>Copiar</span>
              <kbd>Ctrl+Shift+C</kbd>
            </button>
            <button role="menuitem" onClick={() => accion((t) => void navigator.clipboard.readText().then((txt) => t.paste(txt)))}>
              <IconoPegar />
              <span>Pegar</span>
              <kbd>Ctrl+Shift+V</kbd>
            </button>
            <div className="menu-sep" />
            <button role="menuitem" onClick={() => accion((t) => t.selectAll())}>
              <IconoSeleccionar />
              <span>Seleccionar todo</span>
            </button>
            <button role="menuitem" onClick={() => accion((t) => t.clear())}>
              <IconoLimpiar />
              <span>Limpiar pantalla</span>
            </button>
            <div className="menu-sep" />
            <button role="menuitem" onClick={() => accion(() => fijarSugerencias(!sugerenciasActivadas()))} title="Sugiere en gris comandos que ya escribiste; Tab, Mayús (pulsar y soltar) o → los aceptan, Ctrl+→ una palabra">
              <IconoChispa />
              <span>Sugerencias del historial: {sugerenciasActivadas() ? 'activadas' : 'desactivadas'}</span>
            </button>
          </div>,
          document.body
        )}
    </>
  )
})

