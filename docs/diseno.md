# Sistema de diseño

Dirección visual: la skill `apple-design` (`.claude/skills/apple-design`). Modo oscuro, índigo de marca, materiales translúcidos
con peso según la jerarquía, movimiento con muelles y respuesta al pulsar.

## Archivos (orden de carga en `src/renderer/main.tsx`)

| Archivo | Qué contiene |
|---|---|
| `diseno/fuentes.ts` | Inter y JetBrains Mono empaquetadas (`@fontsource-variable/*`). `FUENTE_MONO` para xterm y CodeMirror; `fuentesListas()` retrasa el primer pintado hasta que están cargadas (xterm mide la letra al abrirse). |
| `diseno/tokens.css` | **Única fuente de verdad** de variables: tipografía, superficies, bordes, texto, marca y estados, materiales, radios, sombras, espaciado, medidas y movimiento. |
| `estilos.css`, `estilos-mejoras.css`, `estilos-apple.css` | Capas históricas (estructura y detalle de cada componente). Ya no definen variables. |
| `diseno/sistema.css` | Primitivas comunes: botones, campos, foco, títulos, chips, estados vacíos, carga, modales, accesibilidad. |
| `diseno/barra-lateral.css` | Barra lateral completa (normal, compacta y responsive), todo bajo `.sidebar`. |
| `diseno/modulos.css` | Estructura común de las pantallas: barra del módulo, pestañas de sección, control segmentado, paneles y avisos. |

## Reglas

- **Ningún color, radio, sombra o duración sueltos**: siempre una variable de `tokens.css`. Si falta, se añade allí.
- **Texto**: tres niveles (`--texto`, `--texto-suave`, `--texto-tenue`); el tenue cumple 4.5:1 sobre `--bg`. Etiquetas en mayúsculas con `--t-micro` + `--tr-micro`.
- **Altura de controles**: botones, campos y selectores miden `--alto-control` (30 px); las barras de módulo, `--alto-barra` (52 px).
- **Tres formas de elegir vista**:
  - pestañas de ventana (terminales, peticiones del cliente API): documentos abiertos que se cierran;
  - pestañas de sección («píldora» con fondo de acento): secciones de un módulo (Asistente, Versiones, sub-pestañas de la API);
  - control segmentado: alternar 2–4 modos de una misma vista (Rejilla/Pestañas, Chat/Flujo, Tablero/Lista).
- **Iconos**: SVG de `components/Iconos.tsx` (trazo de 2 px, `currentColor`). Nada de emojis ni glifos de texto como icono.
- **Carga**: `components/Cargando.tsx` — `Esqueletos` cuando se conoce la forma de lo que llega (listas, tarjetas, líneas) y `Cargando` (indicador giratorio) cuando no.
- **Deshabilitado**: plano y apagado; un botón primario deshabilitado pierde el color.
- **Foco de teclado**: anillo de acento de 2 px en todo lo interactivo (`:focus-visible`).
- **Movimiento**: `--muelle` por defecto; `--muelle-rebote` solo con impulso físico. Respeta `prefers-reduced-motion`, `prefers-reduced-transparency` y `prefers-contrast`.
- **Responsive**: ≤ 900 px la barra lateral se estrecha y las barras reducen márgenes; ≤ 760 px pasa a compacta (solo iconos); ≤ 640 px bajan la barra de módulo y el título de pantalla.

## Pendiente

Las tres capas históricas siguen teniendo reglas que `diseno/*.css` vuelve a definir (sobre todo de la barra lateral y de las barras de módulo).
Al tocar un componente, mover sus reglas a `diseno/` y borrar las antiguas en vez de añadir otra capa.
