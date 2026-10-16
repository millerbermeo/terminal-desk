/// <reference types="vite/client" />
import type { ApiCentro } from '@shared/ipc'

declare global {
  interface Window {
    api: ApiCentro
  }
}
