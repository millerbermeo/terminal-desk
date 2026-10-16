#!/usr/bin/env bash
# Instalador y actualizador de ODESK AI (Linux y macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/millerbermeo/terminal-desk/main/install.sh | bash
#
# Ejecutarlo de nuevo actualiza a la última versión (solo reconstruye lo que cambió).
# Opciones (después de `bash -s --`):  --desinstalar · --ref <rama|etiqueta|commit> · --ayuda
# Variables: CENTRO_REPO, CENTRO_REF, CENTRO_DIR (carpeta de instalación), CENTRO_BIN (carpeta del lanzador).
set -euo pipefail

REPO="${CENTRO_REPO:-https://github.com/millerbermeo/terminal-desk.git}"
REF="${CENTRO_REF:-}"
DIR="${CENTRO_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/centro-proyectos}"
BIN="${CENTRO_BIN:-$HOME/.local/bin}"
NODE_MAJOR=24
NODE_MIN=20
ACCION=instalar
BORRAR_DATOS=0
DATOS="$HOME/.centro-proyectos"

if [ -t 1 ]; then V=$'\033[32m'; R=$'\033[31m'; A=$'\033[33m'; N=$'\033[0m'; else V=; R=; A=; N=; fi
paso() { printf '%s==>%s %s\n' "$V" "$N" "$*"; }
aviso() { printf '%saviso:%s %s\n' "$A" "$N" "$*" >&2; }
fallo() { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --desinstalar) ACCION=desinstalar ;;
    --todo) ACCION=desinstalar; BORRAR_DATOS=1 ;;
    --ref) shift; [ $# -gt 0 ] || fallo "--ref necesita un valor"; REF="$1" ;;
    --ayuda|-h|--help)
      echo "Uso: install.sh [--desinstalar | --todo] [--ref <rama|etiqueta|commit>]"
      echo "  --desinstalar  borra la app; conserva tus datos (~/.centro-proyectos)"
      echo "  --todo         borra la app Y todos tus datos (proyectos, ajustes, memoria)"
      echo "Variables: CENTRO_REPO, CENTRO_REF, CENTRO_DIR, CENTRO_BIN"
      exit 0 ;;
    *) fallo "opción desconocida: $1" ;;
  esac
  shift
done

SO="$(uname -s)"
case "$SO" in
  Linux) SO_NODE=linux ;;
  Darwin) SO_NODE=darwin ;;
  *) fallo "sistema no soportado: $SO (en Windows usa install.ps1)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARQ=x64 ;;
  aarch64|arm64) ARQ=arm64 ;;
  *) fallo "arquitectura no soportada: $(uname -m)" ;;
esac

LANZADOR="$BIN/centro-proyectos"
ESCRITORIO="${XDG_DATA_HOME:-$HOME/.local/share}/applications/odesk-ai.desktop"
ESCRITORIO_ANTIGUO="${XDG_DATA_HOME:-$HOME/.local/share}/applications/centro-proyectos.desktop"

desinstalar() {
  paso "Desinstalando de $DIR"
  rm -rf "$DIR" "$LANZADOR" "$ESCRITORIO" "$ESCRITORIO_ANTIGUO"
  if [ "$BORRAR_DATOS" = 1 ]; then
    paso "Borrando datos de usuario en $DATOS"
    rm -rf "$DATOS"
    echo "Listo. ODESK AI y todos sus datos eliminados."
  else
    echo "Listo. Tus proyectos y ajustes siguen en $DATOS (para borrarlos también: --todo)."
  fi
}

if [ "$ACCION" = desinstalar ]; then desinstalar; exit 0; fi

necesita() { command -v "$1" >/dev/null 2>&1 || fallo "falta '$1'. $2"; }
necesita curl "Instálalo con el gestor de paquetes de tu sistema."
necesita git "Instálalo: Debian/Ubuntu 'sudo apt install git' · Fedora 'sudo dnf install git' · macOS 'xcode-select --install'."
necesita tar "Instálalo con el gestor de paquetes de tu sistema."

