import { safeStorage } from 'electron'
import type { Cifrador } from './github/token'

/** Cifrado del token de GitHub con el llavero del sistema; sin un llavero seguro (Linux sin gestor de claves) no hay cifrado y el token no se guarda. */
export function cifradorDelSistema(): Cifrador {
  const disponible = (): boolean => {
    try {
      if (!safeStorage?.isEncryptionAvailable()) return false
      // En Linux sin gestor de claves Electron usa un cifrado con clave fija («basic_text»): equivale a no cifrar.
      const motor = (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.()
      return !(process.platform === 'linux' && (motor === 'basic_text' || motor === 'unknown'))
    } catch {
      return false
    }
  }
  return {
    disponible,
    cifrar: (t) => safeStorage.encryptString(t).toString('base64'),
    descifrar: (c) => safeStorage.decryptString(Buffer.from(c, 'base64'))
  }
}
