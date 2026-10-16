# Interfaz del Asistente

Acceso: **Asistente** en el pie de la barra lateral (con una insignia cuando hay confirmaciones pendientes).
Código: `src/renderer/components/Asistente.tsx` (pestañas) y `src/renderer/agente/useAgente.ts` (estado).

El estado vive en `App` (hook `useAgente`) y el panel está siempre montado, así que los eventos no se pierden ni se interrumpe una
ejecución al cambiar de pantalla. Los eventos que llegan antes de que `ejecutar` devuelva su id se guardan y se asignan al turno después.

## Asistente dentro de cada celda

Cada celda de la rejilla que pertenece a un proyecto tiene un selector **Terminal | Asistente** bajo su cabecera:

- La **terminal sigue viva** al cambiar al asistente (solo se oculta), igual que con las pestañas.
- El asistente de la celda trabaja en la carpeta de ese proyecto y tiene su **propia conversación** (estado por celda, `AsistenteCelda` en `TerminalGrid.tsx`). Se monta la primera vez que se muestra y conserva su conversación.
- El menú ✦ de un proyecto ofrece **«Asistente integrado»** (celda que arranca en la vista del asistente) además de Claude, Codex y Gemini, que siguen abriendo su CLI dentro de la terminal.
- Las confirmaciones de todas las celdas van a un almacén global (`agente/solicitudes.ts`) y las atiende un único modal (`ModalSolicitudGlobal`), que indica de qué proyecto viene.
- Cerrar la celda con una ejecución en marcha la cancela. Al separar una pestaña a otra ventana la terminal conserva su proceso, pero la conversación del asistente de esa celda se reinicia.
- Al abrir un grupo (▶) siguen creándose terminales; el asistente se activa por celda.
- El asistente integrado usa por ahora solo Anthropic (`Nucleo.llm()`); elegir otros proveedores queda pendiente.

## Archivos adjuntos (imágenes, PDF y texto)

Botón **📎 Adjuntar**, pegar con Ctrl+V (p. ej. una captura) o arrastrar archivos sobre el chat. Aparecen como miniaturas o chips con su ✕ antes de enviar,
y quedan en el mensaje y en el historial (las miniaturas se recuperan al retomar la conversación).

| Tipo | Admite | Límites |
|---|---|---|
| Imagen | PNG, JPG, GIF, WebP | 5 MB, 8000 px por lado |
| PDF | cualquier PDF sin cifrar | 20 MB, 100 páginas |
| Texto y código | `.md`, `.txt`, `.csv`, `.json`, `.ts`, `.py`… (lista en `shared/core/adjuntos.ts`) | 200 KB, UTF-8, sin binarios |

- Máximo **5 archivos por mensaje**. Se valida por el **contenido** (firma de bytes), no por la extensión. Un PDF cifrado, un texto con credenciales o un binario se rechazan con un motivo claro.
- Los archivos se guardan en `~/.centro-proyectos/adjuntos/` (0600) y la conversación solo guarda su id (nunca base64). Se borran a los 30 días (o al pasar de 500 MB, los más antiguos); un adjunto borrado se sustituye en el contexto por un aviso.
- Imágenes y PDF viajan como bloques nativos de la API; el texto, en línea. En el Flujo los ven el planificador y el generador; en grupos, el coordinador.
- Con adjuntos no se baja del modelo intermedio. Cada imagen cuenta ~1 500 tokens y cada página de PDF ~2 000; al comprimir el contexto, los adjuntos de mensajes antiguos se sustituyen por un marcador.
- Se avisa la primera vez: **el contenido se envía a la API de Anthropic** y no se pueden detectar credenciales dentro de una imagen o un PDF. El agente recibe la instrucción de tratar los adjuntos como datos y **no obedecer instrucciones escondidas** en ellos; sus acciones siguen sujetas a confirmaciones y permisos.

## Adaptación al tamaño de la ventana

