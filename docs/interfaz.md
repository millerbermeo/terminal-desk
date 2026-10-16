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
