/**
 * ¿Chromium dibuja sin GPU (SwiftShader, llvmpipe… o sin WebGL)? Pasa en PCs sin aceleración gráfica, máquinas virtuales o con
 * drivers en lista negra. Ahí el desenfoque (`backdrop-filter`) y el WebGL de xterm se calculan en la CPU y traban la interfaz, así
 * que se usan las alternativas: fondos opacos y el renderer DOM de xterm. Con GPU real no cambia nada.
 */
let cache: boolean | undefined

export function sinGpu(): boolean {
  if (cache !== undefined) return cache
  cache = false
  try {
    const lienzo = document.createElement('canvas')
    const gl = (lienzo.getContext('webgl2') ?? lienzo.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return (cache = true)
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const nombre = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '') : ''
    cache = /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(nombre)
    gl.getExtension('WEBGL_lose_context')?.loseContext() // no ocupar uno de los ~16 contextos que reparte Chromium
  } catch {
    cache = false // ante la duda, como siempre
  }
  return cache
}

/** Marca `<html class="sin-gpu">` para que el CSS quite los desenfoques (ver `diseno/tokens.css`). */
export function marcarSinGpu(): void {
  if (sinGpu()) document.documentElement.classList.add('sin-gpu')
}
