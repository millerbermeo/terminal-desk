/**
 * Bitácora local del Asistente: una línea por mensaje (consumo de tokens) y por fallo. Sirve para saber por qué falló algo y si el
 * consumo de la suscripción es el normal o hay algo que mejorar. No guarda el contenido de las conversaciones: solo tamaños y un
 * recorte corto del mensaje para reconocerlo. Lógica pura (probada en `tests/bitacora-asistente.test.ts`).
 */

export interface EntradaTurno {
  tipo: 'turno'
  ts: number
  conversacion: string
  proyecto?: string
  /** Primeras palabras del mensaje del usuario (ya sin secretos), para reconocer el turno. */
  mensaje: string
  mensajeChars: number
  respuestaChars: number
  modelo: string
  cuenta?: string
  autonomia?: string
  estado: 'completado' | 'limite_pasos' | 'cancelado' | 'error'
  /** Tokens de entrada totales del mensaje (incluye lo que se leyó de caché y lo escrito en ella). */
  entrada: number
  salida: number
  /** De la entrada, lo que vino de la caché de prompt (barato). El resto se pagó entero. */
  cacheLeida: number
  costo: number
  /** Tamaño del contexto al terminar (lo que se reenviará en el próximo mensaje). */
  contexto: number
  ventana?: number
  pasos: number
  herramientas: number
  duracionMs: number
  /** Venía de una conversación ya empezada (reanudada) o era el primer mensaje. */
  reanudada: boolean
  rotacion?: string
  compactado?: boolean
  limite?: boolean
  imagenes?: number
}

export interface EntradaFallo {
  tipo: 'fallo'
  ts: number
  conversacion: string
  proyecto?: string
  mensaje: string
  /** Texto del error (saneado). */
  error: string
  /** Clasificación para agrupar: limite, red, cli, permiso, cancelado, otro… */
  causa: CausaFallo
  modelo?: string
  duracionMs: number
}

export type CausaFallo = 'limite' | 'red' | 'sesion' | 'cli' | 'contexto' | 'permiso' | 'tiempo' | 'otro'
export type EntradaBitacora = EntradaTurno | EntradaFallo

export const ETIQUETA_CAUSA: Record<CausaFallo, string> = {
  limite: 'Límite de uso de la suscripción',
  red: 'Sin conexión o servicio caído',
  sesion: 'Sesión de Claude vencida o sin iniciar',
  cli: 'El CLI de Claude falló o no está instalado',
  contexto: 'Contexto demasiado grande',
  permiso: 'Permisos del sistema o de la app',
  tiempo: 'Se quedó sin responder (tiempo agotado)',
  otro: 'Otro error'
}

const AYUDA_CAUSA: Record<CausaFallo, string> = {
  limite: 'Se agotó el cupo de la ventana de 5 h o semanal. Espera al reinicio o cambia de cuenta (Proveedores de IA → Cuentas).',
  red: 'Revisa tu conexión; el CLI no pudo hablar con Anthropic. Suele resolverse solo al reintentar.',
  sesion: 'Ejecuta «claude auth login» (o vuelve a entrar en Proveedores de IA → Cuentas).',
  cli: 'Comprueba que `claude --version` funcione en una terminal. Si no, reinstálalo.',
  contexto: 'La conversación creció demasiado: empieza una nueva con «Nueva con contexto» para arrastrar solo el resumen.',
  permiso: 'Mira el aviso de permisos de ese turno: dice qué permiso falta y cómo darlo.',
  tiempo: 'El proceso dejó de responder. Cancela y reintenta; si se repite, abre una conversación nueva.',
  otro: 'Copia este informe y pásalo a quien mantiene la app: incluye el motivo exacto.'
}
export const ayudaCausa = (c: CausaFallo): string => AYUDA_CAUSA[c]

/** Clasifica un mensaje de error para agruparlo. */
export function clasificarFallo(texto: string): CausaFallo {
  const t = texto.toLowerCase()
  if (/usage limit|rate.?limit|l[ií]mite de uso|limit reached|429|quota|se agot/.test(t)) return 'limite'
  if (/not logged in|invalid api key|authentication|401|auth login|sesi[oó]n.*(venci|expir)|credenciales de claude/.test(t)) return 'sesion'
  if (/context.*(too (long|large)|window|exceed)|prompt is too long|contexto.*(grande|excede)/.test(t)) return 'contexto'
  if (/timeout|timed out|tiempo agotado|sin respuesta|no (lleg[oó]|hubo) eco/.test(t)) return 'tiempo'
  if (/enotfound|econnreset|econnrefused|etimedout|fetch failed|network|socket hang up|overloaded|529|50[0-4]\b|sin conexi[oó]n/.test(t)) return 'red'
  if (/eacces|eperm|permission denied|permiso/.test(t)) return 'permiso'
  if (/enoent.*claude|spawn .*claude|claude.*(not found|no se encontr|exited|c[oó]digo de salida)|exit code|c[oó]digo \d+/.test(t)) return 'cli'
  return 'otro'
}

