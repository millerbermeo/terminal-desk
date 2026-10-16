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

## Agentes y skills (Claude Code)

Pantalla **Agentes y skills**: biblioteca de subagentes y skills de Claude Code, guardada en `~/.centro-proyectos/agentes.json`.

- **Compartidos:** se definen una vez y se activan por **grupo** (todos sus proyectos) o por **proyecto**. Lo del grupo se suma a lo del proyecto.
- **Individuales:** pertenecen a un solo proyecto y siempre se cargan en él.
- **Cuándo se aplican:** solo al abrir una terminal con Claude desde un proyecto (✦ → Claude Code). Una terminal normal, o escribir `claude` a mano, no los lleva.
- **Cómo:** la app genera un plugin de Claude Code en `~/.centro-proyectos/sesiones/` y arranca `claude --plugin-dir <carpeta>`. No se escribe nada en el repositorio del proyecto. Los subagentes aparecen como `centro:<nombre>`. Las carpetas generadas se borran a los 14 días.
- Cambiar la configuración afecta a las terminales que abras después; las sesiones de Claude ya abiertas no se actualizan.

## Pestañas por grupo

Cada grupo se abre en su propia pestaña (arriba) con sus terminales; al abrir otro grupo se crea otra pestaña y las anteriores siguen vivas en segundo plano, con sus procesos. ▶ en un grupo abre una terminal por proyecto (si ya tiene pestaña, va a ella); un clic en un proyecto lo abre en la pestaña de su grupo, o te lleva a su terminal si ya la tiene (no duplica); para una terminal extra usa «+ Terminal» dentro de la pestaña (proyecto del grupo o terminal vacía); «+» (arriba) crea una pestaña suelta. Cerrar una pestaña (× o clic central) pide confirmación y cierra sus procesos. Cada pestaña tiene su propio layout.

## Ventanas separadas

Arrastra una pestaña hacia abajo, fuera de la barra de pestañas, para abrirla en una ventana nueva (o usa el icono ⧉ de la pestaña). La ventana nueva solo contiene las terminales: los mismos procesos siguen vivos (no se reinician) y se repinta lo que mostraban. «Devolver a la principal» (barra de la ventana separada) las trae de vuelta como pestaña, con sus procesos e historial. Cerrar la ventana separada con la × cierra sus procesos; cerrar la ventana principal cierra toda la app.

## Rejilla de terminales

Layout en árbol de divisiones (como tmux/VSCode): siempre cubre todo el área, sin huecos. Arrastra un divisor para mover esa línea completa (cada terminal conserva como mínimo 260×150 px); doble clic en un divisor lo centra. Arrastra la barra de título sobre otra terminal para intercambiarlas. Al cerrar una, su vecino ocupa el sitio; al abrir una, se parte la más grande. «Reorganizar» vuelve a la cuadrícula automática.

## Clic derecho en una terminal

Menú con Copiar, Pegar, Seleccionar todo y Limpiar pantalla. Si el programa que corre dentro usa el ratón (vim, tmux, htop…) el clic derecho es suyo; con Mayús+clic derecho se abre el menú igualmente.

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
