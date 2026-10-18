# Instalador y actualizador de Odesk Agent (Windows).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/millerbermeo/terminal-desk/main/install.ps1 | iex"
#
# Ejecutarlo de nuevo actualiza a la última versión (solo reconstruye lo que cambió).
# Variables de entorno: ODESK_REPO, ODESK_REF, ODESK_DIR, ODESK_SERVIDOR (servidor por defecto de la app), CENTRO_UNINSTALL=1 (desinstalar) o CENTRO_UNINSTALL=all (desinstalar y borrar datos).
# (Se siguen aceptando las antiguas CENTRO_REPO, CENTRO_REF y CENTRO_DIR.)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = if ($env:ODESK_REPO) { $env:ODESK_REPO } elseif ($env:CENTRO_REPO) { $env:CENTRO_REPO } else { 'https://github.com/millerbermeo/terminal-desk.git' }
$Ref = if ($env:ODESK_REF) { $env:ODESK_REF } else { $env:CENTRO_REF }
$DirNuevo = Join-Path $env:LOCALAPPDATA 'odesk-agent'
$DirAntiguo = Join-Path $env:LOCALAPPDATA 'centro-proyectos' # nombre anterior de la app
$DirPersonalizado = if ($env:ODESK_DIR) { $env:ODESK_DIR } else { $env:CENTRO_DIR }
# Una instalación existente se actualiza donde está (no se mueve); las nuevas usan la carpeta con el nombre actual.
$Dir = if ($DirPersonalizado) { $DirPersonalizado } elseif ((-not (Test-Path $DirNuevo)) -and (Test-Path $DirAntiguo)) { $DirAntiguo } else { $DirNuevo }
$NodeMajor = 24
$NodeMin = 20
$Lanzador = Join-Path $Dir 'odesk.cmd'
$Atajo = Join-Path ([Environment]::GetFolderPath('Programs')) 'Odesk Agent.lnk'
$AtajoAntiguo = Join-Path ([Environment]::GetFolderPath('Programs')) 'ODESK AI.lnk' # nombre anterior de la app

function Paso($m) { Write-Host "==> $m" -ForegroundColor Green }
function Fallo($m) { Write-Host "error: $m" -ForegroundColor Red; throw $m }
function Ejecutar([string]$exe, [string[]]$args_) {
  & $exe @args_
  if ($LASTEXITCODE -ne 0) { Fallo "falló: $exe $($args_ -join ' ')" }
}

if ($env:CENTRO_UNINSTALL -in '1', 'all') {
  Paso "Desinstalando de $Dir"
  Remove-Item -Recurse -Force $Dir, $Atajo, $AtajoAntiguo -ErrorAction SilentlyContinue
  if (-not $DirPersonalizado) { Remove-Item -Recurse -Force $DirAntiguo -ErrorAction SilentlyContinue }
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $nuevo = ($u -split ';' | Where-Object { $_ -and $_ -ne $Dir }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $nuevo, 'User')
  $datos = Join-Path $env:USERPROFILE '.odesk-agent'
  $datosAntiguos = Join-Path $env:USERPROFILE '.centro-proyectos' # la app los mueve sola al abrirse
  if ($env:CENTRO_UNINSTALL -eq 'all') {
    Paso "Borrando datos de usuario en $datos"
    Remove-Item -Recurse -Force $datos, $datosAntiguos -ErrorAction SilentlyContinue
    Write-Host 'Listo. Odesk Agent y todos sus datos eliminados.'
  } else {
    Write-Host "Listo. Tus proyectos y ajustes siguen en $datos (para borrarlos también: CENTRO_UNINSTALL=all)."
  }
  return
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fallo "falta git. Instálalo con:  winget install --id Git.Git -e"
}

