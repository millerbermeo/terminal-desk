import type { NombreOperacionGitHub, OperacionesGitHub } from '@shared/github'
import type { ServicioGitHub } from './servicio'

type Entrada<K extends NombreOperacionGitHub> = OperacionesGitHub[K]['entrada']
type Implementaciones = { [K in NombreOperacionGitHub]: (s: ServicioGitHub, e: Entrada<K>) => Promise<OperacionesGitHub[K]['salida']> }

const OPERACIONES: Implementaciones = {
  estado: (s, e) => s.estado(typeof e.proyectoId === 'string' ? e.proyectoId : undefined),
  conectar: (s, e) => s.conectar(e.token),
  configurarOauth: (s, e) => s.configurarOauth(e.clientId),
  dispositivoIniciar: (s) => s.dispositivoIniciar(),
  dispositivoEsperar: (s) => s.dispositivoEsperar(),
  dispositivoCancelar: async (s) => s.dispositivoCancelar(),
  desconectar: (s) => s.desconectar(),
  repos: (s, e) => s.repos(e.texto, e.pagina),
  cuenta: (s) => s.cuenta(),
  orgs: (s) => s.orgs(),
  actividad: (s) => s.actividad(),
  reposLocales: (s) => s.reposLocales(),
  clonar: (s, e) => s.clonar(e),
  crearRepo: (s, e) => s.crearRepo(e),
  prs: (s, e) => s.prs(String(e.proyectoId), e.estado),
  prActual: (s, e) => s.prActual(String(e.proyectoId)),
  crearPr: (s, e) => s.crearPr(e),
  fusionarPr: (s, e) => s.fusionarPr(String(e.proyectoId), e.numero, e.metodo),
  traerPr: (s, e) => s.traerPr(String(e.proyectoId), e.numero),
  issues: (s, e) => s.issues(String(e.proyectoId), e.estado),
  crearIssue: (s, e) => s.crearIssue(e),
  comentar: (s, e) => s.comentar(String(e.proyectoId), e.numero, e.texto),
  ci: (s, e) => s.ci(String(e.proyectoId), e.ref)
}

/** Operaciones de GitHub de la interfaz. El renderer manda el id del proyecto, nunca rutas ni credenciales. */
export function ejecutarOperacionGitHub(s: ServicioGitHub, op: unknown, entrada: unknown): Promise<unknown> {
  if (typeof op !== 'string' || !Object.hasOwn(OPERACIONES, op)) return Promise.reject(new Error(`Operación de GitHub desconocida: ${String(op)}`))
  const e = entrada !== null && typeof entrada === 'object' ? entrada : {}
  return (OPERACIONES[op as NombreOperacionGitHub] as (s: ServicioGitHub, e: unknown) => Promise<unknown>)(s, e)
}
