import { useCallback, useEffect, useRef, useState } from 'react'
import type { AvisoEquipo } from '@shared/equipos'
import type { DatosProyectos } from '@shared/modelos'
import { enConflicto, type EstadoGit, type OperacionEnCurso } from '@shared/versiones'
import { git, useGit, type ContextoGit } from '../versiones/useGit'
import { EstadoVacio } from './EstadoVacio'
import { IconoMas, IconoRama, IconoReiniciar } from './Iconos'
import { VersionesCambios } from './VersionesCambios'
import { ModalClonar } from './ModalClonar'
import { VersionesEtiquetas } from './VersionesEtiquetas'
import { AvisoEquipos } from './AvisoEquipos'
import { HistorialLocal } from './HistorialLocal'
import { VersionesEquipos } from './VersionesEquipos'
import { VersionesGitHub } from './VersionesGitHub'
import { VersionesHistorial } from './VersionesHistorial'
import { VersionesRamas } from './VersionesRamas'
import { VersionesStash } from './VersionesStash'

type Pestana = 'cambios' | 'historial' | 'ramas' | 'versiones' | 'stash' | 'github' | 'equipos' | 'historial-local'
const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'cambios', nombre: 'Cambios' },
  { id: 'historial', nombre: 'Historial' },
  { id: 'ramas', nombre: 'Ramas' },
  { id: 'versiones', nombre: 'Versiones' },
  { id: 'stash', nombre: 'Stash' },
  { id: 'github', nombre: 'GitHub' },
  { id: 'equipos', nombre: 'Equipos' },
  { id: 'historial-local', nombre: 'Historial local' }
]
const NOMBRE_OPERACION: Record<OperacionEnCurso, string> = { fusion: 'Fusión en curso', revert: 'Revert en curso', 'cherry-pick': 'Cherry-pick en curso', rebase: 'Rebase en curso' }
const CLAVE = 'versiones:proyecto'

const guardado = (): string => {
  try {
    return localStorage.getItem(CLAVE) ?? ''
  } catch {
    return ''
  }
}

interface Props {
  datos: DatosProyectos
  visible: boolean
  /** Se agregó un proyecto (p. ej. al clonar): la aplicación refresca su lista. */
  onDatos: (d: DatosProyectos) => void
  /** Otros equipos con trabajo pendiente en los proyectos de este equipo. */
  avisos?: AvisoEquipo[]
}

