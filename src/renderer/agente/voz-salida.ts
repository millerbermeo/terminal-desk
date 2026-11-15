import { useCallback, useEffect, useState } from 'react'
import { limpiarParaVoz } from './utilidades-chat'

/** Leer en voz alta usa las voces del sistema (en Linux hace falta `speech-dispatcher`): sin ellas el botón no se ofrece. */
export const lecturaDisponible = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

function elegirVoz(): SpeechSynthesisVoice | undefined {
  const voces = window.speechSynthesis.getVoices()
  const idioma = (navigator.language || 'es').slice(0, 2).toLowerCase()
  return voces.find((v) => v.lang.toLowerCase().startsWith(idioma)) ?? voces.find((v) => v.lang.toLowerCase().startsWith('es'))
}

/** Lee un texto en voz alta; solo uno a la vez. `leyendo` es la clave de lo que suena ahora. */
export function useLectura() {
  const [leyendo, setLeyendo] = useState<string | undefined>()
  const [hayVoces, setHayVoces] = useState(() => lecturaDisponible() && window.speechSynthesis.getVoices().length > 0)

  useEffect(() => {
    if (!lecturaDisponible()) return
    const actualizar = (): void => setHayVoces(window.speechSynthesis.getVoices().length > 0)
    window.speechSynthesis.addEventListener('voiceschanged', actualizar)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', actualizar)
      window.speechSynthesis.cancel() // al cerrar el chat no queda nada sonando
    }
  }, [])

  const detener = useCallback((): void => {
    if (lecturaDisponible()) window.speechSynthesis.cancel()
    setLeyendo(undefined)
  }, [])

  const leer = useCallback((clave: string, markdown: string): void => {
    if (!lecturaDisponible()) return
    window.speechSynthesis.cancel()
    const texto = limpiarParaVoz(markdown)
    if (!texto) return setLeyendo(undefined)
    const dicho = new SpeechSynthesisUtterance(texto)
    const voz = elegirVoz()
    if (voz) {
      dicho.voice = voz
      dicho.lang = voz.lang
    } else dicho.lang = navigator.language || 'es-ES'
    const terminar = (): void => setLeyendo((actual) => (actual === clave ? undefined : actual))
    dicho.onend = terminar
    dicho.onerror = terminar
    setLeyendo(clave)
    window.speechSynthesis.speak(dicho)
  }, [])

  return { disponible: hayVoces, leyendo, leer, detener }
}
