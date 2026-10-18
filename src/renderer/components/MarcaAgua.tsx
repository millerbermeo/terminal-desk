import { memo, useId } from 'react'

// Robot wireframe + ventana de terminal. Todo contorno, un solo trazo por línea (sin rellenos ni filtros: se ve nítido).
const POLIGONOS = [
  '146,78 254,78 284,106 284,172 254,202 146,202 116,172 116,106', // cabeza
  '140,114 260,114 270,124 270,160 260,170 140,170 130,160 130,124' // visor
]
const CIRCULOS: [number, number, number][] = [
  [200, 40, 5], // punta de la antena
  [140, 92, 2], [260, 92, 2], // tornillos
  [72, 211, 3], [328, 211, 3], // nodos de los circuitos
  [106, 235, 3.5], [120, 235, 3.5], [134, 235, 3.5], // botones de la ventana
  [102, 365, 2], // estado
  [74, 90, 2], [330, 152, 2], [64, 340, 2], [336, 62, 2] // partículas
]
const RECTS: [number, number, number, number, number][] = [
  [100, 124, 16, 44, 5], [284, 124, 16, 44, 5], // orejas
  [90, 222, 220, 150, 10] // ventana
]
const TRAZOS = [
  'M170 78L180 66H220L230 78', // corona
  'M200 66V45', 'M190 34L185 29', 'M210 34L215 29', // antena y destellos
  'M116 106L130 124', 'M116 172L130 160', 'M284 106L270 124', 'M284 172L270 160', // biseles cabeza-visor
  'M182 180V193M191 180V193M200 180V193M209 180V193M218 180V193', // rejilla de la boca
  'M178 202V224M222 202V224M178 213H222', // cuello
  'M108 168V186H72V236H90', 'M292 168V186H328V236H310', // circuitos hacia la ventana
  'M90 248H310', 'M90 358H310', // barras de título y de estado
  'M110 365H138', 'M268 365H298', 'M300 262V304', // estado y barra de desplazamiento
  'M178 276H204M212 276H262', 'M178 290H196M204 290H232', // código (por fichas)
  'M110 322H134M142 322H190', 'M110 334H166M174 334H240', 'M110 346H128M136 346H168',
  'M56 120H64M60 116V124', 'M336 100H344M340 96V104', 'M48 296H56M52 292V300', 'M344 316H352M348 312V320' // cruces
]
// Acentos algo más claros: lo que «brilla» (ojos, cursor, chispa de IA)
const ACENTOS = [
  'M148 128L186 134V153H154Z', 'M252 128L214 134V153H246Z', // ojos
  'M110 274L128 288L110 302', // prompt >
  'M280 228L282.5 232.5L287 235L282.5 237.5L280 242L277.5 237.5L273 235L277.5 232.5Z' // chispa de IA
]
const ACENTOS_CIRCULOS: [number, number, number][] = [[172, 143, 3], [228, 143, 3]]

export const MarcaAgua = memo(function MarcaAgua() {
  const g = `marca-${useId().replace(/:/g, '')}`
  const v = { vectorEffect: 'non-scaling-stroke' as const }
  return (
    <svg className="marca-agua" viewBox="0 0 400 400" fill="none" stroke={`url(#${g})`} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <defs>
        <linearGradient id={g} gradientUnits="userSpaceOnUse" x1="90" y1="30" x2="310" y2="375">
          <stop offset="0" stopColor="#3b82f6" stopOpacity="0.36" />
          <stop offset="0.55" stopColor="#7c6cf6" stopOpacity="0.32" />
          <stop offset="1" stopColor="#c084fc" stopOpacity="0.36" />
        </linearGradient>
      </defs>
      {POLIGONOS.map((p) => <polygon key={p} points={p} {...v} />)}
      {RECTS.map(([x, y, width, height, rx]) => <rect key={`${x}-${y}`} x={x} y={y} width={width} height={height} rx={rx} {...v} />)}
      {CIRCULOS.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} {...v} />)}
      {TRAZOS.map((d) => <path key={d} d={d} {...v} />)}
      <g stroke="#a5b4fc" strokeOpacity="0.5">
        {ACENTOS.map((d) => <path key={d} d={d} {...v} />)}
        {ACENTOS_CIRCULOS.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} {...v} />)}
        <rect x="138" y="292" width="9" height="12" {...v} />
      </g>
    </svg>
  )
})
