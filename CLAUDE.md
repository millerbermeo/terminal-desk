# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Odesk Agent** (antes «ODESK AI» y «Centro de Proyectos»; el icono está en `resources/`): app de escritorio (Electron + Vite + React + TypeScript) que gestiona proyectos con varias terminales reales (xterm.js + node-pty) y lanza CLIs de IA (hoy, Claude Code) dentro de ellas. Todo el código, los identificadores y la UI están en español; mantenlo así.

## Comandos

Usa **pnpm** (el repo tiene `pnpm-lock.yaml`; `pnpm-workspace.yaml` autoriza con `allowBuilds` los scripts de `electron` y `node-pty`).

```bash
pnpm install        # el postinstall recompila node-pty para Electron; si falla: pnpm exec electron-rebuild -f -w node-pty
pnpm dev            # electron-vite dev (HMR solo en el renderer)
pnpm build          # electron-vite build -> out/
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint (typescript-eslint corre sobre la API de TS 6 vía .pnpmfile.cjs; TS 7 aún no está soportado)
pnpm test           # vitest run (tests/ — LLM falso, git real en temporales, servidor MCP de prueba por stdio)
pnpm evals          # evals contra el modelo real (evals/; necesita ANTHROPIC_API_KEY, consume tokens; sin clave se omite)
pnpm package        # build + electron-builder (node-pty va en asarUnpack)
```

- **Cambios en `src/main` o `src/preload` requieren reiniciar `pnpm dev` por completo**; el renderer se recarga solo (Ctrl+R).
- Si el entorno tiene `ELECTRON_RUN_AS_NODE=1` (p. ej. dentro de VSCode), Electron arranca como Node y falla con `Cannot read properties of undefined (reading 'commandLine')`: lanza con `env -u ELECTRON_RUN_AS_NODE pnpm dev`.
- Para probar la app real sin ver la ventana: lanzar `electron . --remote-debugging-port=9222` (con `HOME` apuntando a una carpeta temporal para no tocar `~/.odesk-agent`) y manejarla por CDP. Hay que enviar `Page.bringToFront` y `Emulation.setFocusEmulationEnabled` o los eventos de ratón tardan ~5 s cada uno. Los ptys se miden con `ps` (hijos del proceso principal).
- La lógica pura (`src/renderer/arbol.ts`, `src/shared/*`, y `src/main/*.ts` con un loader de alias para `@shared/*`) se puede probar con `node --experimental-strip-types`.

## Arquitectura

Tres procesos con un contrato IPC tipado. **Añadir una operación IPC toca siempre tres sitios**: `src/shared/ipc.ts` (canal en `Canales` + método en `ApiCentro`), `src/preload/index.ts` (implementa `ApiCentro` con `ipcRenderer`) y `registrarIpc()` en `src/main/index.ts`. El renderer solo ve `window.api`; `contextIsolation`, `sandbox` y CSP están activos, así que el preload solo puede importar `electron` y `@shared/*`. Alias `@shared` -> `src/shared` (configurado en `electron.vite.config.ts` y `tsconfig.json`).

### Terminales y ventanas (lo menos obvio)
- `GestorTerminales` (`src/main/terminales.ts`) es dueño de los ptys y guarda un historial por terminal (512 KB) con un contador acumulado `fin`. Cada trozo de salida viaja con su `fin`.
- `duenos` (`src/main/index.ts`) mapea `ptyId -> webContents.id`: la salida va solo a la ventana dueña. Al recargar o cerrar una ventana (`cerrarDe`) se matan sus ptys; cerrar la ventana principal cierra toda la app.
- **Separar/devolver pestañas** reutiliza los mismos procesos: `ventana:separar` abre una `BrowserWindow` con `?ventana=<token>` (renderer `VentanaSeparada`, que recoge el payload con `ventana:tomar`); `ventana:devolver` reasigna los ptys a la principal y cierra la separada. El panel receptor usa `terminal:adjuntar`, repinta el historial y descarta los trozos en cola con `fin <= histórico` (evita duplicados). En el emisor, `transferidas` (`TerminalPanel.tsx`) evita que desmontar el panel mate el pty.
- Un proveedor de IA no se lanza con `spawn` directo: su comando se **escribe en el shell interactivo** (hereda PATH/nvm; al salir del CLI la terminal sigue viva). El renderer solo manda `proveedorId`; el comando se resuelve en main.
- Las terminales de la UI tienen dos ids: `TerminalInfo.id` (renderer) y `ptyId` (proceso real, lo informa `TerminalPanel` con `onPty`).

