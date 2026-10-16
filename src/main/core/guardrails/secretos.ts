export interface Hallazgo {
  regla: string
  mensaje: string
  linea?: number
}

interface PatronSecreto {
  nombre: string
  patron: RegExp
}

const PATRONES: PatronSecreto[] = [
  { nombre: 'clave privada', patron: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { nombre: 'clave de AWS', patron: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { nombre: 'token de GitHub', patron: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { nombre: 'clave de Anthropic', patron: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { nombre: 'clave de OpenAI', patron: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { nombre: 'token de Slack', patron: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { nombre: 'clave de Google', patron: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nombre: 'clave de Stripe', patron: /\b[sr]k_live_[0-9A-Za-z]{20,}/ },
  { nombre: 'JWT', patron: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { nombre: 'credenciales en una URL', patron: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{3,}@[^\s/]+/i },
  {
    nombre: 'secreto asignado en el código',
    patron: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s${}<>]{8,}["']/i
  }
]

// Valores de ejemplo que no son secretos reales.
const FALSO_POSITIVO = /(example|ejemplo|placeholder|changeme|your[_-]|tu[_-]|xxxx|\*{4,}|<[^>]+>|dummy|test1234|password123)/i

const redactar = (t: string): string => (t.length <= 8 ? '****' : `${t.slice(0, 4)}…(${t.length} caracteres)`)

/** Busca credenciales en un texto. Nunca devuelve el secreto completo, solo un extracto redactado. */
export function detectarSecretos(texto: string): Hallazgo[] {
  const salida: Hallazgo[] = []
  texto.split('\n').forEach((linea, i) => {
    if (linea.length > 5000) return // minificados: no se escanean
    for (const { nombre, patron } of PATRONES) {
      const m = patron.exec(linea)
      if (!m || FALSO_POSITIVO.test(m[0])) continue
      salida.push({ regla: 'secreto', mensaje: `posible ${nombre} (${redactar(m[0])})`, linea: i + 1 })
      break // un hallazgo por línea
    }
  })
  return salida
}

/** Sustituye las credenciales de un texto por `[REDACTADO:tipo]` (para trazas, logs e informes). */
export function redactarSecretos(texto: string): string {
  let salida = texto
  for (const { nombre, patron } of PATRONES) {
    salida = salida.replace(new RegExp(patron.source, patron.flags.replace('g', '') + 'g'), (m) => (FALSO_POSITIVO.test(m) ? m : `[REDACTADO:${nombre}]`))
  }
  return salida
}
