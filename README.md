# Centro de Proyectos

App de escritorio (Electron + Vite + React + TypeScript) para gestionar proyectos con varias terminales reales (xterm.js + node-pty). Fase 1: prototipo de terminales. Más adelante: memoria SQLite y agentes de IA en paralelo.

## Requisitos

- Node.js 20+
- Ubuntu/Debian: `sudo apt install build-essential python3` (para compilar node-pty)
- macOS: Xcode Command Line Tools · Windows: Visual Studio Build Tools + Python 3

## Instalar

```bash
pnpm install
```

Usa pnpm (`corepack enable` o `npm i -g pnpm`). `pnpm-workspace.yaml` autoriza el build de `node-pty` (`allowBuilds`), y `postinstall` ejecuta `electron-rebuild -f -w node-pty`. Si falla, ejecuta a mano:

```bash
pnpm exec electron-rebuild -f -w node-pty
```

Si cambias la versión de Electron, repite el rebuild.

## Desarrollo

```bash
pnpm dev
```

Otros: `pnpm typecheck`, `pnpm build`.

## Empaquetar

```bash
pnpm package
```

Genera instaladores en `dist/` (AppImage/deb en Linux, dmg en macOS, nsis en Windows) con `electron-builder`. `node-pty` se desempaqueta del asar.

## Proyectos

Se leen de `~/.centro-proyectos/proyectos.json` (se crea con datos de ejemplo si no existe):

```json
{
  "grupos": [{ "id": "trabajo", "nombre": "Trabajo" }],
  "proyectos": [{ "id": "api", "nombre": "API", "ruta": "/home/yo/dev/api", "grupo": "trabajo" }]
}
```

`grupo` es opcional. Se lee al iniciar la app (reiniciar para ver cambios).

## Proveedores de IA

Un proveedor es un CLI que se ejecuta dentro de una terminal (Claude Code, Codex, Gemini, Ollama…). Se gestionan en **Proveedores de IA** (barra lateral) y se guardan en `~/.centro-proyectos/proveedores.json` (permisos 600; se crea con `claude`, `codex` y `gemini`).

```json
[{ "id": "claude", "nombre": "Claude Code", "comando": "claude --model sonnet", "env": { "VAR": "valor" } }]
```

- `comando` se escribe tal cual en el shell interactivo del proyecto, así hereda PATH, nvm, etc. Al salir del CLI la terminal sigue viva.
- Uso: pasa el ratón sobre un proyecto en la barra lateral y pulsa ✦ para elegir proveedor.
- «No detectado» = el ejecutable no está en el PATH de la app; puede funcionar igual si tu shell lo carga.
- `env` se guarda en texto plano: si ya iniciaste sesión en el CLI no hace falta poner claves.

## Rejilla de terminales

Mosaico sin huecos: cada terminal tiene su propio tamaño. Arrastra bordes/esquinas para redimensionar (los vecinos se encogen hasta 260×150 px y luego se desplazan), arrastra la barra de título sobre otra terminal para intercambiarlas. Al cerrar una, un vecino ocupa su sitio; al abrir una, se parte la más grande. «Reorganizar» vuelve a la cuadrícula automática.

## Atajos

- `Ctrl+Shift+C` copiar · `Ctrl+Shift+V` pegar
- `Ctrl+C` copia si hay texto seleccionado; si no, envía SIGINT al proceso.

## Wayland

Main activa `--ozone-platform-hint=auto` (Electron elige Wayland o X11). Notas:

- Portapapeles: usa `navigator.clipboard`; en Wayland puede requerir que la ventana tenga foco. Si falla, probar `--ozone-platform=x11` (`pnpm dev -- --ozone-platform=x11`).
- Escalado fraccional (GNOME): texto borroso posible en XWayland; en Wayland nativo suele ir bien. Si se ve borroso, probar `--enable-features=WaylandFractionalScaleV1`.
- El renderer WebGL cae a DOM automáticamente si falla la GPU.

## Estructura

```
src/main       proceso principal, gestor node-pty
src/main/memoria, src/main/agentes   reservados (fases futuras)
src/preload    contextBridge + IPC tipado
src/renderer   React: Sidebar, TerminalPanel, TerminalGrid
src/shared     tipos IPC y modelos Proyecto/Grupo
```

## Seguridad

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP en el HTML. El renderer solo accede a `window.api`.
