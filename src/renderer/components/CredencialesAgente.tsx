import { useCallback, useEffect, useState } from 'react'
import type { DatosProyectos } from '@shared/modelos'
import type { AmbitoCredenciales, CampoCredencial, CredencialPrueba } from '@shared/credenciales'
import { confirmar } from '../confirmar'
import { EstadoVacio } from './EstadoVacio'
import { IconoEscudo } from './Iconos'

const limpiar = (m: string): string => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^Credenciales: /, '')
const VACIA = (): { id?: string; nombre: string; notas: string; campos: CampoCredencial[] } => ({ nombre: '', notas: '', campos: [{ clave: '', valor: '', secreto: false }] })
// Atajos para no escribir siempre lo mismo; el resto de campos es libre.
const SUGERIDAS = ['usuario', 'email', 'contraseña', 'api_key', 'token', 'url', 'host', 'puerto']

interface Props {
  datos: DatosProyectos
  visible?: boolean
}

/** Credenciales de prueba de ESTE equipo, por proyecto o por grupo: el asistente las consulta con `credenciales_listar/obtener`. */
export function CredencialesAgente({ datos, visible = true }: Props) {
  const [elegida, setClave] = useState('')
  // Los proyectos pueden cargarse después de montar el panel: mientras no haya una elección válida se usa el primero.
  const opciones = [...datos.grupos.map((g) => `grupo:${g.id}`), ...datos.proyectos.map((p) => `proyecto:${p.id}`)]
  const clave = opciones.includes(elegida) ? elegida : (datos.proyectos[0] ? `proyecto:${datos.proyectos[0].id}` : (opciones[0] ?? ''))
  const [lista, setLista] = useState<CredencialPrueba[]>([])
  const [edicion, setEdicion] = useState<ReturnType<typeof VACIA> | null>(null)
  const [visibles, setVisibles] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const ambito: AmbitoCredenciales | null = clave ? { tipo: clave.startsWith('grupo:') ? 'grupo' : 'proyecto', id: clave.slice(clave.indexOf(':') + 1) } : null
  const cargar = useCallback(() => {
    if (!ambito) return setLista([])
    void window.api.credenciales.operar('listar', { ambito }).then(setLista, () => setLista([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])
  useEffect(() => {
    if (visible) {
      cargar()
      setEdicion(null)
      setVisibles(new Set())
      setError('')
    }
  }, [visible, cargar])

  const guardar = (): void => {
    if (!ambito || !edicion) return
    setError('')
    window.api.credenciales
      .operar('guardar', { ambito, credencial: { ...(edicion.id ? { id: edicion.id } : {}), nombre: edicion.nombre, notas: edicion.notas, campos: edicion.campos.filter((c) => c.clave.trim()) } })
      .then((l) => (setLista(l), setEdicion(null)))
      .catch((e: Error) => setError(limpiar(e.message)))
  }
  const eliminar = async (c: CredencialPrueba): Promise<void> => {
    if (!ambito || !(await confirmar({ titulo: 'Eliminar credencial', tono: 'peligro', etiqueta: 'Eliminar', texto: `Se borra «${c.nombre}» de este equipo.` }))) return
    setLista(await window.api.credenciales.operar('eliminar', { ambito, id: c.id }))
  }
  const cambiarCampo = (i: number, cambios: Partial<CampoCredencial>): void =>
    setEdicion((e) => (e ? { ...e, campos: e.campos.map((c, j) => (j === i ? { ...c, ...cambios } : c)) } : e))
  const alternar = (k: string): void => setVisibles((v) => (v.has(k) ? new Set([...v].filter((x) => x !== k)) : new Set(v).add(k)))
  const copiar = (t: string): void => void navigator.clipboard.writeText(t).catch(() => undefined)

  return (
    <div className="mem">
      <p className="cfg-intro">
        Datos para <strong>probar en local</strong> (usuarios, claves de sandbox, URLs, tokens…). Se guardan <strong>solo en este equipo</strong>
        (<code>~/.odesk-agent/credenciales/</code>): no se sincronizan con tu cuenta ni con otros PCs, así que cada equipo tiene las suyas. El asistente puede
        consultarlas por su cuenta; entregarle los valores pide tu confirmación salvo en modo Autónomo. No guardes aquí credenciales de producción.
      </p>
      <div className="ag-opciones">
        <select value={clave} onChange={(e) => setClave(e.target.value)} aria-label="Proyecto o grupo">
          {datos.grupos.length > 0 && (
            <optgroup label="Grupos (valen para todos sus proyectos)">
              {datos.grupos.map((g) => <option key={g.id} value={`grupo:${g.id}`}>{g.nombre}</option>)}
            </optgroup>
          )}
          <optgroup label="Proyectos">
            {datos.proyectos.map((p) => <option key={p.id} value={`proyecto:${p.id}`}>{p.nombre}</option>)}
          </optgroup>
        </select>
        <button className="primario" disabled={!ambito || !!edicion} onClick={() => setEdicion(VACIA())}>Nueva credencial</button>
      </div>

      {edicion && (
        <section className="cfg-grupo">
          <div className="cfg-grupo-cab"><h3>{edicion.id ? 'Editar credencial' : 'Nueva credencial'}</h3></div>
          <div className="mem-form">
            <input placeholder="Nombre (p. ej. Admin de pruebas, Stripe sandbox)" value={edicion.nombre} onChange={(e) => setEdicion({ ...edicion, nombre: e.target.value })} autoFocus />
            <textarea rows={2} placeholder="Notas (opcional): para qué sirve, cómo entrar…" value={edicion.notas} onChange={(e) => setEdicion({ ...edicion, notas: e.target.value })} />
            {edicion.campos.map((c, i) => (
              <div className="ag-opciones" key={i}>
                <input list="cred-sugeridas" placeholder="Campo" value={c.clave} onChange={(e) => cambiarCampo(i, { clave: e.target.value })} style={{ maxWidth: 160 }} />
                <input
                  type={c.secreto ? 'password' : 'text'}
                  placeholder="Valor"
                  value={c.valor}
                  onChange={(e) => cambiarCampo(i, { valor: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <label className="ag-recordar" title="Se oculta en pantalla">
                  <input type="checkbox" checked={c.secreto === true} onChange={(e) => cambiarCampo(i, { secreto: e.target.checked })} /> secreto
                </label>
                <button className="peligro" style={{ opacity: 1 }} title="Quitar campo" onClick={() => setEdicion({ ...edicion, campos: edicion.campos.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <datalist id="cred-sugeridas">{SUGERIDAS.map((s) => <option key={s} value={s} />)}</datalist>
            <div className="cfg-acciones">
              <button onClick={() => setEdicion({ ...edicion, campos: [...edicion.campos, { clave: '', valor: '', secreto: false }] })}>+ Campo</button>
              <button onClick={() => (setEdicion(null), setError(''))}>Cancelar</button>
              <button className="primario" disabled={!edicion.nombre.trim()} onClick={guardar}>Guardar</button>
            </div>
            {error && <div className="cfg-error">{error}</div>}
          </div>
        </section>
      )}

      <section className="cfg-grupo">
        {lista.length === 0 && !edicion && (
          <EstadoVacio variante="compacto" icono={<IconoEscudo />} titulo="Sin credenciales de prueba" texto="Añade las que necesites para probar este proyecto; solo existen en este equipo." />
        )}
        {lista.map((c) => (
          <div className="cfg-proyecto" key={c.id} style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
            <div className="ag-opciones" style={{ width: '100%' }}>
              <strong>{c.nombre}</strong>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button style={{ opacity: 1 }} onClick={() => setEdicion({ id: c.id, nombre: c.nombre, notas: c.notas ?? '', campos: c.campos.length ? c.campos : VACIA().campos })}>Editar</button>
                <button className="peligro" style={{ opacity: 1 }} onClick={() => void eliminar(c)}>Eliminar</button>
              </span>
            </div>
            {c.notas && <small>{c.notas}</small>}
            {c.campos.map((f, i) => {
              const k = `${c.id}:${i}`
              const oculto = f.secreto && !visibles.has(k)
              return (
                <div key={k} className="ag-opciones" style={{ width: '100%' }}>
                  <span className="chip">{f.clave}</span>
                  <code style={{ flex: 1, overflowWrap: 'anywhere' }}>{oculto ? '••••••••' : f.valor}</code>
                  {f.secreto && <button style={{ opacity: 1 }} onClick={() => alternar(k)}>{oculto ? 'Mostrar' : 'Ocultar'}</button>}
                  <button style={{ opacity: 1 }} onClick={() => copiar(f.valor)}>Copiar</button>
                </div>
              )
            })}
          </div>
        ))}
      </section>
    </div>
  )
}
