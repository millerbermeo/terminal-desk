import type { EventoAgente } from '@shared/core/agente'

const MAX_ENTRADA = 240
const MAX_RESULTADO = 360
const MAX_TEXTO = 1200

const corto = (t: string, max: number): string => {
  const l = t.replace(/\s+/g, ' ').trim()
  return l.length > max ? `${l.slice(0, max)}…` : l
}

/** Resumen de una llamada a herramienta: su nombre y lo esencial de la entrada (ruta, comando, patrón). */
const resumenEntrada = (entrada: Record<string, unknown>): string => {
  const v = entrada.file_path ?? entrada.path ?? entrada.command ?? entrada.pattern ?? entrada.url ?? entrada.description
  return corto(typeof v === 'string' ? v : JSON.stringify(entrada), MAX_ENTRADA)
}

/**
 * Lo que una ejecución lleva hecho, en líneas cortas y en orden, para poder contestar «¿cómo va?» sin tocarla:
 * la petición, lo que el agente fue diciendo y cada herramienta con su resultado. Acotada: al pasar el tope se
 * descartan las líneas intermedias más antiguas (la petición original siempre se conserva).
 */
export class Bitacora {
  private readonly lineas: string[] = []
  private peticion = ''
  private pasos = 0
  private ultimoEvento = Date.now()

  constructor(private readonly maxCaracteres = 12_000) {}

  registrar(e: Pick<EventoAgente, 'tipo'> & Record<string, unknown>): void {
    switch (e.tipo) {
      case 'inicio':
        if (!this.peticion && typeof e.prompt === 'string') this.peticion = corto(e.prompt, 2000)
        return
      case 'texto':
        if (typeof e.texto === 'string' && e.texto.trim()) this.anotar(`Dijo: ${corto(e.texto, MAX_TEXTO)}`)
        return
      case 'herramienta_inicio': {
        const l = e.llamada as { nombre: string; entrada: Record<string, unknown> }
        this.pasos++
        this.anotar(`Usa ${l.nombre}: ${resumenEntrada(l.entrada ?? {})}`)
        return
      }
      case 'herramienta_fin': {
        const r = e.resultado as { texto?: string; error?: boolean }
        this.anotar(`  → ${r.error ? 'ERROR: ' : ''}${corto(r.texto ?? '', MAX_RESULTADO) || '(sin salida)'}`)
        return
      }
    }
  }

  private anotar(linea: string): void {
    this.ultimoEvento = Date.now()
    this.lineas.push(linea)
    let total = this.lineas.reduce((s, l) => s + l.length + 1, 0)
    while (total > this.maxCaracteres && this.lineas.length > 1) total -= this.lineas.shift()!.length + 1
  }

  /** Texto para el modelo; vacío si todavía no ha pasado nada. */
  texto(ahora = Date.now()): string {
    const hace = Math.max(0, Math.round((ahora - this.ultimoEvento) / 1000))
    return [
      `Petición original: ${this.peticion || '(desconocida)'}`,
      `Herramientas usadas hasta ahora: ${this.pasos}. Último movimiento hace ${hace} s${hace > 30 ? ' (probablemente un paso largo en curso)' : ''}.`,
      this.lineas.length ? `Registro (lo más reciente al final):\n${this.lineas.join('\n')}` : 'Aún no ha hecho nada visible.'
    ].join('\n')
  }
}
