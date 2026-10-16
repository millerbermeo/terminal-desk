import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Annotation, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { lenguajeDe } from './lenguajes'

/** Marca los cambios que vienen del disco (no son del usuario: no ensucian el archivo ni entran en el historial de deshacer). */
const externa = Annotation.define<boolean>()

const tema = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--bg)', fontSize: '13px' },
    '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', Menlo, Consolas, monospace", lineHeight: '1.55' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', borderRight: '1px solid var(--borde)', color: '#5b6275' },
    '.cm-activeLine': { backgroundColor: 'rgba(122, 162, 247, 0.07)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(122, 162, 247, 0.12)' },
    '&.cm-focused': { outline: 'none' }
  },
  { dark: true }
)

export interface ManejoEditor {
  /** Texto actual de un archivo abierto (el del editor, aunque no esté guardado). */
  texto(ruta: string): string | undefined
  /** Sustituye el contenido por el del disco, sin ensuciar el archivo. */
  reemplazar(ruta: string, texto: string): void
  /** Olvida el estado (deshacer, cursor) de un archivo que se cerró. */
  olvidar(ruta: string): void
  enfocar(): void
}

interface Props {
  ruta: string | null
  /** Contenido con el que se crea el editor de un archivo la primera vez que se muestra. */
  inicial: string
  onCambio: (ruta: string) => void
  onGuardar: (ruta: string) => void
  onCursor?: (linea: number, columna: number) => void
}

/**
 * Un único CodeMirror que intercambia el estado de cada archivo abierto (así cada uno conserva su historial de deshacer,
 * su cursor y su desplazamiento al cambiar de pestaña).
 */
export const EditorCodigo = forwardRef<ManejoEditor, Props>(function EditorCodigo({ ruta, inicial, onCambio, onGuardar, onCursor }, ref) {
  const contenedor = useRef<HTMLDivElement>(null)
  const vista = useRef<EditorView | null>(null)
  const estados = useRef(new Map<string, EditorState>())
  const actual = useRef<string | null>(null)
  const cb = useRef({ onCambio, onGuardar, onCursor })
  cb.current = { onCambio, onGuardar, onCursor }

  const crear = (r: string, doc: string): EditorState => {
    const extensiones: Extension[] = [
      basicSetup,
      oneDark,
      tema,
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (cb.current.onGuardar(r), true) }]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((t) => t.annotation(externa))) cb.current.onCambio(r)
        if (u.selectionSet || u.docChanged) {
          const p = u.state.selection.main.head
          const l = u.state.doc.lineAt(p)
          cb.current.onCursor?.(l.number, p - l.from + 1)
        }
      })
    ]
    const lenguaje = lenguajeDe(r).extension
    if (lenguaje) extensiones.push(lenguaje)
    return EditorState.create({ doc, extensions: extensiones })
  }

  useEffect(() => {
    const v = new EditorView({ parent: contenedor.current! })
    vista.current = v
    return () => {
      if (actual.current) estados.current.set(actual.current, v.state) // el texto sigue disponible para el último guardado
      vista.current = null
      v.destroy()
    }
  }, [])

  useEffect(() => {
    const v = vista.current
    if (!v) return
    if (actual.current) estados.current.set(actual.current, v.state)
    actual.current = ruta
    if (!ruta) return v.setState(EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true), oneDark, tema] }))
    v.setState(estados.current.get(ruta) ?? crear(ruta, inicial))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta])

  useImperativeHandle(ref, () => ({
    texto: (r) => (r === actual.current && vista.current ? vista.current.state.doc.toString() : estados.current.get(r)?.doc.toString()),
    reemplazar: (r, texto) => {
      const v = vista.current
      if (r === actual.current && v) {
        const sel = Math.min(v.state.selection.main.head, texto.length)
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: texto }, selection: { anchor: sel }, annotations: [externa.of(true)] })
      } else {
        const e = estados.current.get(r)
        if (e) estados.current.set(r, e.update({ changes: { from: 0, to: e.doc.length, insert: texto }, annotations: [externa.of(true)] }).state)
      }
    },
    olvidar: (r) => void estados.current.delete(r),
    enfocar: () => vista.current?.focus()
  }))

  return <div className="ed-codigo" ref={contenedor} style={{ display: ruta ? 'block' : 'none' }} />
})
