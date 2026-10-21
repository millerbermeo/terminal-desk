/**
 * El renderizador WebGL de xterm guarda los glifos ya dibujados en una textura («atlas»). Tras mucha salida (logs con colores), con la
 * terminal oculta o con fallos del controlador gráfico esa textura se corrompe y las letras salen cambiadas o cortadas. Vaciar el atlas lo
 * arregla: los glifos se vuelven a dibujar desde cero. Este vigilante lo hace solo cuando conviene.
 */
export interface OpcionesVigilante {
  /** Texto escrito desde la última reparación a partir del cual, cuando la salida se calma, se repara. */
  umbral?: number
  /** Tiempo sin salida que cuenta como «calma». */
  calmaMs?: number
  /** Texto acumulado que obliga a reparar aunque la salida no pare nunca (por ejemplo, `tail -f`). */
  umbralDuro?: number
  /** Separación mínima entre dos reparaciones forzadas. */
  minimoMs?: number
}

export class VigilanteAtlas {
  private acumulado = 0
  private temporizador: ReturnType<typeof setTimeout> | undefined
  private ultima = 0
  private readonly o: Required<OpcionesVigilante>

  constructor(
    private readonly reparar: () => void,
    o: OpcionesVigilante = {},
    private readonly ahora: () => number = Date.now
  ) {
    this.o = { umbral: 200_000, calmaMs: 1500, umbralDuro: 2_000_000, minimoMs: 10_000, ...o }
    this.ultima = this.ahora()
  }

  /** Se llama con cada trozo de salida escrito en la terminal. */
  alEscribir(caracteres: number): void {
    this.acumulado += caracteres
    clearTimeout(this.temporizador)
    if (this.acumulado >= this.o.umbralDuro && this.ahora() - this.ultima >= this.o.minimoMs) return this.hacer()
    if (this.acumulado >= this.o.umbral) this.temporizador = setTimeout(() => this.hacer(), this.o.calmaMs)
  }

  /** Reparación hecha por otro motivo (la terminal volvió a verse, cambió el zoom…): empieza de cero la cuenta. */
  alReparar(): void {
    this.acumulado = 0
    this.ultima = this.ahora()
    clearTimeout(this.temporizador)
  }

  destruir(): void {
    clearTimeout(this.temporizador)
  }

  private hacer(): void {
    this.alReparar()
    this.reparar()
  }
}

const CLAVE_SIN_WEBGL = 'terminal:sin-webgl'

/** ¿El usuario desactivó la aceleración gráfica de las terminales (para equipos cuyo controlador falla)? */
export function webglDesactivado(): boolean {
  try {
    return localStorage.getItem(CLAVE_SIN_WEBGL) === '1'
  } catch {
    return false
  }
}

export function fijarWebglDesactivado(desactivado: boolean): void {
  try {
    if (desactivado) localStorage.setItem(CLAVE_SIN_WEBGL, '1')
    else localStorage.removeItem(CLAVE_SIN_WEBGL)
  } catch {
    /* sin almacenamiento: vale solo hasta recargar */
  }
}
