import type { IDecoration, IMarker, Terminal } from '@xterm/xterm'
import { buscarSugerencia, comandoRegistrable, escritoEnLinea, primeraPalabra, terminaEnPrompt } from '@shared/sugerencias'

const CLAVE = 'odesk:sugerencias-terminal'
const FRESCO_MS = 1500 // cuánto vale «el shell está esperando una orden» sin volver a preguntarlo

/** ¿Están activadas las sugerencias de historial? (por defecto sí; se cambia desde el menú de la terminal) */
export function sugerenciasActivadas(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== '0'
  } catch {
    return true
  }
}

export function fijarSugerencias(activadas: boolean): void {
  try {
    localStorage.setItem(CLAVE, activadas ? '1' : '0')
  } catch {
    // sin almacenamiento: vale solo para esta sesión de la terminal
  }
}

// Historial compartido por todas las terminales de esta ventana: una sola lectura.
let historial: string[] = []
let cargado: Promise<void> | undefined
const cargarHistorial = (): Promise<void> => (cargado ??= window.api.terminal.historialComandos().then((h) => void (historial = h), () => undefined))

function recordar(comando: string): void {
  if (!comandoRegistrable(comando)) return
  historial = [comando, ...historial.filter((c) => c !== comando)].slice(0, 4000)
  window.api.terminal.registrarComando(comando)
}

/**
 * Sugerencias de historial en gris mientras se escribe (como fish o zsh-autosuggestions), válidas para cualquier shell. La verdad es
 * siempre la pantalla de xterm: se sabe dónde acaba el prompt (el cursor antes de la primera tecla) y lo escrito es lo que hay entre ahí
 * y el cursor, así que flechas, borrados o el historial del shell no pueden descuadrarlo. Solo se muestra si el shell está esperando
 * una orden (no dentro de vim, de un CLI o de una pregunta de contraseña) y la línea no ha cambiado de fila.
 *
 * Se acepta con → (todo) o Ctrl+→ (una palabra). El comando se escribe en el shell como si lo tecleara el usuario.
 */
export class SugerenciasTerminal {
  private fila: number | null = null // línea absoluta del prompt; null = no se sabe dónde está
  private columna = 0 // columna donde acaba el prompt
  private sufijo = ''
  private decoracion: { marca: IMarker; deco: IDecoration } | null = null
  private enShell = { valor: false, hasta: 0 }
  private temporizador = 0
  private muerto = false
  private generacion = 0 // sube con cada tecla o cambio de pantalla: una comprobación en curso con otra generación se descarta
  private mostradoPara: { fila: number; x: number; escrito: string } | null = null
  private readonly bajas: Array<() => void> = []

  constructor(
    private readonly t: Terminal,
    private readonly ptyId: () => string | null
  ) {
    void cargarHistorial()
    const datos = t.onData((d) => this.alTeclear(d))
    const escrito = t.onWriteParsed(() => this.alCambiarPantalla())
    this.bajas.push(
      () => datos.dispose(),
      () => escrito.dispose()
    )
  }

  destruir(): void {
    this.muerto = true
    clearTimeout(this.temporizador)
    this.bajas.forEach((b) => b())
    this.quitarDecoracion()
  }

  /** ¿Hay una sugerencia a la vista que → o Ctrl+→ aceptarían? Si la hay, la acepta y devuelve `true`. */
  aceptar(soloPalabra: boolean): boolean {
    const id = this.ptyId()
    if (!id || !this.decoracion || !this.sufijo) return false
    const texto = soloPalabra ? primeraPalabra(this.sufijo) : this.sufijo
    this.ocultar()
    window.api.terminal.escribir(id, texto)
    return true
  }

  private ocultar(): void {
    this.sufijo = ''
    this.mostradoPara = null
    this.quitarDecoracion()
  }

  private quitarDecoracion(): void {
    this.decoracion?.deco.dispose()
    this.decoracion?.marca.dispose()
    this.decoracion = null
  }

  /** Si lo escrito o el cursor ya no son aquellos para los que se dibujó la sugerencia, se quita al instante (sin esperar al refresco). */
  private alCambiarPantalla(): void {
    this.generacion++
    const m = this.mostradoPara
    if (m) {
      const { fila, x } = this.posicionActual()
      if (fila !== m.fila || x !== m.x || this.escritoAhora() !== m.escrito) this.ocultar()
    }
    this.programar()
  }

  private posicionActual(): { fila: number; x: number } {
    const b = this.t.buffer.active
    return { fila: b.baseY + b.cursorY, x: b.cursorX }
  }