/** Control de versiones con git de cada proyecto: cambios, historial, ramas, versiones (etiquetas) y stash. */
export function Versiones({ datos, visible, onDatos, avisos = [] }: Props) {
  const [proyectoId, setProyectoId] = useState(guardado)
  const [pestana, setPestana] = useState<Pestana>('cambios')
  const [aviso, setAviso] = useState('')
  const [conflictos, setConflictos] = useState('')
  const temporizador = useRef<number | undefined>(undefined)
  const [ident, setIdent] = useState({ nombre: '', correo: '', global: true })
  const [clonando, setClonando] = useState(false)
  const [conectado, setConectado] = useState(false)

  useEffect(() => {
    if (!datos.proyectos.some((p) => p.id === proyectoId)) setProyectoId(datos.proyectos[0]?.id ?? '')
  }, [datos.proyectos, proyectoId])
  useEffect(() => {
    try {
      if (proyectoId) localStorage.setItem(CLAVE, proyectoId)
    } catch {
      /* sin almacenamiento: no se recuerda el proyecto */
    }
  }, [proyectoId])
  useEffect(() => () => window.clearTimeout(temporizador.current), [])

  const g = useGit(proyectoId, visible)
  const { estado, identidad, error, setError, ocupado, cargando, recargar, run, aplicar, tick } = g
  const proyecto = datos.proyectos.find((p) => p.id === proyectoId)

  const avisar = useCallback((texto: string): void => {
    setAviso(texto)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setAviso(''), 6000)
  }, [])
  useEffect(() => setConflictos(''), [proyectoId])
  // Cuando ya no hay conflictos el aviso destacado sobra.
  useEffect(() => {
    if (estado && enConflicto(estado).length === 0 && !estado.operacion) setConflictos('')
  }, [estado])

  const primeraLinea = (t: string): string => t.split('\n').filter(Boolean).slice(-1)[0] ?? ''
  const sincronizar = {
    obtener: (): void => void run('Obteniendo…', () => git('obtener', { proyectoId })).then((r) => r && (aplicar(r.estado), avisar(primeraLinea(r.mensaje) || 'Todo al día.'))),
    traer: (rebase = false): void =>
      void run('Trayendo…', () => git('traer', { proyectoId, rebase })).then((r) => {
        if (!r) return
        aplicar(r.estado)
        if (r.conflictos) setConflictos('Al traer los cambios hubo conflictos: resuélvelos y confirma, o aborta la operación.')
        else avisar(primeraLinea(r.mensaje) || 'Cambios traídos.')
      }),
    enviar: (): void => void run('Enviando…', () => git('enviar', { proyectoId })).then((r) => r && (aplicar(r.estado), avisar('Cambios enviados al remoto.'))),
    abortar: (): void => void run('Abortando…', () => git('abortar', { proyectoId })).then((e) => e && (aplicar(e), setConflictos(''), avisar('Operación abortada.'))),
    continuar: (): void =>
      void run('Continuando…', () => git('continuar', { proyectoId })).then((r) => {
        if (!r) return
        aplicar(r.estado)
        if (r.conflictos) setConflictos('Quedan conflictos por resolver.')
        else avisar('Rebase terminado.')
      }),
    iniciar: (): void => void run('Inicializando…', () => git('iniciar', { proyectoId })).then((e) => e && (aplicar(e), avisar('Repositorio inicializado.')))
  }

  const contexto: ContextoGit | null = estado?.repo
    ? { proyectoId, estado, run, ocupado, aplicar, tick, recargar, avisar, avisarConflictos: setConflictos, mostrarError: setError, ocupadoGlobal: ocupado !== '' }
    : null

  const sinIdentidad = Boolean(estado?.repo && identidad && (!identidad.nombre || !identidad.correo))
  const guardarIdentidad = (): void => {
    void run('Guardando…', () => git('fijarIdentidad', { proyectoId, nombre: ident.nombre, correo: ident.correo, global: ident.global })).then((i) => {
      if (i) (g.setIdentidad(i), avisar('Identidad guardada.'))
    })
  }
  const sincro = (e: EstadoGit): { puedeEnviar: boolean; puedeTraer: boolean } => ({ puedeEnviar: e.remotos.length > 0 && !e.sinCommits && Boolean(e.rama), puedeTraer: Boolean(e.upstream) })

  // El historial local no depende de git: se puede ver aunque la carpeta no sea un repositorio (o git no responda).
  const local = pestana === 'historial-local' && Boolean(proyecto)
  let cuerpo: React.ReactNode
  if (local) {
    cuerpo = <HistorialLocal proyectoId={proyectoId} tick={tick} avisar={avisar} />
  } else if (!proyecto) {
    cuerpo = <EstadoVacio icono={<IconoRama />} titulo="Aún no hay proyectos" texto="Agrega un proyecto desde la barra lateral para gestionar sus versiones con git." />
  } else if (!estado) {
    cuerpo = error ? <EstadoVacio icono={<IconoRama />} titulo="No se pudo leer el repositorio" texto={<span style={{ whiteSpace: 'pre-wrap' }}>{error}</span>} accion={<button onClick={() => void recargar()}>Reintentar</button>} /> : <p className="tareas-vacio">Cargando…</p>
  } else if (!estado.repo) {
    cuerpo = (
      <EstadoVacio
        icono={<IconoRama />}
        titulo="Este proyecto aún no usa git"
        texto="Inicializa un repositorio para guardar el historial de cambios, trabajar en ramas y publicar versiones."
        accion={
          <>
            <button className="primario" disabled={ocupado !== ''} onClick={sincronizar.iniciar}>
              <IconoMas /> Inicializar repositorio
            </button>
            <button onClick={() => (void window.api.github.operar('estado', {}).then((e) => setConectado(e.conectado)).catch(() => undefined), setClonando(true))}>Clonar uno de GitHub</button>
          </>
        }
      />
    )
  } else if (contexto) {
    cuerpo = (
      <>
        {pestana === 'cambios' && <VersionesCambios c={contexto} />}
        {pestana === 'historial' && <VersionesHistorial c={contexto} />}
        {pestana === 'ramas' && <VersionesRamas c={contexto} />}
        {pestana === 'versiones' && <VersionesEtiquetas c={contexto} />}
        {pestana === 'stash' && <VersionesStash c={contexto} />}
        {pestana === 'github' && <VersionesGitHub c={contexto} />}
        {pestana === 'equipos' && <VersionesEquipos c={contexto} />}
      </>
    )
  }

  const pestanaVisible = estado?.repo || pestana === 'historial-local' ? pestana : 'cambios'
  const s = estado?.repo ? sincro(estado) : undefined
  return (
    <main className="versiones" style={{ display: visible ? 'flex' : 'none' }}>
      <header className="tareas-barra vc-barra">
        <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)} aria-label="Proyecto">
          {datos.proyectos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        {estado?.repo && (
          <>
            <span className="vc-rama" title={estado.raiz}>
              <IconoRama /> {estado.rama ?? `(${estado.desacoplado ?? 'sin commits'})`}
            </span>
            {estado.upstream && (
              <span className="chip" title={`Sigue a ${estado.upstream}`}>
                ↑{estado.adelante} ↓{estado.atras}
              </span>
            )}
            {estado.desacoplado && <span className="chip chip-aviso" title="Estás en un commit, no en una rama">HEAD desacoplado</span>}
          </>
        )}
        <span className="ag-espacio" />
        {s && estado && (
          <>
            <button onClick={sincronizar.obtener} disabled={ocupado !== '' || estado.remotos.length === 0} title={estado.remotos.length ? 'Consultar el remoto sin tocar tus archivos' : 'Este repositorio no tiene remotos'}>
              Obtener
            </button>
            <button onClick={() => sincronizar.traer(false)} disabled={ocupado !== '' || !s.puedeTraer} title={s.puedeTraer ? 'Traer y avanzar con los cambios del remoto (sin mezclar)' : 'La rama no sigue a ninguna remota'}>
              Traer{estado.atras > 0 ? ` ↓${estado.atras}` : ''}
            </button>
            {estado.atras > 0 && estado.adelante > 0 && (
              <button onClick={() => sincronizar.traer(true)} disabled={ocupado !== ''} title="Tu rama y la remota han divergido: reaplica tus commits sobre los del remoto">
                Traer con rebase
              </button>
            )}
            <button className="primario" onClick={sincronizar.enviar} disabled={ocupado !== '' || !s.puedeEnviar} title={s.puedeEnviar ? undefined : estado.remotos.length ? 'Nada que enviar todavía' : 'Agrega un remoto en la pestaña «Ramas»'}>
              {estado.upstream ? `Enviar${estado.adelante > 0 ? ` ↑${estado.adelante}` : ''}` : 'Publicar rama'}
            </button>
          </>
        )}
        <button onClick={() => (void window.api.github.operar('estado', {}).then((e) => setConectado(e.conectado)).catch(() => undefined), setClonando(true))} title="Clonar un repositorio de GitHub (o por URL) y agregarlo como proyecto">
          Clonar
        </button>
        <button className="icono" onClick={() => void recargar()} disabled={cargando} title="Actualizar" aria-label="Actualizar">
          <IconoReiniciar />
        </button>
      </header>

      {proyecto && (
        <nav className="vc-tabs" aria-label="Control de versiones">
          <div className="segmentado" role="tablist">
            {(estado?.repo ? PESTANAS : [{ id: 'cambios' as Pestana, nombre: 'Git' }, PESTANAS.at(-1)!]).map((p) => (
              <button key={p.id} role="tab" aria-selected={pestanaVisible === p.id} className={pestanaVisible === p.id ? 'on' : ''} onClick={() => setPestana(p.id)}>
                {p.nombre}
                {p.id === 'cambios' && estado?.repo && estado.archivos.length > 0 && <span className="vc-cuenta">{estado.archivos.length}</span>}
              </button>
            ))}
          </div>
          {ocupado && <span className="vc-ocupado"><span className="spinner" /> {ocupado}</span>}
        </nav>
      )}

      <AvisoEquipos key={proyectoId} avisos={avisos.filter((a) => a.proyectoId === proyectoId)} onVerEquipos={() => setPestana('equipos')} />

      {estado?.operacion && (
        <div className="vc-banner aviso" role="status">
          <strong>{NOMBRE_OPERACION[estado.operacion]}.</strong>
          <span>{enConflicto(estado).length > 0 ? `${enConflicto(estado).length} archivo(s) en conflicto: resuélvelos, márcalos como resueltos (＋) y ${estado.operacion === 'rebase' ? 'continúa' : 'confirma'}.` : estado.operacion === 'rebase' ? 'Sin conflictos pendientes: puedes continuar.' : 'Sin conflictos pendientes: confirma para terminar.'}</span>
          <span className="ag-espacio" />
          {estado.operacion === 'rebase' && enConflicto(estado).length === 0 && (
            <button className="primario" disabled={ocupado !== ''} onClick={sincronizar.continuar}>
              Continuar
            </button>
          )}
          <button disabled={ocupado !== ''} onClick={sincronizar.abortar}>
            Abortar
          </button>
        </div>
      )}
      {conflictos && !estado?.operacion && (
        <div className="vc-banner aviso" role="status">
          {conflictos}
          <span className="ag-espacio" />
          <button className="icono" onClick={() => setConflictos('')} aria-label="Cerrar aviso">
            ✕
          </button>
        </div>
      )}
      {sinIdentidad && (
        <form
          className="vc-banner info"
          onSubmit={(e) => {
            e.preventDefault()
            guardarIdentidad()
          }}
        >
          <strong>Dile a git quién eres</strong>
          <span className="tareas-suave">Hace falta para confirmar cambios.</span>
          <input value={ident.nombre} onChange={(e) => setIdent({ ...ident, nombre: e.target.value })} placeholder="Tu nombre" aria-label="Nombre" />
          <input value={ident.correo} onChange={(e) => setIdent({ ...ident, correo: e.target.value })} placeholder="tu@correo.com" aria-label="Correo" />
          <label className="vc-casilla">
            <input type="checkbox" checked={ident.global} onChange={(e) => setIdent({ ...ident, global: e.target.checked })} /> En todos mis proyectos
          </label>
          <button className="primario" type="submit" disabled={!ident.nombre.trim() || !ident.correo.trim() || ocupado !== ''}>
            Guardar
          </button>
        </form>
      )}
      {error && estado && (
        <div className="vc-banner error" role="alert">
          <span className="vc-error-texto">{error}</span>
          <button className="icono" onClick={() => setError('')} aria-label="Cerrar aviso">
            ✕
          </button>
        </div>
      )}
      {aviso && (
        <div className="vc-banner ok" role="status">
          {aviso}
        </div>
      )}
      <div className="vc-cuerpo">{cuerpo}</div>
      {clonando && (
        <ModalClonar
          datos={datos}
          conectado={conectado}
          onCerrar={() => setClonando(false)}
          onClonado={(id) => {
            void window.api.proyectos.listar().then((d) => {
              onDatos(d)
              setProyectoId(id)
              setPestana('cambios')
              avisar('Repositorio clonado y agregado como proyecto.')
            })
          }}
        />
      )}
    </main>
  )
}
