import type { ReactNode, SVGProps } from 'react'

function Icono({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  )
}

export const IconoCarpeta = () => (
  <Icono><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icono>
)
export const IconoMas = () => (
  <Icono><path d="M12 5v14M5 12h14" /></Icono>
)
export const IconoEngranaje = () => (
  <Icono>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icono>
)
export const IconoTerminal = () => (
  <Icono><path d="m4 17 6-6-6-6M12 19h8" /></Icono>
)
export const IconoRejilla = () => (
  <Icono><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icono>
)
export const IconoPestanas = () => (
  <Icono><path d="M3 8a2 2 0 0 1 2-2h4l1 2h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icono>
)
export const IconoCerrar = () => (
  <Icono width={14} height={14}><path d="M18 6 6 18M6 6l12 12" /></Icono>
)
export const IconoCheck = () => (
  <Icono width={14} height={14}><path d="M20 6 9 17l-5-5" /></Icono>
)
export const IconoChevron = () => (
  <Icono width={14} height={14}><path d="m9 6 6 6-6 6" /></Icono>
)
export const IconoBasura = () => (
  <Icono width={14} height={14}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></Icono>
)
export const IconoAbrirTodas = () => (
  <Icono width={14} height={14}><path d="m5 4 14 8-14 8z" /></Icono>
)
export const IconoChispa = () => (
  <Icono width={14} height={14}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" /></Icono>
)
export const IconoLapiz = () => (
  <Icono width={14} height={14}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Icono>
)
export const IconoReiniciar = () => (
  <Icono width={14} height={14}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></Icono>
)
