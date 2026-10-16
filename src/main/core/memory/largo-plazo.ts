import { randomUUID } from 'node:crypto'
import type { EntradaMemoria, NuevaEntradaMemoria, TipoMemoria } from '@shared/core/memoria'
import { estimarTokens } from '../context/tokens'
import { detectarSecretos } from '../guardrails/secretos'
import { AlmacenJson, validarId } from './almacen'
import { buscar, type Resultado } from './busqueda'

export const MEMORIA_GLOBAL = 'global'
const TIPOS: readonly TipoMemoria[] = ['regla', 'decision', 'hecho']
const MAX_CONTENIDO = 4000
const MAX_ENTRADAS = 500

interface Documento {
  entradas: EntradaMemoria[]
}

/** Memoria de largo plazo en archivos: reglas, decisiones técnicas y hechos de un proyecto (más una memoria global). */
export class MemoriaLargoPlazo {
  private readonly almacen: AlmacenJson<Documento>

  constructor(dir: string) {
    this.almacen = new AlmacenJson<Documento>(dir)
  }

  async listar(proyectoId: string = MEMORIA_GLOBAL): Promise<EntradaMemoria[]> {
    return (await this.almacen.leer(validarId(proyectoId)))?.entradas ?? []
  }

  async guardar(nueva: NuevaEntradaMemoria, proyectoId: string = MEMORIA_GLOBAL): Promise<EntradaMemoria[]> {
    if (!TIPOS.includes(nueva.tipo)) throw new Error(`Tipo de memoria inválido: ${nueva.tipo}`)
    const titulo = nueva.titulo.trim()
    const contenido = nueva.contenido.trim()
    if (!titulo || !contenido) throw new Error('La memoria necesita título y contenido')
    // La memoria se inyecta en prompts futuros: nunca debe contener credenciales, venga del agente o del usuario.
    const secretos = detectarSecretos(`${titulo}\n${contenido}`)
    if (secretos.length) throw new Error(`La memoria no puede contener credenciales (${secretos[0]!.mensaje})`)
    if (contenido.length > MAX_CONTENIDO) throw new Error(`Contenido demasiado largo (máx. ${MAX_CONTENIDO} caracteres)`)
    const entrada: EntradaMemoria = {
      id: randomUUID(),
      tipo: nueva.tipo,
      titulo,
      contenido,
      etiquetas: (nueva.etiquetas ?? []).map((e) => e.trim()).filter(Boolean).slice(0, 10),
      creada: new Date().toISOString()
    }
    const doc = await this.almacen.actualizar(validarId(proyectoId), (actual) => {
      const entradas = actual?.entradas ?? []
      if (entradas.length >= MAX_ENTRADAS) throw new Error('Memoria llena: elimina entradas antiguas')
      return { entradas: [...entradas, entrada] }
    })
    return doc?.entradas ?? []
  }

  async eliminar(id: string, proyectoId: string = MEMORIA_GLOBAL): Promise<EntradaMemoria[]> {
    const doc = await this.almacen.actualizar(validarId(proyectoId), (actual) =>
      actual ? { entradas: actual.entradas.filter((e) => e.id !== id) } : undefined
    )
    return doc?.entradas ?? []
  }

  /** Entradas del proyecto + globales relevantes para la consulta. */
  async buscar(consulta: string, proyectoId: string | undefined, k = 5, tipo?: TipoMemoria): Promise<Resultado[]> {
    const todas = await this.todas(proyectoId)
    return buscar(consulta, tipo ? todas.filter((e) => e.tipo === tipo) : todas, k)
  }

  private async todas(proyectoId: string | undefined): Promise<EntradaMemoria[]> {
    const globales = await this.listar(MEMORIA_GLOBAL)
    return proyectoId && proyectoId !== MEMORIA_GLOBAL ? [...(await this.listar(proyectoId)), ...globales] : globales
  }

  /**
   * Texto para el prompt de sistema dentro de un presupuesto de tokens: primero todas las reglas
   * (hasta la mitad del presupuesto), después lo más relevante para la consulta.
   */
  async contextoPara(consulta: string, proyectoId: string | undefined, presupuesto = 1500): Promise<string> {
    const todas = await this.todas(proyectoId)
    const lineas: string[] = []
    let usado = 0
    const añadir = (e: EntradaMemoria, tope: number): boolean => {
      const linea = `- [${e.tipo}] ${e.titulo}: ${e.contenido}`
      const coste = estimarTokens(linea)
      if (usado + coste > tope) return false
      lineas.push(linea)
      usado += coste
      return true
    }
    const reglas = todas.filter((e) => e.tipo === 'regla')
    for (const r of reglas) añadir(r, presupuesto / 2)
    for (const { entrada } of buscar(consulta, todas.filter((e) => e.tipo !== 'regla'), 10)) {
      if (!añadir(entrada, presupuesto)) break
    }
    return lineas.length ? `## Memoria del proyecto (reglas y decisiones previas; respétalas)\n${lineas.join('\n')}` : ''
  }
}