// ---------------------------------------------------------------- análisis del consumo

export interface ResumenConsumo {
  turnos: number
  fallos: number
  entrada: number
  salida: number
  cacheLeida: number
  /** 0–1: parte de la entrada que salió de la caché (más alto = más barato). */
  aciertoCache: number
  costo: number
  contextoMedio: number
  entradaMedia: number
  salidaMedia: number
  pasosMedios: number
  rotaciones: number
}

export type Gravedad = 'ok' | 'aviso' | 'alto'
export interface Hallazgo {
  gravedad: Gravedad
  titulo: string
  detalle: string
}

export function resumir(entradas: readonly EntradaBitacora[]): ResumenConsumo {
  const turnos = entradas.filter((e): e is EntradaTurno => e.tipo === 'turno')
  const suma = (f: (t: EntradaTurno) => number): number => turnos.reduce((s, t) => s + f(t), 0)
  const n = turnos.length || 1
  const entrada = suma((t) => t.entrada)
  const cache = suma((t) => t.cacheLeida)
  return {
    turnos: turnos.length,
    fallos: entradas.length - turnos.length,
    entrada,
    salida: suma((t) => t.salida),
    cacheLeida: cache,
    aciertoCache: entrada > 0 ? cache / entrada : 0,
    costo: suma((t) => t.costo),
    contextoMedio: suma((t) => t.contexto) / n,
    entradaMedia: entrada / n,
    salidaMedia: suma((t) => t.salida) / n,
    pasosMedios: suma((t) => t.pasos) / n,
    rotaciones: turnos.filter((t) => t.rotacion).length
  }
}

/** Entrada de un mensaje que NO vino de caché: lo que de verdad pesa en el cupo (la caché leída cuenta mucho menos). */
export const entradaSinCache = (t: EntradaTurno): number => Math.max(0, t.entrada - t.cacheLeida)

/**
 * ¿Consume más de lo ideal? Reglas simples y explicables: cada hallazgo dice qué se vio y qué hacer.
 * Los umbrales son orientativos (una conversación con contexto grande reenvía todo en cada mensaje).
 */
