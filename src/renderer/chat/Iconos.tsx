import type { ReactNode, SVGProps } from 'react'

/** Iconos del chat (trazo fino y redondeado, al estilo de SF Symbols). Heredan el color con `currentColor`. */
function Svg({ children, tam = 18, relleno, ...props }: { children: ReactNode; tam?: number; relleno?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tam}
      height={tam}
      fill={relleno ? 'currentColor' : 'none'}
      stroke={relleno ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

type P = { tam?: number }

export const ITelefono = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M5 4h3.2l1.6 4-2.1 1.3a11 11 0 0 0 5 5l1.3-2.1 4 1.6V17a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </Svg>
)
export const IColgar = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M3.5 14.5c4.7-4.2 12.3-4.2 17 0l-1.9 2.6-3.4-1.4v-2.5a11 11 0 0 0-6.4 0v2.5l-3.4 1.4z" />
  </Svg>
)
export const IVideo = ({ tam }: P) => (
  <Svg tam={tam}>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
    <path d="m15.5 10.5 5-3v9l-5-3" />
  </Svg>
)
export const IVideoNo = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M10 6.5h3a2.5 2.5 0 0 1 2.5 2.5v3.5M15.5 15.5V15a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 15V9a2.5 2.5 0 0 1 1.6-2.3" />
    <path d="m15.5 10.5 5-3v9l-3.2-1.9M3 3l18 18" />
  </Svg>
)
export const IOjo = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)
export const IOjoNo = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.7 3.6M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Svg>
)
export const IMic = ({ tam }: P) => (
  <Svg tam={tam}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </Svg>
)
export const IMicNo = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3M18.5 11a6.4 6.4 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 10.2 5.4M12 17.5V21M3 3l18 18" />
  </Svg>
)
export const IMas = ({ tam }: P) => (
  <Svg tam={tam} relleno>
    <circle cx="5.5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="18.5" cy="12" r="1.7" />
  </Svg>
)
export const IClip = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
  </Svg>
)
export const IEmoji = ({ tam }: P) => (
  <Svg tam={tam}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
  </Svg>
)
export const IEnviar = ({ tam }: P) => (
  <Svg tam={tam} strokeWidth={2.2}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
)
export const IBuscar = ({ tam }: P) => (
  <Svg tam={tam}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Svg>
)
export const ICerrar = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const IVolver = ({ tam }: P) => (
  <Svg tam={tam} strokeWidth={2.2}>
    <path d="m15 5-7 7 7 7" />
  </Svg>
)
export const IAbajo = ({ tam }: P) => (
  <Svg tam={tam} strokeWidth={2.2}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)
export const IResponder = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6v4" />
  </Svg>
)
export const ICopiar = ({ tam }: P) => (
  <Svg tam={tam}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
)
export const IEditar = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
)
export const IBasura = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v5M14 11v5" />
  </Svg>
)
export const IReaccion = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M20 12a8 8 0 1 1-8-8" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 10h.01M15 10h.01M19 2v6M16 5h6" />
  </Svg>
)
export const IArchivo = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
)
export const IDescargar = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </Svg>
)
export const ICamara = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
)
export const ICampana = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4" />
  </Svg>
)
export const ICampanaNo = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M8.3 5.4A6 6 0 0 1 18 11v4M6 11v5l-1.5 2H18M10 21h4M3 3l18 18" />
  </Svg>
)
export const IArchivar = ({ tam }: P) => (
  <Svg tam={tam}>
    <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
    <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
  </Svg>
)
export const IBloquear = ({ tam }: P) => (
  <Svg tam={tam}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </Svg>
)
export const IEscoba = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M14 4 9.5 12M5 21l1-6.5 6.5 3L12 21zM6 14.5 9 11l6 3-2.5 3.5" />
  </Svg>
)
export const IPersonaMas = ({ tam }: P) => (
  <Svg tam={tam}>
    <circle cx="10" cy="8" r="4" />
    <path d="M3 20a7 7 0 0 1 12.5-4.3M19 14v6M16 17h6" />
  </Svg>
)
export const IBurbujas = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M15 9.5A6.5 6.5 0 0 0 2.6 12.4L2 16l3.4-.9A6.5 6.5 0 0 0 15 9.5z" />
    <path d="M9.5 16.3a6.5 6.5 0 0 0 9.1 1.8L22 19l-.6-3.6A6.5 6.5 0 0 0 17 7" />
  </Svg>
)
export const IEnlace = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Svg>
)
export const IReloj = ({ tam }: P) => (
  <Svg tam={tam}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)
export const IAlerta = ({ tam }: P) => (
  <Svg tam={tam}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </Svg>
)
export const IPlay = ({ tam }: P) => (
  <Svg tam={tam} relleno>
    <path d="M8 5.2v13.6a1 1 0 0 0 1.5.9l10.6-6.8a1 1 0 0 0 0-1.7L9.5 4.3A1 1 0 0 0 8 5.2z" />
  </Svg>
)
export const IPausa = ({ tam }: P) => (
  <Svg tam={tam} relleno>
    <rect x="6" y="4.5" width="4" height="15" rx="1.3" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.3" />
  </Svg>
)
export const IAltavoz = ({ tam }: P) => (
  <Svg tam={tam}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
)

/** ✓ (enviado) o ✓✓ (entregado / leído). */
export const ITicks = ({ doble }: { doble: boolean }) => (
  <svg viewBox="0 0 18 11" width={doble ? 17 : 12} height={11} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {doble ? (
      <>
        <path d="m1 6 3.2 3.2L11 2" />
        <path d="m7.8 9.2.2.2L15 2" />
      </>
    ) : (
      <path d="m1 6 3.2 3.2L11 2" />
    )}
  </svg>
)