# Compilar node-pty en Linux necesita toolchain (macOS trae binarios precompilados).
if [ "$SO" = Linux ]; then
  faltan=()
  for c in make g++ python3; do command -v "$c" >/dev/null 2>&1 || faltan+=("$c"); done
  if [ ${#faltan[@]} -gt 0 ]; then
    fallo "faltan herramientas de compilación (${faltan[*]}). Debian/Ubuntu: 'sudo apt install build-essential python3' · Fedora: 'sudo dnf install gcc-c++ make python3' · Arch: 'sudo pacman -S base-devel python'."
  fi
fi

mkdir -p "$DIR" "$BIN"

# --- Node.js: usa el del sistema si es >= 20; si no, descarga uno privado ---
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local m; m="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$m" -ge "$NODE_MIN" ]
}

if [ -x "$DIR/node/bin/node" ]; then
  export PATH="$DIR/node/bin:$PATH"
fi
if ! node_ok; then
  paso "Descargando Node.js $NODE_MAJOR (LTS) en $DIR/node"
  base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  archivo="$(grep -o "node-v[0-9.]*-$SO_NODE-$ARQ\.tar\.xz" "$tmp/SHASUMS256.txt" | head -n1 || true)"
  [ -n "$archivo" ] || fallo "no encontré Node.js para $SO_NODE-$ARQ en $base"
  curl -fSL --progress-bar "$base/$archivo" -o "$tmp/$archivo"
  esperado="$(grep " $archivo\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null 2>&1; then real="$(sha256sum "$tmp/$archivo" | cut -d' ' -f1)"
  else real="$(shasum -a 256 "$tmp/$archivo" | cut -d' ' -f1)"; fi
  [ "$esperado" = "$real" ] || fallo "checksum de Node.js incorrecto (descarga corrupta)"
  rm -rf "$DIR/node"; mkdir -p "$DIR/node"
  tar -xJf "$tmp/$archivo" -C "$DIR/node" --strip-components=1
  export PATH="$DIR/node/bin:$PATH"
fi
node_ok || fallo "Node.js >= $NODE_MIN no disponible"
paso "Node.js $(node -v)"

# --- pnpm: el del sistema o uno privado ---
if ! command -v pnpm >/dev/null 2>&1; then
  paso "Instalando pnpm en $DIR/tools"
  npm install --silent --no-audit --no-fund --prefix "$DIR/tools" pnpm@11 >/dev/null
  export PATH="$DIR/tools/node_modules/.bin:$PATH"
fi

REPO_DIR="$DIR/repo"
# --- Linux: el sandbox de Chromium exige chrome-sandbox con dueño root y modo 4755 ---
arreglar_sandbox() {
  [ "$SO" = Linux ] || return 0
  local sb="$REPO_DIR/node_modules/electron/dist/chrome-sandbox"
  [ -f "$sb" ] || return 0
  [ "$(stat -c '%u %a' "$sb")" = "0 4755" ] && return 0
  paso "Configurando el sandbox de Electron (necesita sudo, se pide una sola vez)"
  # cp rompe enlaces duros hacia el almacén de pnpm antes de cambiar dueño y permisos
  if command -v sudo >/dev/null 2>&1 &&
     sudo sh -c 'cp --remove-destination "$1" "$1.tmp" && mv -f "$1.tmp" "$1" && chown root:root "$1" && chmod 4755 "$1"' _ "$sb"; then
    return 0
  fi
  aviso "No pude configurar el sandbox. Ejecuta a mano:"
  aviso "  sudo chown root:root '$sb' && sudo chmod 4755 '$sb'"
}

# --- Código fuente: clona o actualiza ---
if [ -d "$REPO_DIR/.git" ]; then
  paso "Buscando actualizaciones"
  git -C "$REPO_DIR" remote set-url origin "$REPO"
  git -C "$REPO_DIR" fetch --quiet --tags --force origin
  if [ -z "$REF" ]; then
    REF="$(git -C "$REPO_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
    REF="${REF:-main}"
  fi
else
  paso "Descargando ODESK AI"
  rm -rf "$REPO_DIR"
  git clone --quiet "$REPO" "$REPO_DIR"
  [ -n "$REF" ] || REF="$(git -C "$REPO_DIR" symbolic-ref --short HEAD)"