export function diagnosticar(entradas: readonly EntradaBitacora[]): Hallazgo[] {
  const r = resumir(entradas)
  const turnos = entradas.filter((e): e is EntradaTurno => e.tipo === 'turno')
  const h: Hallazgo[] = []
  if (turnos.length === 0) return [{ gravedad: 'ok', titulo: 'Sin datos todavía', detalle: 'Aparecerán aquí después de usar el Asistente con la suscripción.' }]

  if (r.contextoMedio > 120_000) {
    h.push({ gravedad: 'alto', titulo: 'Contexto muy grande en cada mensaje', detalle: `Media de ${Math.round(r.contextoMedio / 1000)} k tokens reenviados por mensaje. Cada respuesta cuesta mucho cupo: abre conversaciones nuevas por tarea («Nueva con contexto» arrastra solo el resumen).` })
  } else if (r.contextoMedio > 70_000) {
    h.push({ gravedad: 'aviso', titulo: 'Contexto grande', detalle: `Media de ${Math.round(r.contextoMedio / 1000)} k tokens por mensaje. Conviene cerrar la conversación al terminar cada tarea.` })
  }
  if (turnos.length >= 5 && r.aciertoCache < 0.6 && r.entrada > 200_000) {
    h.push({ gravedad: 'alto', titulo: 'La caché casi no se aprovecha', detalle: `Solo el ${Math.round(r.aciertoCache * 100)} % de lo enviado salió de caché. Pasa cuando hay pausas largas (la caché caduca a los ~5 min), cambios de modelo/cuenta o de configuración entre mensajes. Evita cambiar modelo o cuenta a mitad de una conversación.` })
  } else if (turnos.length >= 5 && r.aciertoCache < 0.8 && r.entrada > 200_000) {
    h.push({ gravedad: 'aviso', titulo: 'Caché mejorable', detalle: `Acierto de caché del ${Math.round(r.aciertoCache * 100)} %. Lo normal en una conversación seguida es más del 85 %.` })
  }
  const pesados = turnos.filter((t) => entradaSinCache(t) > 80_000)
  if (pesados.length > 0) {
    h.push({ gravedad: pesados.length >= 3 ? 'alto' : 'aviso', titulo: `${pesados.length} ${pesados.length === 1 ? 'mensaje pagó' : 'mensajes pagaron'} más de 80 k tokens sin caché`, detalle: 'Suelen ser el primer mensaje de una conversación, o uno tras una pausa larga o un cambio de modelo. Mira las filas marcadas en la tabla.' })
  }
  if (r.pasosMedios > 25) {
    h.push({ gravedad: 'aviso', titulo: 'Muchos pasos por mensaje', detalle: `Media de ${r.pasosMedios.toFixed(0)} pasos (cada paso reenvía el contexto). Pide tareas más acotadas o usa skills/agentes que reduzcan idas y vueltas.` })
  }
  const muchoSalida = turnos.filter((t) => t.salida > 20_000)
  if (muchoSalida.length > 0) {
    h.push({ gravedad: 'aviso', titulo: `${muchoSalida.length} ${muchoSalida.length === 1 ? 'respuesta muy larga' : 'respuestas muy largas'}`, detalle: 'Más de 20 k tokens de salida. Pide respuestas más cortas o que escriba directamente en archivos.' })
  }
  if (r.rotaciones >= 3) {
    h.push({ gravedad: 'aviso', titulo: 'Conversaciones resumidas con frecuencia', detalle: `${r.rotaciones} veces se resumió el contexto: son conversaciones demasiado largas.` })
  }
  const limites = turnos.filter((t) => t.limite).length + entradas.filter((e) => e.tipo === 'fallo' && e.causa === 'limite').length
  if (limites > 0) h.push({ gravedad: 'alto', titulo: `Alcanzaste el límite de la suscripción ${limites} ${limites === 1 ? 'vez' : 'veces'}`, detalle: 'Revisa qué turnos gastaron más (tabla ordenada por tokens) y aplica lo de arriba.' })
  if (h.length === 0) h.push({ gravedad: 'ok', titulo: 'Consumo normal', detalle: `Contexto medio de ${Math.round(r.contextoMedio / 1000)} k, caché del ${Math.round(r.aciertoCache * 100)} % y ${r.pasosMedios.toFixed(0)} pasos por mensaje: sin señales de gasto anormal.` })
  return h
}

const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)} k` : String(Math.round(n)))

/** Informe en Markdown para copiar y pegar (a quien mantiene la app o a un asistente) sin contenido de las conversaciones. */
export function informeMarkdown(entradas: readonly EntradaBitacora[], periodo: string): string {
  const r = resumir(entradas)
  const turnos = entradas.filter((e): e is EntradaTurno => e.tipo === 'turno').sort((a, b) => entradaSinCache(b) - entradaSinCache(a))
  const fallos = entradas.filter((e): e is EntradaFallo => e.tipo === 'fallo')
  const l: string[] = [`# Registro del Asistente · ${periodo}`, '']
  l.push(`- Mensajes: ${r.turnos} · fallos: ${r.fallos}`)
  l.push(`- Entrada: ${k(r.entrada)} tokens (${Math.round(r.aciertoCache * 100)} % de caché) · salida: ${k(r.salida)}`)
  l.push(`- Contexto medio: ${k(r.contextoMedio)} · pasos medios: ${r.pasosMedios.toFixed(1)} · costo equivalente: US$ ${r.costo.toFixed(2)}`, '')
  l.push('## Diagnóstico')
  for (const x of diagnosticar(entradas)) l.push(`- **${x.titulo}** (${x.gravedad}): ${x.detalle}`)
  if (turnos.length) {
    l.push('', '## Mensajes que más pagaron (entrada sin caché)', '', '| Hora | Modelo | Entrada | Sin caché | Salida | Contexto | Pasos | Estado |', '|---|---|---|---|---|---|---|---|')
    for (const t of turnos.slice(0, 15)) l.push(`| ${new Date(t.ts).toLocaleString()} | ${t.modelo} | ${k(t.entrada)} | ${k(entradaSinCache(t))} | ${k(t.salida)} | ${k(t.contexto)} | ${t.pasos} | ${t.estado}${t.rotacion ? ` (resumido: ${t.rotacion})` : ''} |`)
  }
  if (fallos.length) {
    l.push('', '## Fallos')
    for (const f of fallos.sort((a, b) => b.ts - a.ts).slice(0, 30)) l.push(`- ${new Date(f.ts).toLocaleString()} · ${ETIQUETA_CAUSA[f.causa]} · «${f.mensaje}» → ${f.error.slice(0, 300)}`)
  }
  return l.join('\n') + '\n'
}
