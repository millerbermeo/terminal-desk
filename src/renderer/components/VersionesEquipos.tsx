import { useCallback, useEffect, useState } from 'react'
import { EQUIPO_INACTIVO_MS, situacionDe, trabajandoAhora, type EquipoProyecto, type EstadoArchivoEquipo, type SituacionEquipo } from '@shared/equipos'
import { fechaRelativa } from '@shared/versiones'
import { mensajeDe } from '../tareas/useTareas'
import type { ContextoGit } from '../versiones/useGit'
import { EstadoVacio } from './EstadoVacio'
import { IconoMonitor, IconoReiniciar } from './Iconos'
import { ModalConfirmar } from './ModalConfirmar'

const eq = window.api.equipos.operar

const ESTADO_ARCHIVO: Record<EstadoArchivoEquipo, { letra: string; nombre: string; clase: string }> = {
  M: { letra: 'M', nombre: 'modificado', clase: 'mod' },
  A: { letra: 'A', nombre: 'añadido', clase: 'nuevo' },
  N: { letra: 'N', nombre: 'nuevo (sin seguimiento)', clase: 'nuevo' },
  D: { letra: 'D', nombre: 'borrado', clase: 'borrado' },
  R: { letra: 'R', nombre: 'renombrado', clase: 'mod' },
  C: { letra: 'C', nombre: 'copiado', clase: 'nuevo' },
  T: { letra: 'T', nombre: 'cambió de tipo', clase: 'mod' },
  U: { letra: 'U', nombre: 'en conflicto', clase: 'borrado' }
}

/** Los archivos que cambió ese equipo (solo nombre, estado y líneas; nunca el contenido). */
function ArchivosEquipo({ e }: { e: EquipoProyecto }) {
  const [abierto, setAbierto] = useState(false)
  if (e.cambios === 0 && e.archivos.length === 0) return null
  const resto = e.cambios - e.archivos.length
  return (
    <div className="eq-archivos">
      <button className="enlace" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        {abierto ? '▾' : '▸'} {e.cambios} archivo{e.cambios === 1 ? '' : 's'} sin guardar
        {e.lineasMas + e.lineasMenos > 0 && (
          <span className="mono eq-lineas">
            {' '}
            <b className="mas">+{e.lineasMas}</b> <b className="menos">−{e.lineasMenos}</b>
          </span>
        )}
      </button>
      {abierto && (
        <ul className="eq-archivos-lista">
          {e.archivos.map((a) => (
            <li key={a.ruta}>
              <span className={`eq-letra ${ESTADO_ARCHIVO[a.estado].clase}`} title={ESTADO_ARCHIVO[a.estado].nombre}>
                {ESTADO_ARCHIVO[a.estado].letra}
              </span>
              <span className="mono eq-ruta" title={a.ruta}>
                {a.ruta}
              </span>
              {a.mas + a.menos > 0 && (
                <span className="mono eq-lineas">
                  <b className="mas">+{a.mas}</b> <b className="menos">−{a.menos}</b>
                </span>
              )}
            </li>
          ))}
          {resto > 0 && <li className="vc-nota">…y {resto} más</li>}
        </ul>
      )}
    </div>
  )
}

/** Lo que ese equipo tiene en su historial local de versiones (solo nombres y fechas: el contenido se queda en ese equipo). */
function HistorialEquipo({ e }: { e: EquipoProyecto }) {
  const [abierto, setAbierto] = useState(false)
  if (e.versionesHistorial === 0) return null
  const ahora = Date.now()
  return (
    <div className="eq-archivos eq-hist">
      <button className="enlace" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        {abierto ? '▾' : '▸'} 🕘 {e.versionesHistorial} {e.versionesHistorial === 1 ? 'versión' : 'versiones'} en su historial local
      </button>
      {abierto && (
        <>
          <ul className="eq-archivos-lista">
            {e.historial.map((h) => (
              <li key={h.ruta}>
                <span className="mono eq-ruta" title={h.ruta}>
                  {h.ruta}
                </span>
                <span className="mono eq-lineas">×{h.versiones}</span>
                <small className="eq-visto">{fechaRelativa(h.ultima, ahora)}</small>
              </li>
            ))}
          </ul>
          <p className="vc-nota">Esas versiones están solo en {e.esteEquipo ? 'este equipo' : 'ese equipo'}: {e.esteEquipo ? 'ábrelas en la pestaña «Historial local».' : 'ábrelas allí para ver su contenido.'}</p>
        </>
      )}
    </div>
  )
}