$arq = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# --- Node.js: usa el del sistema si es >= 20; si no, descarga uno privado ---
function NodeOk {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return $false }
  $m = [int](& node -p 'process.versions.node.split(".")[0]')
  return $m -ge $NodeMin
}
$nodePriv = Join-Path $Dir 'node'
if (Test-Path (Join-Path $nodePriv 'node.exe')) { $env:Path = "$nodePriv;$env:Path" }
if (-not (NodeOk)) {
  Paso "Descargando Node.js $NodeMajor (LTS) en $nodePriv"
  $base = "https://nodejs.org/dist/latest-v$NodeMajor.x"
  $sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content
  $linea = ($sums -split "`n" | Where-Object { $_ -match "node-v[\d.]+-win-$arq\.zip\s*$" } | Select-Object -First 1)
  if (-not $linea) { Fallo "no encontré Node.js para win-$arq en $base" }
  $hash, $archivo = ($linea.Trim() -split '\s+')
  $tmp = Join-Path ([IO.Path]::GetTempPath()) $archivo
  Invoke-WebRequest -UseBasicParsing "$base/$archivo" -OutFile $tmp
  if ((Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower() -ne $hash.ToLower()) { Fallo 'checksum de Node.js incorrecto (descarga corrupta)' }
  Remove-Item -Recurse -Force $nodePriv -ErrorAction SilentlyContinue
  $ext = Join-Path ([IO.Path]::GetTempPath()) 'centro-node'
  Remove-Item -Recurse -Force $ext -ErrorAction SilentlyContinue
  Expand-Archive $tmp -DestinationPath $ext
  Move-Item (Get-ChildItem $ext | Select-Object -First 1).FullName $nodePriv
  Remove-Item -Recurse -Force $ext, $tmp
  $env:Path = "$nodePriv;$env:Path"
}
if (-not (NodeOk)) { Fallo "Node.js >= $NodeMin no disponible" }
Paso "Node.js $(& node -v)"

# --- pnpm: el del sistema o uno privado ---
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Paso "Instalando pnpm en $Dir\tools"
  Ejecutar 'npm' @('install', '--silent', '--no-audit', '--no-fund', '--prefix', (Join-Path $Dir 'tools'), 'pnpm@11')
  $env:Path = "$(Join-Path $Dir 'tools\node_modules\.bin');$env:Path"
}

# --- Código fuente: clona o actualiza ---
$RepoDir = Join-Path $Dir 'repo'
if (Test-Path (Join-Path $RepoDir '.git')) {
  Paso 'Buscando actualizaciones'
  Ejecutar 'git' @('-C', $RepoDir, 'remote', 'set-url', 'origin', $Repo)
  Ejecutar 'git' @('-C', $RepoDir, 'fetch', '--quiet', '--tags', '--force', 'origin')
  if (-not $Ref) {
    $h = (& git -C $RepoDir symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null)
    $Ref = if ($h) { $h -replace '^origin/', '' } else { 'main' }
  }
} else {
  Paso 'Descargando Odesk Agent'
  Remove-Item -Recurse -Force $RepoDir -ErrorAction SilentlyContinue
  Ejecutar 'git' @('clone', '--quiet', $Repo, $RepoDir)
  if (-not $Ref) { $Ref = (& git -C $RepoDir symbolic-ref --short HEAD) }
}

& git -C $RepoDir rev-parse --verify --quiet "origin/$Ref^{commit}" *> $null
$destino = if ($LASTEXITCODE -eq 0) { "origin/$Ref" } else { $Ref }
$nuevo = (& git -C $RepoDir rev-parse --verify "$destino^{commit}")
if ($LASTEXITCODE -ne 0) { Fallo "no existe la referencia '$Ref'" }
$fCommit = Join-Path $Dir 'instalado.commit'
$actual = if (Test-Path $fCommit) { (Get-Content $fCommit -Raw).Trim() } else { '' }

if ($nuevo -eq $actual -and (Test-Path (Join-Path $RepoDir 'out')) -and (Test-Path $Lanzador)) {
  Paso "Ya tienes la última versión ($($nuevo.Substring(0, 7)))"
  return
}

if (Get-Process -Name 'Odesk Agent', 'electron' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$RepoDir*" }) {
  Write-Host 'aviso: Odesk Agent está abierto: ciérralo antes de actualizar.' -ForegroundColor Yellow
}