  private alTeclear(d: string): void {
    this.generacion++
    this.ocultar()
    if (d === '\r') {
      this.registrarLineaActual()
      this.fila = null
      return
    }
    if (d === '\x03' || d === '\x04') {
      this.fila = null // Ctrl+C / Ctrl+D: el shell dibuja un prompt nuevo
      return
    }
    if (this.fila === null) this.capturarPrompt()
    this.programar()
  }

  /** Justo antes de la primera tecla el cursor está al final del prompt: ahí empieza lo que el usuario escribe. */
  private capturarPrompt(): void {
    if (this.t.buffer.active.type !== 'normal') return
    const { fila, x } = this.posicionActual()
    const linea = this.t.buffer.active.getLine(fila)
    if (!linea || linea.isWrapped) return
    if (terminaEnPrompt(linea.translateToString(false, 0, x))) {
      this.fila = fila
      this.columna = x
    }
  }

  private escritoAhora(): string | undefined {
    const b = this.t.buffer.active
    if (this.fila === null || b.type !== 'normal' || b.viewportY !== b.baseY) return undefined
    const { fila, x } = this.posicionActual()
    if (fila !== this.fila) return undefined
    const linea = b.getLine(fila)
    if (!linea) return undefined
    if (!terminaEnPrompt(linea.translateToString(false, 0, this.columna))) return undefined // la pantalla ya no muestra ese prompt
    return escritoEnLinea({ antesDelCursor: linea.translateToString(false, 0, x), despuesDelCursor: linea.translateToString(true, x) }, this.columna)
  }

  /** ¿Espera el shell una orden? Se pregunta al proceso principal y se recuerda un instante. */
  private async shellLibre(): Promise<boolean> {
    const id = this.ptyId()
    if (!id) return false
    const ahora = Date.now()
    if (ahora < this.enShell.hasta) return this.enShell.valor
    const valor = await window.api.terminal.enShell(id).catch(() => false)
    this.enShell = { valor, hasta: Date.now() + FRESCO_MS }
    return valor
  }

  private registrarLineaActual(): void {
    const escrito = this.escritoAhora()
    // Solo si hace un momento se comprobó que quien estaba en primer plano era el shell (la comprobación no puede esperar al Enter).
    if (escrito && this.enShell.valor && Date.now() < this.enShell.hasta + 4000) recordar(escrito)
  }

  private programar(): void {
    clearTimeout(this.temporizador)
    this.temporizador = window.setTimeout(() => void this.refrescar(), 20)
  }

  private async refrescar(): Promise<void> {
    if (this.muerto) return
    if (!sugerenciasActivadas() || !this.t.element?.offsetParent) return this.ocultar()
    const escrito = this.escritoAhora()
    if (!escrito || !escrito.trim()) return this.ocultar()
    const generacion = this.generacion
    const libre = await this.shellLibre() // también sin sugerencia: sirve para saber si lo que se ejecute después es del shell
    await cargarHistorial()
    if (!libre || this.muerto || generacion !== this.generacion || this.escritoAhora() !== escrito) return this.ocultar() // cambió mientras se preguntaba
    const completa = buscarSugerencia(historial, escrito)
    if (!completa) return this.ocultar()
    this.mostrar(completa.slice(escrito.length), escrito)
  }

  /**
   * La sugerencia es una decoración de xterm anclada a la fila del cursor: la propia terminal la coloca en su cuadrícula, así que queda
   * exactamente tras el último carácter escrito, con cualquier tamaño de letra, zoom o renderer.
   */
  private mostrar(sufijo: string, escrito: string): void {
    const { fila, x } = this.posicionActual()
    const visible = [...sufijo].slice(0, Math.max(0, this.t.cols - x))
    if (!visible.length) return this.ocultar()
    this.quitarDecoracion()
    const marca = this.t.registerMarker(0)
    if (!marca) return this.ocultar()
    const deco = this.t.registerDecoration({ marker: marca, x, width: visible.length, height: 1, layer: 'top' })
    if (!deco) {
      marca.dispose()
      return this.ocultar()
    }
    deco.onRender((el) => {
      el.classList.add('terminal-sugerencia')
      el.setAttribute('aria-hidden', 'true')
      el.style.fontFamily = this.t.options.fontFamily ?? 'monospace'
      el.style.fontSize = `${this.t.options.fontSize ?? 14}px`
      el.style.lineHeight = el.style.height || 'normal'
      el.replaceChildren(
        ...visible.map((c) => {
          const celda = document.createElement('span')
          celda.textContent = c
          return celda
        })
      )
    })
    this.decoracion = { marca, deco }
    this.sufijo = sufijo
    this.mostradoPara = { fila, x, escrito }
  }
}