fi

if git -C "$REPO_DIR" rev-parse --verify --quiet "origin/$REF^{commit}" >/dev/null; then
  DESTINO="origin/$REF"
else
  DESTINO="$REF"
fi
NUEVO="$(git -C "$REPO_DIR" rev-parse --verify "$DESTINO^{commit}")" || fallo "no existe la referencia '$REF'"
ACTUAL="$(cat "$DIR/instalado.commit" 2>/dev/null || true)"

if [ "$NUEVO" = "$ACTUAL" ] && [ -d "$REPO_DIR/out" ] && [ -e "$LANZADOR" ]; then
  paso "Ya tienes la última versión ($(git -C "$REPO_DIR" rev-parse --short "$NUEVO"))"
  arreglar_sandbox
  exit 0
fi

if pgrep -f "$REPO_DIR/node_modules/electron" >/dev/null 2>&1; then
  aviso "ODESK AI está abierto: ciérralo y vuelve a abrirlo tras actualizar."
fi

git -C "$REPO_DIR" checkout --quiet --force --detach "$NUEVO"
git -C "$REPO_DIR" clean --quiet -fd -e node_modules -e out
cd "$REPO_DIR"

# --- Dependencias: solo si cambió el lockfile o falta algo ---
HUELLA="$(cat pnpm-lock.yaml package.json pnpm-workspace.yaml .pnpmfile.cjs 2>/dev/null | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1)"
if [ "$HUELLA" != "$(cat "$DIR/dependencias.huella" 2>/dev/null || true)" ] || [ ! -d node_modules/electron ]; then
  paso "Instalando dependencias"
  pnpm install --frozen-lockfile --ignore-scripts
  paso "Preparando Electron"
  node node_modules/electron/install.js
  if [ ! -d node_modules/node-pty/prebuilds/$SO_NODE-$ARQ ] || [ "$SO" = Linux ]; then
    paso "Compilando node-pty"
    pnpm exec electron-rebuild -f -w node-pty
  fi
  printf '%s' "$HUELLA" > "$DIR/dependencias.huella"
fi

paso "Compilando la aplicación"
pnpm build
printf '%s' "$NUEVO" > "$DIR/instalado.commit"
arreglar_sandbox

# --- Lanzador ---
cat > "$LANZADOR" <<EOF
#!/usr/bin/env bash
# Generado por install.sh
DIR="$DIR"
case "\${1:-}" in
  actualizar) shift; exec bash "\$DIR/repo/install.sh" "\$@" ;;
  desinstalar) shift; if [ "\${1:-}" = "--todo" ]; then exec bash "\$DIR/repo/install.sh" --todo; fi; exec bash "\$DIR/repo/install.sh" --desinstalar ;;
esac
unset ELECTRON_RUN_AS_NODE
rel="\$(cat "\$DIR/repo/node_modules/electron/path.txt")"
exec "\$DIR/repo/node_modules/electron/dist/\$rel" "\$DIR/repo" "\$@"
EOF
chmod +x "$LANZADOR"

if [ "$SO" = Linux ]; then
  mkdir -p "$(dirname "$ESCRITORIO")"
  cat > "$ESCRITORIO" <<EOF
[Desktop Entry]
Type=Application
Name=ODESK AI
Comment=Gestor de proyectos con varias terminales y agentes de IA
Exec=$LANZADOR
Icon=$REPO_DIR/resources/icon.png
StartupWMClass=ODESK AI
Terminal=false
Categories=Development;
EOF
  rm -f "$ESCRITORIO_ANTIGUO"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$ESCRITORIO")" >/dev/null 2>&1 || true
fi

paso "Instalado: $(git -C "$REPO_DIR" rev-parse --short "$NUEVO") (${REF})"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) aviso "$BIN no está en tu PATH. Añade a tu shell:  export PATH=\"$BIN:\$PATH\"" ;;
esac
echo "Ejecuta:  centro-proyectos        Actualizar:  centro-proyectos actualizar"
