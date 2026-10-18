import { useMemo, useState } from 'react'
import { METODOS, analizarJson, variablesSinResolver, type Autenticacion, type MetodoHttp, type PeticionApi } from '@shared/api'
import { TablaClaveValor } from './TablaClaveValor'

type Pestana = 'parametros' | 'cabeceras' | 'cuerpo' | 'auth' | 'opciones'

const CABECERAS = ['Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type', 'Cookie', 'If-None-Match', 'Origin', 'Referer', 'User-Agent', 'X-Api-Key', 'X-Requested-With'] as const

interface Props {
  peticion: PeticionApi
  vars: Record<string, string>
  enviando: boolean
  guardada: boolean
  sucio: boolean
  onCambio: (p: PeticionApi) => void
  onEnviar: () => void
  onCancelar: () => void
  onGuardar: () => void
  onCurl: () => void
  onEntornos: () => void
}

export function ApiPeticion({ peticion: p, vars, enviando, guardada, sucio, onCambio, onEnviar, onCancelar, onGuardar, onCurl, onEntornos }: Props) {
  const [pestana, setPestana] = useState<Pestana>('parametros')
  const faltan = useMemo(() => variablesSinResolver(p, vars), [p, vars])
  const cambiar = (parche: Partial<PeticionApi>): void => onCambio({ ...p, ...parche })
  const json = p.cuerpo.tipo === 'json' ? analizarJson(p.cuerpo.texto) : undefined
  const jsonInvalido = p.cuerpo.tipo === 'json' && p.cuerpo.texto.trim() !== '' && !json
  const activos = (l: { activo: boolean; clave: string }[]): number => l.filter((x) => x.activo && x.clave.trim()).length
  const cuenta = (n: number): React.ReactNode => (n > 0 ? <span className="vc-cuenta">{n}</span> : null)

  const formatear = (): void => {
    if (p.cuerpo.tipo === 'json' && json) onCambio({ ...p, cuerpo: { tipo: 'json', texto: JSON.stringify(json.valor, null, 2) } })
  }
  const auth = (a: Autenticacion): void => cambiar({ auth: a })

  return (
    <div className="api-peticion" onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !enviando && onEnviar()}>
      <div className="api-linea">
        <select className={`api-metodo api-m-${p.metodo}`} value={p.metodo} onChange={(e) => cambiar({ metodo: e.target.value as MetodoHttp })} aria-label="Método HTTP">
          {METODOS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="api-url"
          value={p.url}
          placeholder="http://localhost:3000/api/… o {{base}}/ruta"
          title="URL de la petición; admite {{variables}} del entorno activo"
          spellCheck={false}
          onChange={(e) => cambiar({ url: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !enviando && onEnviar()}
          aria-label="URL"
        />
        {enviando ? (
          <button onClick={onCancelar}>Cancelar</button>
        ) : (
          <button className="primario" onClick={onEnviar} disabled={!p.url.trim()} title="Enviar (Enter o Ctrl+Enter)">
            Enviar
          </button>
        )}
        <button onClick={onGuardar} disabled={!p.url.trim()} title={guardada ? 'Guardar los cambios en la colección' : 'Guardar en una colección'}>
          {guardada ? (sucio ? 'Guardar cambios' : 'Guardada') : 'Guardar'}
        </button>
        <button className="icono" onClick={onCurl} disabled={!p.url.trim()} title="Copiar como cURL" aria-label="Copiar como cURL">
          ⧉ cURL
        </button>
      </div>
      {faltan.length > 0 && (
        <p className="api-aviso" role="status">
          Variables sin definir: {faltan.map((v) => <code key={v}>{`{{${v}}}`}</code>)}.{' '}
          <button className="enlace" onClick={onEntornos}>
            Gestionar entornos
          </button>
        </p>
      )}
      <div className="vc-tabs api-sub">
        <div className="segmentado" role="tablist">
          <button role="tab" aria-selected={pestana === 'parametros'} className={pestana === 'parametros' ? 'on' : ''} onClick={() => setPestana('parametros')}>
            Parámetros {cuenta(activos(p.consulta))}
          </button>
          <button role="tab" aria-selected={pestana === 'cabeceras'} className={pestana === 'cabeceras' ? 'on' : ''} onClick={() => setPestana('cabeceras')}>
            Cabeceras {cuenta(activos(p.cabeceras))}
          </button>
          <button role="tab" aria-selected={pestana === 'cuerpo'} className={pestana === 'cuerpo' ? 'on' : ''} onClick={() => setPestana('cuerpo')}>
            Cuerpo {p.cuerpo.tipo !== 'ninguno' && <span className="vc-cuenta">•</span>}
          </button>
          <button role="tab" aria-selected={pestana === 'auth'} className={pestana === 'auth' ? 'on' : ''} onClick={() => setPestana('auth')}>
            Autenticación {p.auth.tipo !== 'ninguna' && <span className="vc-cuenta">•</span>}
          </button>
          <button role="tab" aria-selected={pestana === 'opciones'} className={pestana === 'opciones' ? 'on' : ''} onClick={() => setPestana('opciones')}>
            Opciones
          </button>
        </div>
      </div>
      <div className="api-editor">
        {pestana === 'parametros' && <TablaClaveValor etiqueta="Parámetros de la URL" filas={p.consulta} onCambio={(consulta) => cambiar({ consulta })} textoClave="Parámetro" />}
        {pestana === 'cabeceras' && <TablaClaveValor etiqueta="Cabeceras" filas={p.cabeceras} onCambio={(cabeceras) => cambiar({ cabeceras })} textoClave="Cabecera" sugerencias={CABECERAS} />}
        {pestana === 'cuerpo' && (
          <div className="api-cuerpo">
            <div className="api-cuerpo-barra">
              <select
                value={p.cuerpo.tipo}
                onChange={(e) => {
                  const t = e.target.value as PeticionApi['cuerpo']['tipo']
                  cambiar({ cuerpo: t === 'ninguno' ? { tipo: 'ninguno' } : t === 'formulario' ? { tipo: 'formulario', campos: [] } : { tipo: t, texto: p.cuerpo.tipo === 'json' || p.cuerpo.tipo === 'texto' ? p.cuerpo.texto : '' } })
                }}
                aria-label="Tipo de cuerpo"
              >
                <option value="ninguno">Sin cuerpo</option>
                <option value="json">JSON</option>
                <option value="texto">Texto</option>
                <option value="formulario">Formulario (x-www-form-urlencoded)</option>
              </select>
              {p.cuerpo.tipo === 'json' && (
                <>
                  <button onClick={formatear} disabled={!json}>
                    Formatear
                  </button>
                  <span className={json ? 'api-ok' : jsonInvalido ? 'api-mal' : 'tareas-suave'}>{json ? 'JSON válido' : jsonInvalido ? 'JSON no válido' : ''}</span>
                </>
              )}
              {(p.metodo === 'GET' || p.metodo === 'HEAD') && p.cuerpo.tipo !== 'ninguno' && <span className="chip chip-aviso">Con {p.metodo} no se envía el cuerpo</span>}
            </div>
            {(p.cuerpo.tipo === 'json' || p.cuerpo.tipo === 'texto') && (
              <textarea
                className="api-texto"
                spellCheck={false}
                value={p.cuerpo.texto}
                placeholder={p.cuerpo.tipo === 'json' ? '{\n  "nombre": "Ana"\n}' : 'Texto del cuerpo'}
                onChange={(e) => cambiar({ cuerpo: { tipo: p.cuerpo.tipo as 'json' | 'texto', texto: e.target.value } })}
                aria-label="Cuerpo de la petición"
              />
            )}
            {p.cuerpo.tipo === 'formulario' && <TablaClaveValor etiqueta="Campos del formulario" filas={p.cuerpo.campos} onCambio={(campos) => cambiar({ cuerpo: { tipo: 'formulario', campos } })} textoClave="Campo" />}
            {p.cuerpo.tipo === 'ninguno' && <p className="vc-nota" style={{ padding: 16 }}>Esta petición no envía cuerpo. Elige JSON, texto o formulario para añadirlo.</p>}
          </div>
        )}
        {pestana === 'auth' && (
          <div className="api-auth">
            <select
              value={p.auth.tipo}
              onChange={(e) => {
                const t = e.target.value as Autenticacion['tipo']
                auth(t === 'bearer' ? { tipo: 'bearer', token: '' } : t === 'basica' ? { tipo: 'basica', usuario: '', clave: '' } : t === 'clave-api' ? { tipo: 'clave-api', nombre: 'X-Api-Key', valor: '', en: 'cabecera' } : { tipo: 'ninguna' })
              }}
              aria-label="Tipo de autenticación"
            >
              <option value="ninguna">Sin autenticación</option>
              <option value="bearer">Token (Bearer)</option>
              <option value="basica">Usuario y contraseña (Basic)</option>
              <option value="clave-api">Clave de API</option>
            </select>
            {p.auth.tipo === 'bearer' && (
              <label>
                Token
                <input value={p.auth.token} placeholder="{{token}}" spellCheck={false} onChange={(e) => auth({ tipo: 'bearer', token: e.target.value })} />
              </label>
            )}
            {p.auth.tipo === 'basica' && (
              <>
                <label>
                  Usuario
                  <input value={p.auth.usuario} onChange={(e) => auth({ ...(p.auth as Extract<Autenticacion, { tipo: 'basica' }>), usuario: e.target.value })} />
                </label>
                <label>
                  Contraseña
                  <input type="password" value={p.auth.clave} onChange={(e) => auth({ ...(p.auth as Extract<Autenticacion, { tipo: 'basica' }>), clave: e.target.value })} />
                </label>
              </>
            )}
            {p.auth.tipo === 'clave-api' && (
              <>
                <label>
                  Nombre
                  <input value={p.auth.nombre} onChange={(e) => auth({ ...(p.auth as Extract<Autenticacion, { tipo: 'clave-api' }>), nombre: e.target.value })} />
                </label>
                <label>
                  Valor
                  <input value={p.auth.valor} placeholder="{{apiKey}}" spellCheck={false} onChange={(e) => auth({ ...(p.auth as Extract<Autenticacion, { tipo: 'clave-api' }>), valor: e.target.value })} />
                </label>
                <label>
                  Enviar en
                  <select value={p.auth.en} onChange={(e) => auth({ ...(p.auth as Extract<Autenticacion, { tipo: 'clave-api' }>), en: e.target.value as 'cabecera' | 'consulta' })}>
                    <option value="cabecera">Cabecera</option>
                    <option value="consulta">Parámetro de la URL</option>
                  </select>
                </label>
              </>
            )}
            {p.auth.tipo !== 'ninguna' && <p className="vc-nota">Si ya escribes una cabecera Authorization a mano, esa es la que se envía. Las credenciales se guardan en tu equipo, sin cifrar: usa variables de entorno para los tokens.</p>}
          </div>
        )}
        {pestana === 'opciones' && (
          <div className="api-auth">
            <label className="vc-casilla">
              <input type="checkbox" checked={p.opciones.seguirRedirecciones} onChange={(e) => cambiar({ opciones: { ...p.opciones, seguirRedirecciones: e.target.checked } })} /> Seguir redirecciones (301, 302, 303, 307, 308)
            </label>
            <label className="vc-casilla">
              <input type="checkbox" checked={p.opciones.ignorarCertificado} onChange={(e) => cambiar({ opciones: { ...p.opciones, ignorarCertificado: e.target.checked } })} /> Ignorar errores de certificado (https autofirmado en local)
            </label>
            <label>
              Tiempo máximo (segundos)
              <input type="number" min={1} max={300} value={Math.round(p.opciones.tiempoMs / 1000)} onChange={(e) => cambiar({ opciones: { ...p.opciones, tiempoMs: Math.min(Math.max(Number(e.target.value) || 30, 1), 300) * 1000 } })} />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