const SITUACION: Record<SituacionEquipo, { texto: (e: EquipoProyecto) => string; clase: string; ayuda: string }> = {
  'al-dia': { texto: () => 'Al día', clase: 'chip-ok', ayuda: 'Tiene todo lo que hay en el remoto y no le sobra nada.' },
  adelantado: { texto: (e) => `↑ ${e.adelante} por enviar`, clase: 'chip-aviso', ayuda: 'Tiene commits que aún no están en el remoto: hay que enviarlos (push).' },
  atrasado: { texto: (e) => `↓ ${e.atras} por traer`, clase: 'chip-aviso', ayuda: 'El remoto tiene commits que a este equipo le faltan: hay que traerlos (pull).' },
  divergido: { texto: (e) => `↑ ${e.adelante} ↓ ${e.atras} divergido`, clase: 'api-estado-servidor', ayuda: 'Tiene commits propios y al remoto le faltan otros: hay que traer y combinar antes de enviar.' },
  'sin-remoto': { texto: () => 'Sin remoto', clase: '', ayuda: 'Su rama no sigue ninguna rama remota, así que no se puede comparar.' }
}

/** Mis equipos: en qué rama y commit está este proyecto en cada PC de la cuenta y si va adelante o atrás de su remoto. */
export function VersionesEquipos({ c }: { c: ContextoGit }) {
  const { proyectoId, tick, avisar } = c
  const [datos, setDatos] = useState<{ equipos: EquipoProyecto[] } | null>(null)
  const [fallo, setFallo] = useState('')
  const [cargando, setCargando] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [olvidar, setOlvidar] = useState<EquipoProyecto | null>(null)
  const [ahora, setAhora] = useState(() => Date.now())

  const cargar = useCallback(async (): Promise<void> => {
    setCargando(true)
    try {
      setDatos(await eq('listar', { proyectoId }))
      setFallo('')
    } catch (e) {
      setFallo(mensajeDe(e))
    } finally {
      setCargando(false)
      setAhora(Date.now())
    }
  }, [proyectoId])

  useEffect(() => {
    void cargar()
    const t = setInterval(() => void cargar(), 30_000)
    return () => clearInterval(t)
  }, [cargar, tick])

  const yo = datos?.equipos.find((e) => e.esteEquipo)
  const alDia = datos?.equipos.filter((e) => situacionDe(e) === 'al-dia').length ?? 0

  const renombrar = async (nombre: string): Promise<void> => {
    try {
      await eq('renombrar', { nombre })
      await eq('informar', {})
      setEditando(null)
      await cargar()
    } catch (e) {
      setFallo(mensajeDe(e))
    }
  }

  if (!datos) return fallo ? <p className="vc-nota error" style={{ padding: 24 }}>{fallo}</p> : <p className="tareas-vacio">Cargando…</p>

  return (
    <div className="vc-pagina">
      <div className="eq-cab">
        <div>
          <h3 className="eq-titulo">Mis equipos</h3>
          <p className="vc-nota">
            {datos.equipos.length} {datos.equipos.length === 1 ? 'equipo' : 'equipos'} con este proyecto · {alDia} al día
          </p>
        </div>
        <button className="icono" onClick={() => void cargar()} disabled={cargando} title="Actualizar" aria-label="Actualizar equipos">
          {cargando ? <span className="spinner" /> : <IconoReiniciar />}
        </button>
      </div>
      {fallo && <p className="vc-nota error">{fallo}</p>}

      {datos.equipos.length <= 1 && (
        <p className="vc-nota eq-pista">Abre este proyecto en otra computadora con tu misma cuenta (clónalo desde «En tu cuenta» en la barra lateral) y aparecerá aquí con su rama y su commit.</p>
      )}

      <ul className="eq-lista">
        {datos.equipos.map((e) => {
          const sit = situacionDe(e)
          const activo = ahora - Date.parse(e.actualizado) < EQUIPO_INACTIVO_MS
          const trabajando = trabajandoAhora(e, ahora)
          const mismoCommit = yo && !e.esteEquipo && e.commit && yo.commit ? e.commit === yo.commit : undefined
          return (
            <li key={e.idEquipo} className={`eq-fila${e.esteEquipo ? ' yo' : ''}${activo ? '' : ' inactivo'}`}>
              <span className="eq-icono" aria-hidden="true">
                <IconoMonitor />
                <i className={`eq-punto${activo ? ' on' : ''}`} title={activo ? 'Conectado' : 'Sin conexión reciente'} />
              </span>
              <div className="eq-datos">
                <div className="eq-nombre">
                  {editando === e.idEquipo ? (
                    <form
                      className="td-fila"
                      onSubmit={(ev) => {
                        ev.preventDefault()
                        const v = new FormData(ev.currentTarget).get('nombre')
                        void renombrar(typeof v === 'string' ? v : '')
                      }}
                    >
                      <input name="nombre" defaultValue={e.nombre} autoFocus maxLength={120} aria-label="Nombre de este equipo" onKeyDown={(ev) => ev.key === 'Escape' && setEditando(null)} />
                      <button className="primario" type="submit">Guardar</button>
                      <button type="button" onClick={() => setEditando(null)}>Cancelar</button>
                    </form>
                  ) : (
                    <>
                      <strong>{e.nombre}</strong>
                      {e.esteEquipo && <span className="chip eq-yo">este equipo</span>}
                      {e.esteEquipo && (
                        <button className="enlace" onClick={() => setEditando(e.idEquipo)}>
                          Cambiar nombre
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="eq-git">
                  <span className="chip mono" title="Rama">{e.rama ?? 'cabeza suelta'}</span>
                  {e.commit && (
                    <span className="mono eq-commit" title={e.commit}>
                      {e.commit.slice(0, 7)}
                    </span>
                  )}
                  {e.asunto && <span className="eq-asunto">{e.asunto}</span>}
                </div>
                <div className="eq-estados">
                  <span className={`chip ${SITUACION[sit].clase}`} title={SITUACION[sit].ayuda}>
                    {SITUACION[sit].texto(e)}
                  </span>
                  {trabajando && <span className="chip chip-ok eq-trabajando" title="Modificó archivos hace menos de 3 minutos">trabajando ahora</span>}
                  {!trabajando && e.ultimaActividad && e.cambios > 0 && <span className="chip" title="La última vez que se modificó un archivo con cambios">editó {fechaRelativa(e.ultimaActividad, ahora)}</span>}
                  {e.fechaCommit && <span className="chip" title="Fecha del último commit de ese equipo">commit {fechaRelativa(e.fechaCommit, ahora)}</span>}
                  {mismoCommit !== undefined && (
                    <span className={`chip ${mismoCommit ? 'chip-ok' : ''}`} title="Comparado con el commit de este equipo">
                      {mismoCommit ? 'mismo commit que aquí' : 'commit distinto al de aquí'}
                    </span>
                  )}
                  <span className="eq-visto">{activo ? 'conectado' : `visto ${fechaRelativa(e.actualizado, ahora)}`}</span>
                </div>
                <ArchivosEquipo e={e} />
                <HistorialEquipo e={e} />
              </div>
              {!e.esteEquipo && (
                <button className="peligro icono" onClick={() => setOlvidar(e)} title="Quitar de la lista" aria-label={`Quitar ${e.nombre} de la lista`}>
                  ✕
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {datos.equipos.length === 0 && <EstadoVacio icono={<IconoMonitor />} titulo="Aún no hay equipos" texto="Este proyecto no es un repositorio git con commits, o todavía no se informó. Haz un commit y aparecerá." variante="compacto" />}

      {olvidar && (
        <ModalConfirmar
          titulo={`¿Quitar «${olvidar.nombre}» de la lista?`}
          texto="Solo se quita de esta lista; no se borra nada en ese equipo. Si sigue encendido con la app abierta, volverá a aparecer."
          etiqueta="Quitar"
          tono="aviso"
          onCerrar={() => setOlvidar(null)}
          onConfirmar={() => {
            const e = olvidar
            setOlvidar(null)
            void eq('olvidar', { proyectoId, idEquipo: e.idEquipo })
              .then(() => (avisar(`«${e.nombre}» quitado de la lista.`), cargar()))
              .catch((err) => setFallo(mensajeDe(err)))
          }}
        />
      )}
    </div>
  )
}
