export type AccionRegla = 'permitir' | 'denegar'

/** Regla persistente de un proyecto (o global). `comando`: línea de comando (`pnpm test`, `git commit *`); `herramienta`: nombre de herramienta (`escribir_archivo`, `mcp__db__*`). */
export interface ReglaPermiso {
  id: string
  tipo: 'comando' | 'herramienta'
  patron: string
  accion: AccionRegla
  creada: string // ISO
}

export type NuevaRegla = Pick<ReglaPermiso, 'tipo' | 'patron' | 'accion'>
