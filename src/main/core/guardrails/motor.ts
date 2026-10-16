import type { LlamadaHerramienta } from '@shared/core/herramientas'
import { rutaProtegidaEscritura, rutaSensible } from './rutas'
import { detectarSecretos, type Hallazgo } from './secretos'

export type { Hallazgo }

/** tsconfig y similares admiten comentarios: no son JSON estricto. */
const JSON_ESTRICTO = /(^|[\\/])(?!tsconfig|jsconfig)[^\\/]*\.json$/i

const resumir = (hs: Hallazgo[]): string =>
  hs.slice(0, 3).map((h) => (h.linea ? `línea ${h.linea}: ${h.mensaje}` : h.mensaje)).join('; ') + (hs.length > 3 ? `; y ${hs.length - 3} más` : '')

/** Revisiones estáticas previas a aplicar un cambio o ejecutar una herramienta. Devuelven el motivo del bloqueo o null. */
export class MotorGuardrails {
  revisarEscritura(ruta: string, contenido: string): Hallazgo[] {
    const hallazgos: Hallazgo[] = []
    const prohibida = rutaProtegidaEscritura(ruta)
    if (prohibida) hallazgos.push({ regla: 'ruta', mensaje: `no se puede escribir en «${ruta}» (${prohibida})` })
    hallazgos.push(...detectarSecretos(contenido))
    if (JSON_ESTRICTO.test(ruta)) {
      try {
        JSON.parse(contenido)
      } catch (err) {
        hallazgos.push({ regla: 'sintaxis', mensaje: `JSON inválido: ${(err as Error).message}` })
      }
    }
    return hallazgos
  }

  /** Texto arbitrario (diff completo, memoria, argumentos de herramientas externas). */
  revisarTexto(texto: string): Hallazgo[] {
    return detectarSecretos(texto)
  }

  /** Motivo del bloqueo de una llamada concreta, o null si puede seguir. */
  validarLlamada = async (llamada: LlamadaHerramienta): Promise<string | null> => {
    const e = llamada.entrada
    let hallazgos: Hallazgo[] = []
    switch (llamada.nombre) {
      case 'leer_archivo': {
        const motivo = rutaSensible(String(e.ruta ?? ''))
        if (motivo) hallazgos = [{ regla: 'ruta', mensaje: `«${String(e.ruta)}» es un ${motivo}: su contenido no se envía al modelo` }]
        break
      }
      case 'escribir_archivo':
        hallazgos = this.revisarEscritura(String(e.ruta ?? ''), String(e.contenido ?? ''))
        break
      case 'ejecutar_comando': {
        const args = Array.isArray(e.args) ? e.args.map(String) : []
        const sensible = args.find((a) => !a.startsWith('-') && rutaSensible(a))
        if (sensible) hallazgos = [{ regla: 'ruta', mensaje: `el comando accede a «${sensible}», que parece contener credenciales` }]
        break
      }
      case 'guardar_memoria':
        hallazgos = this.revisarTexto(`${String(e.titulo ?? '')}\n${String(e.contenido ?? '')}`)
        break
      default:
        // Herramientas externas (MCP): no se les envían credenciales.
        if (llamada.nombre.startsWith('mcp__')) hallazgos = this.revisarTexto(JSON.stringify(e))
    }
    return hallazgos.length ? resumir(hallazgos) : null
  }
}
