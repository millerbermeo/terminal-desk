# Tareas de proyectos

Pantalla **Tareas** (barra lateral): gestión de tareas por grupos y proyectos que el usuario y la IA comparten, con las mismas reglas.

## Qué hay

- **Tarea**: título, descripción, estado, prioridad, vencimiento, etiquetas, criterios de aceptación, subtareas, dependencias («espera a #N»), referencias (enlaces, archivos del proyecto, notas), comentarios, información técnica e historial. Se nombra por su número (`#12`).
- **Ámbitos**: todas, sin proyecto, un grupo o un proyecto. Una tarea puede nacer suelta y vincularse después sin perder nada; si se elimina su proyecto o grupo, queda suelta.
- **Vistas**: Tablero (arrastrar entre columnas), Lista (búsqueda y filtros), Resumen (progreso, bloqueadas, vencidas, sin criterios, siguiente recomendada) y Actividad (quién hizo qué, usuario o ✦ IA). El detalle de cada tarea se abre en un panel lateral.
- **Estados**: ocho por defecto (Pendiente, Planificada, Lista para implementar, En progreso, En revisión, Bloqueada, Completada, Cancelada), editables en **Estados**. Cada estado tiene una *categoría* (sin empezar, en curso, bloqueada, terminada, descartada) y las reglas dependen de la categoría, no del nombre.

## Reglas (`src/shared/tareas.ts`, iguales para usuario e IA)

- **Terminar** exige todos los criterios y subtareas cumplidos y las dependencias terminadas (las descartadas no bloquean).
- **Bloquear, descartar y reabrir** exigen un motivo; queda en el historial junto con quién lo hizo y cuándo.
- Las dependencias no admiten ciclos. Una tarea nueva no puede nacer terminada, bloqueada ni descartada.
- Quitar un estado con tareas obliga a indicar a qué estado pasan.

## Arquitectura

- `src/main/core/tareas/servicio.ts`: único punto de escritura (`tareas/tareas.json`, escritura atómica y serializada). Todo cambio se registra en la actividad y avisa a las ventanas (`tareas:cambio`), así la pantalla se refresca aunque lo haya hecho la IA.
- **Interfaz**: un solo canal IPC tipado, `tareas:operar` (`OperacionesTareas` en `src/shared/tareas.ts`), con autor «usuario».
- **IA** (autor «ia», las mismas validaciones): herramientas definidas una vez en `src/shared/tareas-herramientas.ts` y expuestas de tres maneras:
  - *Modo API*: registro de herramientas del núcleo (`herramientas.ts`); las lecturas no piden confirmación y las escrituras siguen la autonomía.
  - *Suscripción*: `claude -p --mcp-config` con el servidor MCP de tareas; sus herramientas se permiten según la autonomía (consultar siempre; cambiar desde «Aceptar ediciones»).
  - *Terminales ✦ con Claude Code*: el plugin generado lleva un `.mcp.json` con el mismo servidor.
- **Servidor MCP** (`src/main/mcp-tareas.ts`, compilado a `out/main/mcp-tareas.js`): proceso aparte, sin datos propios y sin dependencias; lo lanza el CLI con el propio Electron (`ELECTRON_RUN_AS_NODE=1`). Cada llamada la envía por un **socket local** (`~/.centro-proyectos/tareas.sock`, 0600; ruta corta en `/tmp` si la carpeta es muy larga; tubería con nombre en Windows) al proceso principal, que es el único que escribe. Un token en `tareas.token` (0600) identifica al servidor. Con la app cerrada, las herramientas avisan de que Odesk Agent no está abierto.
- **La IA no puede borrar tareas**: puede descartarlas con un motivo. Eliminar es solo de la interfaz.
- **Contexto**: al lanzar el Asistente en un proyecto se añade al prompt un resumen acotado de sus tareas abiertas y las reglas de trabajo (consultar antes de implementar, marcar en curso, completar solo con criterios cumplidos, documentar decisiones).
- **Comandos**: `/plan <funcionalidad>` (descompone en tareas con criterios y dependencias, sin implementar) y `/tareas` (revisión: bloqueos, mal definidas, siguiente paso).

## Fuera de alcance (a propósito)

Usuarios y responsables, permisos por usuario, diagrama de Gantt, plantillas de proyecto, tareas recurrentes y estimaciones: la app es de un solo usuario y no hacen falta para que el sistema funcione.
