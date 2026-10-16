# Centro de Proyectos

App de escritorio (Electron + Vite + React + TypeScript) para gestionar proyectos con varias terminales reales (xterm.js + node-pty). Fase 1: prototipo de terminales. Más adelante: memoria SQLite y agentes de IA en paralelo.

## Requisitos

- Node.js 20+
- Ubuntu/Debian: `sudo apt install build-essential python3` (para compilar node-pty)
- macOS: Xcode Command Line Tools · Windows: Visual Studio Build Tools + Python 3

## Instalar

```bash
npm install
```

`postinstall` ejecuta `electron-rebuild -f -w node-pty`. Si tu npm bloquea scripts de instalación (npm 12+), ejecuta a mano:

```bash
npx electron-rebuild -f -w node-pty
```

Si cambias la versión de Electron, repite el rebuild.

## Desarrollo

```bash
npm run dev
```

Otros: `npm run typecheck`, `npm run build`.

## Empaquetar

```bash
npm run package
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

## Atajos

- `Ctrl+Shift+C` copiar · `Ctrl+Shift+V` pegar
- `Ctrl+C` copia si hay texto seleccionado; si no, envía SIGINT al proceso.

## Wayland

Main activa `--ozone-platform-hint=auto` (Electron elige Wayland o X11). Notas:

- Portapapeles: usa `navigator.clipboard`; en Wayland puede requerir que la ventana tenga foco. Si falla, probar `--ozone-platform=x11` (`npx electron-vite dev -- --ozone-platform=x11`).
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
