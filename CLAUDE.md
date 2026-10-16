# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Centro de Proyectos**: app de escritorio (Electron + Vite + React + TypeScript) que gestiona proyectos con varias terminales reales (xterm.js + node-pty) y lanza CLIs de IA (hoy, Claude Code) dentro de ellas. Todo el código, los identificadores y la UI están en español; mantenlo así.

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
- Para probar la app real sin ver la ventana: lanzar `electron . --remote-debugging-port=9222` (con `HOME` apuntando a una carpeta temporal para no tocar `~/.centro-proyectos`) y manejarla por CDP. Hay que enviar `Page.bringToFront` y `Emulation.setFocusEmulationEnabled` o los eventos de ratón tardan ~5 s cada uno. Los ptys se miden con `ps` (hijos del proceso principal).
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

### Persistencia (`~/.centro-proyectos/`)
`proyectos.json`, `proveedores.json` (0600; `env` en texto plano), `agentes.json` y `sesiones/`. Los módulos de `src/main` serializan sus escrituras con una cola `enCola`.

### Agentes y skills de Claude Code
Biblioteca de recursos (compartidos o individuales de un proyecto) con activación por grupo/proyecto (`src/shared/agentes.ts#activosDe`, usado por main y renderer). Al crear una terminal con un proveedor cuyo binario es `claude` y con `proyectoId`, `comandoConAgentes` (`src/main/agentes.ts`) genera un plugin de Claude Code en `sesiones/<proyecto>-<hash>/` (carpeta inmutable por contenido) y añade `--plugin-dir`. Una terminal normal o un `claude` escrito a mano no los carga. Nada se escribe en el repo del proyecto.

## Notas
- `src/main/core/` = núcleo de agentes propio, hablado directamente con la API de Anthropic (no envuelve un CLI). **No confundir** con `src/main/agentes.ts` (biblioteca de plugins para Claude Code). Necesita `ANTHROPIC_API_KEY` (entorno o `env` del proveedor `claude`). Documentado por fases en `docs/`:
  - `fase-1.md`: agente, bucle, harness, subagentes, registro de herramientas, cliente MCP.
  - `fase-2.md`: monitor de contexto (poda/resumen automático), memoria corta (`conversaciones/`) y larga (`memoria/`).
  - `fase-3.md`: grafo de estados (`modo: 'flujo'`), router de modelos, A2A por `grupoId`.
  - `fase-4.md`: flujos en git worktrees (`worktrees/`), guardrails (credenciales, rutas, destructivo) y confirmación humana (`solicitud_humana` + `core.responder`).
  - `interfaz.md`: editor de archivos de cada celda (`src/main/archivos.ts` confinado al proyecto, `src/renderer/editor/` con CodeMirror 6) y pestaña **Asistente** del renderer (`components/Asistente.tsx`, estado en `agente/useAgente.ts`, alojado en `App`): conversación con streaming, trazas, memoria, ramas, evals y el modal de confirmaciones.
  - `permisos-autonomia-comandos.md`: reglas de permisos persistentes (`permisos/`), modos de autonomía (Preguntar/Ediciones/Autónomo, presupuesto de tokens) y comandos propios con `/` (`comandos/`).
  - `fase-5.md`: trazas (`trazas/`, spans con AsyncLocalStorage, credenciales redactadas) y evals (`evals/`, aserciones + juez LLM + comparación de informes).
- Eliminar un grupo exige la contraseña del usuario del sistema (`src/main/autenticacion.ts`: `sudo -S -k -v` en Linux/macOS, PowerShell en Windows); la contraseña solo viaja por stdin al proceso hijo.
- Wayland: `--ozone-platform-hint=auto` se añade en `src/main/index.ts`; ver el README para portapapeles y escalado.
