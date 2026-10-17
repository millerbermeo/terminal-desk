# Navegador integrado y cliente API

Dos pantallas de la barra lateral para probar lo que se desarrolla sin salir de la aplicación.

## Navegador

- **Abrir en ventana**: escribe una dirección (`localhost:3000`, `5173`, `ejemplo.com`) y se abre una ventana propia con barra de direcciones (atrás, adelante, recargar/detener, herramientas de desarrollo con F12, abrir en el navegador del sistema) y la página debajo. Varias ventanas a la vez (hasta 8).
- **En el navegador del sistema**: la misma dirección en tu navegador de siempre.
- **Servidores locales**: se detectan los que están escuchando en los puertos habituales (3000, 4200, 5173, 8000, 8080…), con el título de su página, y se abren con un clic. Se actualiza solo. Favoritos y recientes.
- **Seguridad**: la página va en una vista web aislada (`sandbox`, sin `nodeIntegration`, sin preload: no ve `window.api`, `require` ni `process`) con su propia sesión (`persist:navegador`). Solo `http` y `https` (se rechazan `file:`, `javascript:`, `data:`…), también en redirecciones y navegación. Se deniegan todos los permisos (cámara, ubicación, notificaciones…) salvo copiar y pantalla completa. Los certificados autofirmados solo se aceptan en `localhost` y red local. Solo la barra de cada ventana puede mandarle órdenes.

## Cliente API

- **Peticiones**: método, URL, parámetros, cabeceras (con sugerencias), cuerpo (JSON con validación y «Formatear», texto o formulario) y autenticación (Bearer, Basic, clave de API). Opciones: seguir redirecciones, ignorar errores de certificado (https autofirmado en local) y tiempo máximo. Enviar con Enter o Ctrl+Enter; se puede cancelar. Varias peticiones en pestañas.
- **Respuesta**: estado coloreado, tiempo, tamaño y redirecciones; cuerpo como **árbol JSON** (se pliega, copia valor o ruta `$.datos[0].id`, pagina listas largas), formateado o crudo; imágenes en pantalla; cabeceras y detalles. Copiar el cuerpo o guardarlo en un archivo.
- **Entornos**: variables por entorno (`{{baseUrl}}`, `{{token}}`) usables en la URL, cabeceras, cuerpo y autenticación; se cambia de entorno desde la barra lateral. Avisa de las variables sin definir.
- **Colecciones e historial**: guardar peticiones en colecciones (crear, renombrar, eliminar) y reabrir las últimas 100. El historial guarda la petición con sus `{{variables}}`, nunca con los secretos ya sustituidos.
- **cURL**: copiar la petición como comando cURL e importar uno pegado (como el «Copiar como cURL» de las herramientas del navegador).

### Cómo está hecho

- `src/shared/api.ts` y `src/shared/navegador.ts`: tipos, un canal tipado por módulo y la lógica pura (variables, URL final, cURL, `normalizarUrl`).
- Las peticiones se ejecutan en el proceso principal (`src/main/api/cliente.ts`, con `http`/`https` de Node): sin CORS y con acceso a localhost. Redirecciones propias (303 pasa a GET; las credenciales no viajan a otro servidor), descompresión gzip/deflate/brotli, límite de 20 MB (se avisa si se corta), tiempo total y cancelación, y errores de red explicados (conexión rechazada, DNS, certificado…).
- `src/main/api/servicio.ts`: colecciones, entornos e historial en `~/.centro-proyectos/api/datos.json` (0600). **Los tokens de los entornos se guardan sin cifrar** en tu equipo.
- `src/main/navegador.ts`: ventana con la barra de direcciones de la aplicación (`?navegador=<id>`) y una `WebContentsView` aislada; `src/main/puertos.ts` detecta los servidores locales (IPv4 e IPv6).
- Las dos operaciones llegan por un solo canal IPC cada una (`api:operar`, y `navegador:*`), con la entrada validada en main.

## Fuera de alcance (a propósito)

Multipart/subida de archivos, cookies compartidas entre peticiones, WebSocket/GraphQL con editor propio, scripts y tests por petición, importar colecciones de Postman y proxy.