### Renderer
- `App.tsx` mantiene `ventanas` (pestañas, normalmente una por grupo; id = id del grupo, `__sin-grupo__` o `__libre__`). **Todas las pestañas y la vista principal permanecen montadas** (`display: none`) para no matar los ptys: nunca desmontes condicionalmente `TerminalPanel`/`TerminalGrid`. Un clic en un proyecto enfoca su terminal si ya existe (`proyectoId`); duplicar solo es posible a propósito (✦ con proveedor, «+ Terminal»).
- `TerminalGrid` pinta un **árbol de divisiones** (`arbol.ts`, funciones puras): siempre cubre el área sin huecos; cada divisor mueve una línea completa; mover una terminal = intercambiar hojas. El árbol guardado conserva las proporciones y `normalizar()` aplica los mínimos (260×150 px) solo al dibujar. `reconciliar()` ajusta el árbol al abrir/cerrar terminales. Los ajustes de tamaño de xterm se limitan a uno cada 50 ms.

### Persistencia (`~/.odesk-agent/`)
Antes era `~/.centro-proyectos/`: `src/main/migracion.ts` la mueve sola al arrancar (se ejecuta al evaluar `proyectos.ts`, antes de que nada lea `DIR`; renombra, y si no puede copia y borra el origen solo si la copia terminó; si falla se sigue usando la antigua para no parecer «vacía»). Tras mover, `core/git/reparar.ts` rehace con `git worktree repair` los worktrees de agentes (guardan rutas absolutas). El perfil de Electron (`userData`) también se mueve (`resolverPerfil`).
`proyectos.json`, `proveedores.json` (0600; `env` en texto plano), `agentes.json` y `sesiones/`. Los módulos de `src/main` serializan sus escrituras con una cola `enCola`.

### Agentes y skills de Claude Code
Biblioteca de recursos (compartidos o individuales de un proyecto) con activación por grupo/proyecto (`src/shared/agentes.ts#activosDe`, usado por main y renderer). Al crear una terminal con un proveedor cuyo binario es `claude` y con `proyectoId`, `comandoConAgentes` (`src/main/agentes.ts`) genera un plugin de Claude Code en `sesiones/<proyecto>-<hash>/` (carpeta inmutable por contenido) y añade `--plugin-dir`. Una terminal normal o un `claude` escrito a mano no los carga. Nada se escribe en el repo del proyecto.

## Notas
- `src/main/core/` = núcleo de agentes propio, hablado directamente con la API de Anthropic (no envuelve un CLI). **No confundir** con `src/main/agentes.ts` (biblioteca de plugins para Claude Code). Dos proveedores (`preferencias.json`, por defecto **suscripción**): `suscripcion.ts` ejecuta `claude -p --output-format stream-json` y traduce su salida a `EventoAgente` (sesión con `claude auth login`, `ANTHROPIC_API_KEY` se elimina del entorno del hijo; flujos y grupos no disponibles); `api` usa el núcleo propio y necesita `ANTHROPIC_API_KEY` (entorno o `env` del proveedor `claude`). Los tests que usan `LlmFalso` deben fijar `await nucleo.preferencias.fijar('api')`. Documentado por fases en `docs/`:
  - `fase-1.md`: agente, bucle, harness, subagentes, registro de herramientas, cliente MCP.
  - `fase-2.md`: monitor de contexto (poda/resumen automático), memoria corta (`conversaciones/`) y larga (`memoria/`).
  - `fase-3.md`: grafo de estados (`modo: 'flujo'`), router de modelos, A2A por `grupoId`.
  - `fase-4.md`: flujos en git worktrees (`worktrees/`), guardrails (credenciales, rutas, destructivo) y confirmación humana (`solicitud_humana` + `core.responder`).
  - `interfaz.md`: editor de archivos de cada celda (`src/main/archivos.ts` confinado al proyecto, `src/renderer/editor/` con CodeMirror 6) y pestaña **Asistente** del renderer (`components/Asistente.tsx`, estado en `agente/useAgente.ts`, alojado en `App`): conversación con streaming, trazas, memoria, ramas, evals y el modal de confirmaciones.
  - `permisos-autonomia-comandos.md`: reglas de permisos persistentes (`permisos/`), modos de autonomía (Preguntar/Ediciones/Autónomo, presupuesto de tokens) y comandos propios con `/` (`comandos/`).
  - `fase-5.md`: trazas (`trazas/`, spans con AsyncLocalStorage, credenciales redactadas) y evals (`evals/`, aserciones + juez LLM + comparación de informes).
