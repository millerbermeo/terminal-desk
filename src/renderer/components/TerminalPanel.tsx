import { memo, useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface Props {
  id: string
  cwd?: string
  proveedorId?: string
  visible: boolean
  activa: boolean
  onActivar: (id: string) => void
}

export const TerminalPanel = memo(function TerminalPanel({ id, cwd, proveedorId, visible, activa, onActivar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  useEffect(() => {
    const el = contenedor.current!
    const t = new Terminal({
      fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', Menlo, Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: '#0f1115',
        foreground: '#d7dae0',
        cursor: '#7aa2f7',
        selectionBackground: '#33467c',
        black: '#1a1d23', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
        blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#c0caf5',
        brightBlack: '#414868', brightRed: '#ff899d', brightGreen: '#b9f27c', brightYellow: '#ffc777',
        brightBlue: '#9ab8ff', brightMagenta: '#c9aaff', brightCyan: '#a4daff', brightWhite: '#e6ebff'
      }
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)))
    t.open(el)

    try {
      const gl = new WebglAddon()
      gl.onContextLoss(() => gl.dispose())
      t.loadAddon(gl)
    } catch {
      // sin WebGL: xterm usa el renderer DOM
    }

    // Ctrl+Shift+C / Ctrl+Shift+V; Ctrl+C copia solo si hay selección.
    t.attachCustomKeyEventHandler((e) => {
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
    void window.api.terminal.crear({ cols: t.cols, rows: t.rows, cwd, proveedorId }).then((pid) => {
      if (!vivo) {
        window.api.terminal.cerrar(pid)
        return
      }
      ptyId = pid
      bajas.push(
        window.api.terminal.onDatos((e) => e.id === pid && t.write(e.datos)),
        window.api.terminal.onSalida((e) => e.id === pid && t.write('\r\n[proceso terminado]\r\n'))
      )
      const entrada = t.onData((d) => window.api.terminal.escribir(pid, d))
      bajas.push(() => entrada.dispose())
      ajustarYa()
    })

    const ro = new ResizeObserver(ajustar)
    ro.observe(el)

    return () => {
      vivo = false
      ro.disconnect()
      clearTimeout(temporizador)
      bajas.forEach((b) => b())
      if (ptyId) window.api.terminal.cerrar(ptyId)
      t.dispose()
    }
  }, [id])

  useEffect(() => {
    if (visible && activa) term.current?.focus()
  }, [visible, activa])

  return <div ref={contenedor} className="terminal" onMouseDown={() => onActivar(id)} />
})

