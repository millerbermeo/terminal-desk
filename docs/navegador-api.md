# Navegador integrado y cliente API

Dos pantallas de la barra lateral para probar lo que se desarrolla sin salir de la aplicación.

## Navegador

- **Abrir en ventana**: escribe una dirección (`localhost:3000`, `5173`, `ejemplo.com`) y se abre una ventana propia con barra de direcciones (atrás, adelante, recargar/detener, herramientas de desarrollo con F12, abrir en el navegador del sistema) y la página debajo. Varias ventanas a la vez (hasta 8).
- **En el navegador del sistema**: la misma dirección en tu navegador de siempre.
- **Servidores locales**: se detectan los que están escuchando en los puertos habituales (3000, 4200, 5173, 8000, 8080…), con el título de su página, y se abren con un clic. Se actualiza solo. Favoritos y recientes.
- **Seguridad**: la página va en una vista web aislada (`sandbox`, sin `nodeIntegration`, sin preload: no ve `window.api`, `require` ni `process`) con su propia sesión (`persist:navegador`). Solo `http` y `https` (se rechazan `file:`, `javascript:`, `data:`…), también en redirecciones y navegación. Se deniegan todos los permisos (cámara, ubicación, notificaciones…) salvo copiar y pantalla completa. Los certificados autofirmados solo se aceptan en `localhost` y red local. Solo la barra de cada ventana puede mandarle órdenes.

## La IA prueba en el navegador

Dos formas, las dos con ventana visible (se ve en directo lo que hace la IA) y varias ventanas a la vez:

- **Navegador integrado de Odesk** (`navegador_*` del servidor MCP `odesk`; recomendado para probar los proyectos). La IA abre ventanas propias (`navegador_abrir`, sin quitar el foco y en cascada) o maneja las que abrió el usuario (`navegador_ventanas`). Lee la página con `navegador_instantanea` (árbol de accesibilidad con refs `e1`, `e2`… que sirven para `navegador_clic`, `navegador_escribir`, `navegador_seleccionar`, `navegador_pasar_raton`, `navegador_desplazar`) y además tiene `navegador_tecla`, `navegador_esperar`, `navegador_captura` (imagen: visible, completa o de un elemento), `navegador_consola`, `navegador_red` (fallos 4xx/5xx), `navegador_evaluar` (JS en la página; riesgo `ejecucion`), `navegador_tamano` (responsive) y `navegador_ir`/`navegador_cerrar`. Cada acción marca en la página dónde actúa (círculo rojo con «🤖 …») y la barra de direcciones muestra la última acción. Tras actuar se informa si navegó y de los errores nuevos de consola o red.
- **Playwright MCP** (de serie en `mcp.json`, `@playwright/mcp --isolated`): Chrome/Chromium propio con ventana; `--isolated` da a cada sesión un perfil temporal, así varias conversaciones lo usan a la vez. Para volver a ocultarlo: `"playwright": { "comando": "npx", "args": ["-y", "@playwright/mcp@latest", "--headless", "--isolated"] }` en `~/.odesk-agent/mcp.json`.

### Cómo está hecho (navegador integrado)

- `src/shared/navegador-herramientas.ts`: definiciones (nombre, esquema, riesgo). Van dentro de `HERRAMIENTAS_ODESK`, así que llegan por el mismo socket/MCP que tareas y git y se permiten según la autonomía (lectura siempre; acciones desde «Aceptar ediciones»; `navegador_evaluar` solo «Autónomo»).
- `src/main/navegador-ia.ts` (`NavegadorIA`, conectado con `nucleo.conectarNavegador` en `index.ts`): usa `webContents.debugger` (protocolo de DevTools **sin abrir puerto**) para ratón, teclado, capturas y `Runtime.evaluate`, con `Emulation.setFocusEmulationEnabled` para que varias ventanas respondan a la vez sin foco real. Los `alert/confirm/prompt` se aceptan solos y quedan en la consola. Una acción a la vez por ventana.
- `src/main/navegador-pagina.ts`: script que corre en un **mundo aislado** de la página (no lo ve su JavaScript ni lo bloquea su CSP): instantánea, refs (`WeakRef`, estables mientras el elemento exista), punto de clic (falla si otro elemento lo tapa) y la marca visual.
- `GestorNavegador` guarda por ventana los últimos 300 mensajes de consola y peticiones (`webRequest` de la sesión `persist:navegador`). Solo se tocan las vistas web del navegador, nunca las ventanas de la aplicación.
- La captura solo llega como imagen por MCP (suscripción y terminales ✦); en modo API la IA recibe solo el texto.
- Límites: sin subir archivos (`<input type=file>`), sin iframes en la instantánea, y si las herramientas de desarrollo de esa página están abiertas el depurador puede no engancharse (se avisa).

## Cliente API

- **Peticiones**: método, URL, parámetros, cabeceras (con sugerencias), cuerpo (JSON con validación y «Formatear», texto o formulario) y autenticación (Bearer, Basic, clave de API). Opciones: seguir redirecciones, ignorar errores de certificado (https autofirmado en local) y tiempo máximo. Enviar con Enter o Ctrl+Enter; se puede cancelar. Varias peticiones en pestañas.
- **Respuesta**: estado coloreado, tiempo, tamaño y redirecciones; cuerpo como **árbol JSON** (se pliega, copia valor o ruta `$.datos[0].id`, pagina listas largas), formateado o crudo; imágenes en pantalla; cabeceras y detalles. Copiar el cuerpo o guardarlo en un archivo.
- **Entornos**: variables por entorno (`{{baseUrl}}`, `{{token}}`) usables en la URL, cabeceras, cuerpo y autenticación; se cambia de entorno desde la barra lateral. Avisa de las variables sin definir.
- **Colecciones e historial**: guardar peticiones en colecciones (crear, renombrar, eliminar) y reabrir las últimas 100. El historial guarda la petición con sus `{{variables}}`, nunca con los secretos ya sustituidos.
- **cURL**: copiar la petición como comando cURL e importar uno pegado (como el «Copiar como cURL» de las herramientas del navegador).

### Cómo está hecho

- `src/shared/api.ts` y `src/shared/navegador.ts`: tipos, un canal tipado por módulo y la lógica pura (variables, URL final, cURL, `normalizarUrl`).
- Las peticiones se ejecutan en el proceso principal (`src/main/api/cliente.ts`, con `http`/`https` de Node): sin CORS y con acceso a localhost. Redirecciones propias (303 pasa a GET; las credenciales no viajan a otro servidor), descompresión gzip/deflate/brotli, límite de 20 MB (se avisa si se corta), tiempo total y cancelación, y errores de red explicados (conexión rechazada, DNS, certificado…).
- `src/main/api/servicio.ts`: colecciones, entornos e historial en `~/.odesk-agent/api/datos.json` (0600). **Los tokens de los entornos se guardan sin cifrar** en tu equipo.
- `src/main/navegador.ts`: ventana con la barra de direcciones de la aplicación (`?navegador=<id>`) y una `WebContentsView` aislada; `src/main/puertos.ts` detecta los servidores locales (IPv4 e IPv6).
- Las dos operaciones llegan por un solo canal IPC cada una (`api:operar`, y `navegador:*`), con la entrada validada en main.

## Fuera de alcance (a propósito)

Multipart/subida de archivos, cookies compartidas entre peticiones, WebSocket/GraphQL con editor propio, scripts y tests por petición, importar colecciones de Postman y proxy.
