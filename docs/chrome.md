# Control del Chrome real del usuario

El Asistente de Odesk (y cualquier asistente conectado al MCP `odesk`: Claude Code en terminales ✦, Claude Desktop, Cursor, VS Code) puede
manejar el **Chrome del usuario**, con sus sesiones iniciadas, mediante la extensión «Odesk Code · Chrome». Para probar proyectos en local
sigue estando el navegador integrado (`navegador_*`); `chrome_*` es para cuando hace falta el navegador de verdad de la persona.

## Piezas

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Extensión MV3 | `extension/` (`background.js`, `popup.*`) | WebSocket al puente; pestañas del grupo «Odesk»; `chrome.debugger` (protocolo de DevTools) |
| Puente | `src/main/chrome/puente.ts` + `ws.ts` | Servidor WebSocket en 127.0.0.1:47615–47619 (sin dependencias), emparejamiento, token, peticiones/eventos |
| Controlador IA | `src/main/chrome-ia.ts` | Herramientas `chrome_*`: permisos por sitio, confirmaciones, consola/red, diálogos |
| Motor común | `src/main/navegador-motor.ts` | Instantánea, ratón, teclado, esperar, capturas, JS: lo comparten el navegador integrado y Chrome (`CanalPagina`) |
| Herramientas | `src/shared/chrome-herramientas.ts` | Definiciones (en el MCP `odesk`) |
| Panel | `src/renderer/components/ChromeReal.tsx` | Proveedores de IA → Chrome: instalar, emparejar, apagar, sitios autorizados |
| IPC | `chrome:operar` / `chrome:estado` | `src/shared/chrome.ts#OperacionesChrome`, `src/main/chrome/servicio.ts` |

## Seguridad

- **Conexión**: solo 127.0.0.1 y solo orígenes `chrome-extension://<id>` (una web no puede falsear `Origin`). Emparejamiento con código de
  6 cifras (5 min, 5 intentos, un solo uso) → token de 256 bits; en `~/.odesk-agent/chrome.json` (0600, personal de la cuenta) solo su
  SHA-256, atado al origen de esa extensión. «Desemparejar» lo invalida y corta la conexión.
- **Pestañas**: la extensión solo obedece en las pestañas del grupo morado «Odesk» (las que abre la IA o las que el usuario comparte desde el
  botón). Sacar una pestaña del grupo la deja de compartir. Lo comprueba la extensión, no Odesk.
- **Métodos de DevTools**: lista cerrada en la extensión (`METODOS`: ratón/teclado, captura, métricas, diálogos, `Runtime.evaluate`). Nada
  de cookies, almacenamiento ni cuerpos de red; los eventos de red y consola salen recortados y sin cabeceras.
- **Sitios**: cada origen nuevo se autoriza en Odesk antes de leerlo o tocarlo (diálogo nativo: no / esta sesión / siempre). `localhost` y
  `127.0.0.1` no preguntan. «No» vale para toda la sesión. Los «siempre» se ven y se quitan en el panel.
- **Acciones**: `chrome_evaluar` siempre se confirma; un clic cuyo texto suena a comprar, pagar, publicar, enviar o borrar
  (`shared/chrome.ts#clicSensible`) también. Los `confirm()`/`prompt()`/`beforeunload` de la página se **rechazan** (en el integrado se
  aceptan) y quedan en la consola; los `alert()` se aceptan.
- **Inyección de instrucciones**: lo que se lee de la página (instantánea, JS) va precedido de `AVISO_CONTENIDO_WEB`.
- **Parar**: «Apagar» en el panel; «Pausar» en la extensión; o «Cancelar» en la barra de depuración de Chrome (pausa).

## Protocolo puente ⇄ extensión (v1, `PROTOCOLO_CHROME`)

Extensión → Odesk: `hola {token}` · `emparejar {codigo}` (con `protocolo`, `navegador`, `version`) · `respuesta {id, ok, valor|error}` ·
`evento {pestana, metodo, params}` · `pestanas {lista, pausado}` · `latido` (cada 20 s; mantiene vivo el service worker).

Odesk → extensión: `bienvenida {token?}` · `rechazo {motivo}` · `pedir {id, op, …}` con `op` ∈ `pestanas`, `abrir`, `cerrar`, `estado`,
`navegar`, `zoom`, `cdp`, `aislado` (código en un mundo aislado `odesk-ia`), `anunciar` (insignia «IA» en el botón).

## Pruebas

- `tests/chrome-puente.test.ts`: tramas WebSocket, origen, emparejamiento, token, intentos, peticiones, olvidar.
- `tests/chrome-ia.test.ts`: permisos por sitio, confirmaciones, diálogos, consola y red (extensión falsa).
- `tests/chrome-e2e.test.ts`: **Chromium real** con la extensión cargada (el de Playwright en `~/.cache/ms-playwright` o
  `ODESK_E2E_CHROMIUM`); se omite si no hay. Chrome de marca no admite `--load-extension`.
- Diagnóstico: en `chrome://extensions` → «service worker» de la extensión: `odesk.estado()`, `odesk.emparejar('123456')`.