- **Varias cuentas de suscripción** (`src/main/core/cuentas.ts`, `cuentas.json` + `cuentas/<id>/`): la principal es el `~/.claude` de siempre; las demás usan `CLAUDE_CONFIG_DIR` y guardan su propio login. La cuenta activa se elige a mano; con «cambiar sola», un `rate_limit_event` rechazado (o 429/texto de límite) en `ejecutarSuscripcion` hace que `ejecutarPorSuscripcion` (`core/index.ts`) reintente con otra cuenta con sesión, solo si aún no ejecutó herramientas (evita duplicar cambios). La conversación se lleva copiando su `projects/*/<sesión>.jsonl` (`llevarSesion`), sin reenviar historial. No se guarda el id de sesión de una ejecución rechazada.
- **Tareas** (`src/main/core/tareas/`, `src/shared/tareas.ts`, pantalla `components/Tareas.tsx`): `ServicioTareas` es el único que escribe `tareas/tareas.json`; las reglas (terminar exige criterios/subtareas/dependencias, motivo al bloquear/descartar/reabrir, sin ciclos) son funciones puras compartidas. La interfaz usa un solo canal IPC (`tareas:operar`, autor «usuario»); la IA usa las herramientas de `shared/tareas-herramientas.ts` (autor «ia»): por el registro del núcleo en modo API, y por un **servidor MCP** (`src/main/mcp-tareas.ts`, segundo entry de `electron.vite.config.ts`, lanzado con `ELECTRON_RUN_AS_NODE=1`) en suscripción (`--mcp-config`) y en las terminales ✦ (`.mcp.json` del plugin). El MCP no tiene datos: llama por un socket local (`tareas.sock` + `tareas.token`) al proceso principal. La IA no puede borrar tareas. Ver `docs/tareas.md`.
- **Control de versiones (git)** (`src/main/core/git/`, `src/shared/versiones.ts`, pantalla `components/Versiones.tsx`): un solo canal IPC `git:operar` (`OperacionesGit`) con el **id del proyecto** (main resuelve la carpeta; el renderer nunca manda rutas de repo). `repositorio.ts` ejecuta git con `execFile`, rutas tras `--` y `GIT_LITERAL_PATHSPECS=1` (opt-in en `git()`; `stash -u` necesita desactivarlo), desde la raíz del repo, con las escrituras en cola por repositorio. `analisis.ts` analiza `status --porcelain=v2`, `log`, `for-each-ref` y traduce errores. Sin push forzado ni reset duro. Ver `docs/versiones.md`.
- **Navegador integrado y cliente API**: `src/main/navegador.ts` (ventana con la barra de direcciones de la app, `?navegador=<id>`, más una `WebContentsView` aislada: sandbox, sin preload, sesión `persist:navegador`, solo http/https, permisos denegados; `session` se configura al abrir la primera ventana porque antes de `ready` no existe) y `src/main/puertos.ts` (detección de servidores locales). Cliente API: `src/main/api/` (ejecutor `http`/`https` con redirecciones, compresión, límite y cancelación; `servicio.ts` guarda colecciones/entornos/historial en `api/datos.json` 0600) y un canal `api:operar` tipado (`OperacionesApi`); la lógica pura (variables, cURL, `normalizarUrl`) está en `src/shared/api.ts` y `navegador.ts`. Ver `docs/navegador-api.md`.
- **GitHub y herramientas de git/GitHub para la IA**: `src/main/github/` (cliente REST con errores traducidos, `AlmacenToken` con `safeStorage`: nunca en claro, `servicio.ts`, `askpass.ts`) y un canal `github:operar` (`OperacionesGitHub`). Sin el CLI `gh` (no hace falta instalarlo): API REST + token; el repositorio se deduce del remoto, resolviendo alias SSH con `ssh -G` (`ssh.github.com` = GitHub). A git se le dan credenciales por `GIT_ASKPASS` solo para https del servidor de GitHub (`Repositorio` recibe un `ProveedorCredenciales`). **Un único servidor MCP `odesk`** (`shared/herramientas-odesk.ts`) con tareas + git + GitHub; `core/herramientas-odesk.ts` es el ejecutor común (registro del núcleo en modo API y socket/MCP). `permisosCli`: lectura siempre, escritura desde «ediciones», `ejecucion` (enviar/publicar) solo «autónomo»; `destructivo.ts` marca lo que publica para que siempre pida confirmación. Sin herramientas de borrar/descartar/forzar/fusionar PRs. Ver `docs/versiones.md`.
- Eliminar un grupo exige la contraseña del usuario del sistema (`src/main/autenticacion.ts`: `sudo -S -k -v` en Linux/macOS, PowerShell en Windows); la contraseña solo viaja por stdin al proceso hijo.
- Wayland: `--ozone-platform-hint=auto` se añade en `src/main/index.ts`; ver el README para portapapeles y escalado.
