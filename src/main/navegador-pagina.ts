/**
 * Código que la IA ejecuta dentro de la página del navegador integrado, en un mundo aislado (no se mezcla con el JavaScript de la página
 * ni lo ve ella; la CSP de la página no lo bloquea). Va como texto y no como función para que el empaquetador no lo transforme.
 * Define `window.__odesk` una vez por documento: las refs (`e1`, `e2`…) se mantienen mientras el elemento siga en la página.
 */
export const MUNDO_AISLADO = 1999

export const SCRIPT_PAGINA = String.raw`
if (!window.__odesk) window.__odesk = (() => {
  let n = 0
  const refs = new Map()
  const de = new WeakMap()
  const refDe = (el) => {
    let r = de.get(el)
    if (!r) { r = 'e' + (++n); de.set(el, r) }
    refs.set(r, new WeakRef(el))
    return r
  }
  const limpio = (t, max = 100) => {
    t = String(t || '').replace(/\s+/g, ' ').trim()
    return t.length > max ? t.slice(0, max - 1) + '…' : t
  }
  const INPUT_ROL = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox', file: 'button', number: 'spinbutton', color: 'button' }
  const TAG_ROL = {
    BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
    IMG: 'img', NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary', FORM: 'form', UL: 'list', OL: 'list',
    LI: 'listitem', TABLE: 'table', TR: 'row', TH: 'columnheader', TD: 'cell', DIALOG: 'dialog', SUMMARY: 'button', OPTION: 'option', IFRAME: 'iframe',
    VIDEO: 'video', AUDIO: 'audio', P: 'paragraph'
  }
  const INTERACTIVOS = new Set(['link', 'button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'slider', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'spinbutton', 'treeitem', 'clicable'])
  const HOJAS = new Set(['link', 'button', 'heading', 'img', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'slider', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'spinbutton', 'clicable', 'iframe', 'video', 'audio', 'paragraph'])
  const CAMPOS = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'])
  const SELECTOR_ACTIVO = 'a[href],button,input,select,textarea,summary,[role],[tabindex],[contenteditable=""],[contenteditable="true"],[onclick],img,h1,h2,h3,h4,h5,h6,iframe,video'
  const IGNORADOS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'WBR'])

  const rolDe = (el) => {
    const r = el.getAttribute('role')
    if (r && r !== 'presentation' && r !== 'none' && r !== 'generic') return r.split(' ')[0]
    const tag = el.tagName
    if (tag === 'INPUT') {
      const ty = (el.type || 'text').toLowerCase()
      return ty === 'hidden' ? null : INPUT_ROL[ty] || 'textbox'
    }
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : null
    if (TAG_ROL[tag]) return TAG_ROL[tag]
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return 'textbox'
    return null
  }
  const textoDeIds = (ids) => ids.split(/\s+/).map((i) => { const x = document.getElementById(i); return x ? x.innerText || x.textContent : '' }).join(' ')
  // Texto de una <label> sin el del control que envuelve (un <select> dentro metería todas sus opciones).
  const textoEtiqueta = (l) => [...l.childNodes].map((c) => c.nodeType === 3 ? c.textContent : c.nodeType === 1 && !c.matches('input,select,textarea,button') ? c.innerText || c.textContent : '').join(' ')
  const nombreDe = (el, rol) => {
    const a = el.getAttribute('aria-label')
    if (a && a.trim()) return limpio(a)
    const lb = el.getAttribute('aria-labelledby')
    if (lb) { const t = textoDeIds(lb); if (t.trim()) return limpio(t) }
    if (el.labels && el.labels.length) { const t = [...el.labels].map(textoEtiqueta).join(' '); if (t.trim()) return limpio(t) }
    if (el.tagName === 'IMG') return limpio(el.alt || el.title)
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) return limpio(el.value || el.type)
    if (CAMPOS.has(rol) || rol === 'checkbox' || rol === 'radio') return limpio(el.getAttribute('placeholder') || el.title || el.name)
    if (rol === 'iframe') return limpio(el.title || el.src)
    if (HOJAS.has(rol) || rol === 'dialog') {
      const t = limpio(el.innerText || el.textContent, rol === 'paragraph' ? 300 : 100)
      if (t) return t
      const icono = el.querySelector('[aria-label],[title],svg title,img[alt]')
      if (icono) return limpio(icono.getAttribute('aria-label') || icono.getAttribute('title') || icono.getAttribute('alt') || icono.textContent)
    }
    return limpio(el.title)
  }
  const visible = (el) => !el.checkVisibility || el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
  const esClicable = (el) => {
    if (el.hasAttribute('onclick') || (el.hasAttribute('tabindex') && el.tabIndex >= 0)) return true
    if (getComputedStyle(el).cursor !== 'pointer') return false
    const p = el.parentElement
    return !p || getComputedStyle(p).cursor !== 'pointer'
  }
  const hijosDe = (el) => {
    if (el.tagName === 'SLOT') return el.assignedNodes({ flatten: true })
    if (el.shadowRoot) return [...el.shadowRoot.childNodes]
    return [...el.childNodes]
  }
  const describir = (el) => {
    const r = rolDe(el) || el.tagName.toLowerCase()
    const nm = nombreDe(el, r) || limpio(el.innerText, 60)
    return r + (nm ? ' «' + nm + '»' : '')
  }
  const estadosDe = (el, rol) => {
    const x = []
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') x.push('deshabilitado')
    if (el.checked === true || el.getAttribute('aria-checked') === 'true') x.push('marcado')
    if (el.getAttribute('aria-pressed') === 'true') x.push('pulsado')
    if (el.getAttribute('aria-selected') === 'true') x.push('seleccionado')
    const exp = el.getAttribute('aria-expanded')
    if (exp) x.push(exp === 'true' ? 'abierto' : 'cerrado')
    if (el.getAttribute('aria-current') && el.getAttribute('aria-current') !== 'false') x.push('actual')
    if (el.required) x.push('obligatorio')
    if (el.readOnly && CAMPOS.has(rol)) x.push('solo lectura')
    if (el.validity && el.willValidate && !el.validity.valid && el.value) x.push('inválido: ' + limpio(el.validationMessage, 80))
    if (el === document.activeElement || (el.shadowRoot && el.shadowRoot.activeElement)) x.push('enfocado')
    return x.length ? ' (' + x.join(', ') + ')' : ''
  }
  const valorDe = (el, rol) => {
    if (el.tagName === 'SELECT') {
      const sel = [...el.selectedOptions].map((o) => limpio(o.label || o.text, 60))
      const ops = [...el.options].slice(0, 25).map((o) => limpio(o.label || o.text, 40))
      return (sel.length ? ' valor=' + JSON.stringify(sel.join(', ')) : '') + ' opciones=' + JSON.stringify(ops.join(' | ') + (el.options.length > 25 ? ' | …' : ''))
    }
    if (el.tagName === 'INPUT' && el.type === 'password') return el.value ? ' valor="•••"' : ''
    if (CAMPOS.has(rol) && 'value' in el && el.value) return ' valor=' + JSON.stringify(limpio(el.value, 120))
    if (rol === 'textbox' && el.isContentEditable) { const t = limpio(el.innerText, 120); return t ? ' valor=' + JSON.stringify(t) : '' }
    return ''
  }
  const destinoDe = (el) => {
    try {
      const u = new URL(el.href, location.href)
      return u.origin === location.origin ? u.pathname + u.search + u.hash : u.href
    } catch { return '' }
  }

  function instantanea() {
    const lineas = []
    let visitados = 0
    let cortado = false
    const emitir = (nivel, t) => {
      if (lineas.length >= 1500) { cortado = true; return }
      lineas.push('  '.repeat(nivel) + '- ' + t)
    }
    // Un bloque sin nada interactivo dentro se resume en una línea de texto (como un párrafo).
    const soloTexto = (el) => {
      if (el.querySelector(SELECTOR_ACTIVO) || el.shadowRoot) return false
      const desc = el.getElementsByTagName('*')
      if (desc.length > 40) return false
      for (const d of desc) if (getComputedStyle(d).cursor === 'pointer') return false
      return (el.innerText || '').length <= 400
    }
    const recorrer = (nodo, nivel) => {
      if (cortado) return
      if (++visitados > 25000) { cortado = true; return }
      if (nodo.nodeType === 3) {
        const t = limpio(nodo.textContent, 300)
        if (t) emitir(nivel, 'text: ' + JSON.stringify(t))
        return
      }
      if (nodo.nodeType !== 1) return
      const el = nodo
      if (IGNORADOS.has(el.tagName) || el.id === '__odesk-marca' || el instanceof SVGElement) return
      if (el.getAttribute('aria-hidden') === 'true' || !visible(el)) return
      let rol = rolDe(el)
      if (!rol && esClicable(el) && limpio(el.innerText)) rol = 'clicable'
      if (rol) {
        const nombre = nombreDe(el, rol)
        let linea = rol + (nombre ? ' ' + JSON.stringify(nombre) : '')
        if (rol === 'heading') linea += ' [nivel ' + (el.getAttribute('aria-level') || el.tagName.slice(1) || '?') + ']'
        if (INTERACTIVOS.has(rol)) {
          linea += ' [ref=' + refDe(el) + ']' + valorDe(el, rol) + estadosDe(el, rol)
          if (rol === 'link') { const d = destinoDe(el); if (d) linea += ' → ' + d }
        } else if (rol === 'dialog' && el.open !== false) linea += estadosDe(el, rol)
        emitir(nivel, linea)
        if (HOJAS.has(rol) && rol !== 'paragraph') return
        if (rol === 'paragraph' && soloTexto(el)) return
        for (const h of hijosDe(el)) recorrer(h, nivel + 1)
        return
      }
      if (soloTexto(el)) {
        const t = limpio(el.innerText, 400)
        if (t) emitir(nivel, 'text: ' + JSON.stringify(t))
        return
      }
      for (const h of hijosDe(el)) recorrer(h, nivel)
    }
    if (document.body) recorrer(document.body, 0)
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight)
    const cabecera = [
      'Página: ' + JSON.stringify(document.title) + ' — ' + location.href,
      'Vista: ' + innerWidth + '×' + innerHeight + ' px, desplazada ' + Math.round(scrollY) + ' de ' + max + ' px'
    ]
    if (cortado) lineas.push('- [… página muy grande: instantánea recortada]')
    return cabecera.join('\n') + '\n' + (lineas.join('\n') || '- (página vacía)')
  }

  const buscar = (ref) => {
    const w = refs.get(String(ref || '').replace(/^\[?ref=/, '').replace(/\]$/, ''))
    const el = w && w.deref()
    if (!el || !el.isConnected) throw new Error('La ref ' + ref + ' ya no está en la página (cambió o se recargó): pide una instantánea nueva.')
    return el
  }
  const profundo = (x, y) => {
    let e = document.elementFromPoint(x, y)
    while (e && e.shadowRoot) {
      const d = e.shadowRoot.elementFromPoint(x, y)
      if (!d || d === e) break
      e = d
    }
    return e
  }
  const contiene = (el, otro) => {
    for (let x = otro; x; x = x.parentElement || (x.getRootNode && x.getRootNode().host)) if (x === el) return true
    return false
  }
  function punto(ref) {
    const el = buscar(ref)
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) throw new Error(describir(el) + ' no tiene tamaño visible en la página.')
    const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2))
    const y = Math.round(Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2))
    const enPunto = profundo(x, y)
    const etiqueta = enPunto && enPunto.closest && enPunto.closest('label')
    const libre = !enPunto || contiene(el, enPunto) || (etiqueta && etiqueta.control === el) || contiene(enPunto, el)
    return {
      x, y,
      desc: describir(el),
      tapa: libre ? null : describir(enPunto),
      deshabilitado: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      archivo: el.tagName === 'INPUT' && el.type === 'file'
    }
  }
  function rect(ref) {
    const el = buscar(ref)
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    return { x: r.left + scrollX, y: r.top + scrollY, ancho: r.width, alto: r.height, desc: describir(el) }
  }
  function seleccionarTodo(ref) {
    const el = buscar(ref)
    el.focus()
    if (typeof el.select === 'function') { try { el.select(); return true } catch { /* tipos sin selección */ } }
    if (el.isContentEditable) {
      const s = getSelection(); const r = document.createRange()
      r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r)
      return true
    }
    return false
  }
  function elegir(ref, valores) {
    const el = buscar(ref)
    if (el.tagName !== 'SELECT') throw new Error(describir(el) + ' no es un desplegable <select>: usa navegador_clic para abrirlo y otro clic en la opción.')
    const opciones = [...el.options]
    const elegidas = valores.map((v) => {
      const t = String(v).toLowerCase()
      const o = opciones.find((o) => o.value === v) || opciones.find((o) => limpio(o.label || o.text).toLowerCase() === t)
      if (!o) throw new Error('No hay ninguna opción «' + v + '». Opciones: ' + opciones.slice(0, 30).map((o) => limpio(o.label || o.text, 40)).join(' | '))
      return o
    })
    if (!el.multiple && elegidas.length > 1) throw new Error('Este desplegable solo admite una opción.')
    for (const o of opciones) o.selected = elegidas.includes(o)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return elegidas.map((o) => limpio(o.label || o.text, 60))
  }
  function llevar(ref) {
    const el = buscar(ref)
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    return describir(el)
  }
  const tieneTexto = (t) => !!document.body && (document.body.innerText || '').includes(t)

  // Marca en la página dónde actúa la IA (un círculo y lo que hace), para que se vea en directo.
  function marcar(x, y, texto) {
    let m = document.getElementById('__odesk-marca')
    if (!m) {
      m = document.createElement('div')
      m.id = '__odesk-marca'
      m.setAttribute('aria-hidden', 'true')
      m.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;transition:transform .25s ease,opacity .4s;opacity:0'
      const anillo = document.createElement('div')
      anillo.style.cssText = 'width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:3px solid #f43f5e;background:rgba(244,63,94,.25);box-shadow:0 0 0 5px rgba(244,63,94,.18)'
      const etiqueta = document.createElement('div')
      etiqueta.style.cssText = 'margin:6px 0 0 10px;padding:2px 8px;border-radius:6px;background:#f43f5e;color:#fff;font:600 12px system-ui,sans-serif;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis'
      m.append(anillo, etiqueta)
    }
    if (!m.isConnected) (document.body || document.documentElement).appendChild(m)
    m.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    m.style.opacity = '1'
    m.lastChild.textContent = '🤖 ' + texto
    clearTimeout(m.__t)
    m.__t = setTimeout(() => { m.style.opacity = '0' }, 2500)
  }

  return { instantanea, punto, rect, seleccionarTodo, elegir, llevar, tieneTexto, marcar }
})()
`