Ejecutar 'git' @('-C', $RepoDir, 'checkout', '--quiet', '--force', '--detach', $nuevo)
Ejecutar 'git' @('-C', $RepoDir, 'clean', '--quiet', '-fd', '-e', 'node_modules', '-e', 'out')
Set-Location $RepoDir

# --- Dependencias: solo si cambió el lockfile o falta algo ---
$huella = (Get-FileHash -Algorithm SHA256 -InputStream ([IO.MemoryStream]::new(
  [Text.Encoding]::UTF8.GetBytes(((@('pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', '.pnpmfile.cjs') |
    Where-Object { Test-Path $_ } | ForEach-Object { Get-Content $_ -Raw }) -join "`n"))))).Hash
$fHuella = Join-Path $Dir 'dependencias.huella'
$huellaPrev = if (Test-Path $fHuella) { (Get-Content $fHuella -Raw).Trim() } else { '' }
if ($huella -ne $huellaPrev -or -not (Test-Path 'node_modules\electron')) {
  Paso 'Instalando dependencias'
  Ejecutar 'pnpm' @('install', '--frozen-lockfile', '--ignore-scripts')
  Paso 'Preparando Electron'
  Ejecutar 'node' @('node_modules\electron\install.js')
  if (-not (Test-Path "node_modules\node-pty\prebuilds\win32-$arq")) {
    Paso 'Compilando node-pty (requiere Visual Studio Build Tools y Python 3)'
    Ejecutar 'pnpm' @('exec', 'electron-rebuild', '-f', '-w', 'node-pty')
  }
  Set-Content -NoNewline -Path $fHuella -Value $huella
}

Paso 'Compilando la aplicación'
Ejecutar 'pnpm' @('build')
Set-Content -NoNewline -Path $fCommit -Value $nuevo

# --- Servidor por defecto (la app lo lee de aquí; lo que el usuario elija en la pantalla de acceso manda sobre él) ---
$Servidor = if ($env:ODESK_SERVIDOR) { $env:ODESK_SERVIDOR } else { 'https://odesk.millerrivera.com' }
Set-Content -NoNewline -Path (Join-Path $Dir 'servidor-por-defecto.txt') -Value $Servidor -Encoding ASCII

# --- Lanzador, acceso del menú Inicio y PATH ---
$electron = Join-Path $RepoDir 'node_modules\electron\dist\electron.exe'
@"
@echo off
rem Generado por install.ps1
set ELECTRON_RUN_AS_NODE=
if /i "%~1"=="actualizar" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "$RepoDir\install.ps1"
  exit /b %errorlevel%
)
if /i "%~1"=="desinstalar" (
  set CENTRO_UNINSTALL=1
  if /i "%~2"=="--todo" set CENTRO_UNINSTALL=all
  powershell -NoProfile -ExecutionPolicy Bypass -File "$RepoDir\install.ps1"
  exit /b %errorlevel%
)
start "" "$electron" "$RepoDir" %*
"@ | Set-Content -Path $Lanzador -Encoding ASCII

$sh = New-Object -ComObject WScript.Shell
Remove-Item -Force $AtajoAntiguo -ErrorAction SilentlyContinue
$lnk = $sh.CreateShortcut($Atajo)
$lnk.TargetPath = $electron
$lnk.Arguments = "`"$RepoDir`""
$lnk.WorkingDirectory = $RepoDir
$lnk.IconLocation = (Join-Path $RepoDir 'resources\icon.ico')
$lnk.Save()

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $Dir) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$Dir", 'User')
  Write-Host 'aviso: se añadió la carpeta al PATH; abre una terminal nueva para usar "odesk".' -ForegroundColor Yellow
}

Paso "Instalado: $($nuevo.Substring(0, 7)) ($Ref)"
Write-Host 'Ejecuta:  odesk  (o desde el menú Inicio)    Actualizar:  odesk actualizar'