- El chat usa *container queries*: se adapta al ancho de **su propio panel** (celda pequeña, ventana estrecha o pantalla grande). En paneles estrechos los botones pasan a su forma corta (`Hist.`, `Nueva`), el selector de autonomía y el de modo ocupan su línea y la caja de texto se apila encima del botón Enviar. En pantallas grandes el contenido se centra con un ancho máximo.
- La **autonomía** es un desplegable (`Preguntar todo`, `Aceptar ediciones`, `Autónomo`): ocupa lo mismo en cualquier tamaño.
- La ventana entera también se adapta: la barra lateral baja a 200 px (≤ 900 px) y a 152 px (≤ 640 px), las barras de herramientas se parten en varias líneas y la lista de trazas pasa encima del detalle.

## Historial de conversaciones

- Al terminar cada respuesta se guarda lo que se ve en pantalla (turnos, herramientas, confirmaciones…) junto al contexto del modelo, en
  `~/.centro-proyectos/conversaciones/<id>.json` (0600). Se quitan los trozos de streaming, se recortan los textos largos y se redactan las credenciales.
- Cada proyecto **recuerda su conversación activa** entre reinicios (en el almacenamiento del renderer): al reabrir su asistente, se restaura y el
  modelo continúa con su contexto. Si dos celdas son del mismo proyecto, solo la primera la recupera.
- **Historial** (botón del chat): lista las conversaciones del proyecto (de todos, en la pantalla global), con fecha, turnos y tokens. Se pueden retomar o eliminar.
- **Nueva conversación** ya no borra nada: la actual queda en el historial.
- Se conservan las 50 más recientes por proyecto y hasta 1,5 MB de transcripción por conversación (se descartan los turnos más antiguos).
- Qué no se guarda: el texto parcial de una respuesta en curso ni las ejecuciones canceladas a mitad.

## Pestañas

| Pestaña | Qué hace |
|---|---|
| **Conversación** | Elige destino (proyecto, grupo con un agente por submódulo, o ninguno) y modo (**Chat** o **Flujo** con opción de aislar en rama git). Muestra en vivo el texto en streaming, las herramientas (desplegables con su resultado), la decisión del router, los pasos del flujo, las consultas A2A, los guardrails y las ramas creadas. La conversación se mantiene entre mensajes (`sesionId`) hasta «Nueva conversación». |
| **Trazas** | Lista de ejecuciones y, por cada una, el árbol de spans en forma de cascada (agente, llm, herramienta, evento) con tiempos, tokens, entradas y salidas. Permite eliminarlas. |
| **Memoria** | Reglas, decisiones y hechos por proyecto o globales. Rechaza credenciales. |
| **Ramas** | Ramas aisladas del agente por proyecto: publicar (`git push`, con confirmación destructiva) o descartar. |
| **Evals** | Ejecuta una suite contra el modelo real (pide confirmación: consume tokens), compara con el informe anterior (regresiones) y muestra el historial. |

## Confirmaciones

Un modal bloquea la pantalla (en cualquier vista) cuando un agente espera una decisión:

- **Plan** (flujo): muestra el plan y qué se permitirá. Rechazar con comentario vuelve a planificar.
- **Acción**: comando o escritura exacta. Las destructivas van en rojo, sin «no volver a preguntar». `Esc` rechaza.
- **Resultado** (flujo): aceptar confirma los cambios en la rama aislada; rechazar con comentario vuelve a generar.

Cancelar la ejecución cierra las confirmaciones pendientes y deniega la acción.

## Probarla sin clave real

El SDK de Anthropic respeta `ANTHROPIC_BASE_URL`, así que se puede lanzar la app apuntando a un servidor local que imite
`POST /v1/messages` (con y sin streaming), con `ANTHROPIC_API_KEY` ficticia, y manejarla por CDP como indica `CLAUDE.md`.
Así se verificó de punta a punta: streaming, herramientas, aprobaciones, guardrails, flujo con worktree y commit, A2A, trazas, ramas y evals.
