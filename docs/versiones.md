# Control de versiones (git)

Pantalla **Versiones** (barra lateral): gestiona con git la versión de cada proyecto sin salir de la aplicación.

## Qué se puede hacer

- **Cambios**: archivos conflictivos, preparados, modificados y nuevos; preparar o quitar archivos (uno o todos), descartar cambios (con confirmación), ver el diff con números de línea y confirmar con un mensaje (Ctrl+Enter). «Enmendar último» cambia el último commit.
- **Historial**: commits con sus ramas y etiquetas, paginado, filtrable por rama y texto. El detalle muestra autor, fecha, hash, padres y los archivos con sus diferencias. Desde ahí: crear una rama o una versión en ese commit y revertirlo (commit inverso, sin reescribir historia).
- **Ramas**: crear, cambiar, fusionar en la actual y eliminar (si tiene commits sin fusionar pide confirmar el borrado forzado). Ramas remotas (crear la local que las sigue) y remotos (agregar uno).
- **Fusión**: compara la rama actual con otra **sin tocar nada** y la integra archivo a archivo en un **editor de tres paneles** como el de PhpStorm: a la izquierda la rama de origen (los cambios que quieres traer), a la derecha la rama actual y en el centro el resultado. Cada cambio se resuelve con «« origen», «actual »», «actual + origen», «origen + actual», «base» o «✎ editar» (escribirlo a mano); los que git fusionaría solo vienen ya resueltos y los conflictos quedan marcados hasta que eliges. «Todo de origen / de la actual», «Siguiente conflicto» y tramos sin cambios plegados. Si una rama borró el archivo (o es binario) se elige la versión entera. **Fusionar** exige resolver todos los conflictos y no tener cambios sin confirmar; hace `git merge --no-commit --no-ff`, escribe tus resoluciones y crea el commit de fusión (o lo deja listo en «Cambios» sin la casilla «Crear el commit»). Si algo falla se aborta y el árbol queda como estaba.
- **Versiones**: etiquetas anotadas de git. Sugiere la siguiente versión semántica (parche, menor, mayor) a partir de las existentes, indica cuántos commits hay desde la última y permite enviarlas al remoto.
- **Stash**: apartar los cambios sin confirmar (con o sin archivos nuevos), recuperarlos o aplicarlos y eliminarlos.
- **Sincronizar**: Obtener (fetch), Traer (pull sin mezclar; con rebase si la rama divergió) y Enviar/Publicar rama. Los conflictos de fusión, revert, pull o stash se resuelven en «Cambios» y se confirman, o se aborta la operación.
- **Primeros pasos**: inicializar el repositorio de un proyecto y configurar tu nombre y correo (global o del proyecto) cuando falta.

## GitHub

Pestaña **GitHub** de la pantalla Versiones, y botón **Clonar** siempre visible.

- **Conectar**: un botón abre GitHub en la página de crear un token con los permisos (`repo`, `workflow`) ya marcados; lo pegas y listo. El token se guarda **cifrado con el llavero del sistema** (`safeStorage`), nunca en claro; si el sistema no ofrece un llavero seguro (Linux sin gestor de claves), solo vive en memoria hasta cerrar la app y la pantalla lo avisa. Se valida al conectar y se explica el error si falla.
- **Clonar**: de tu lista de repositorios, por `propietario/repo` o por URL (https, ssh o una ruta local). Elige carpeta y grupo; se clona, se agrega como proyecto y se abre.
- **Publicar**: si el proyecto no tiene remoto, «Crear y publicar» crea el repositorio en GitHub (privado por defecto, en tu cuenta o en una organización), lo enlaza como `origin` y envía la rama actual. Valida antes de crear nada (hace falta un commit y que no exista ya `origin`).
- **Pull requests**: el de la rama actual con el estado de sus comprobaciones (CI), crear uno (envía la rama antes si hace falta) o fusionar (squash, merge o rebase, con confirmación); lista de los abiertos y «Traer rama» para revisarlos en local.
- **Incidencias**: listar (sin los pull requests, que la API mezcla) y crear.
- **El repositorio se deduce del remoto** del proyecto, también con alias de `~/.ssh/config` (se resuelven con `ssh -G`; `ssh.github.com`, el acceso por el puerto 443, cuenta como GitHub).
- **Enviar y traer por https funcionan sin configurar nada**: a git se le dan las credenciales con `GIT_ASKPASS` (un script que lee el token de la variable de entorno del proceso; no está escrito en el archivo) y solo para el servidor de GitHub por https.

## Con el asistente

El chat tiene herramientas de git y de GitHub (las mismas por el registro del núcleo en modo API y por el servidor MCP en suscripción y terminales ✦). El contexto de cada mensaje incluye el estado de git del proyecto.

- **Consultar**: `git_estado`, `git_diff`, `git_historial`, `git_ramas`, `github_estado`, `github_listar_prs`, `github_listar_issues`, `github_estado_ci`. Siempre permitidas.
- **Cambiar** (desde «Aceptar ediciones»): `git_preparar`, `git_commit`, `git_crear_rama`, `git_cambiar_rama`.
- **Salen de la máquina** (solo en modo «Autónomo» en suscripción; en modo API siempre piden confirmación explícita y nunca se recuerdan): `git_enviar`, `git_traer`, `github_crear_pr`, `github_crear_repo`, `github_crear_issue`, `github_comentar`.
- **Nunca**: descartar cambios, borrar ramas, reset, push forzado, fusionar pull requests. Eso es tuyo, en la pantalla.
- **Secretos**: la IA se niega a preparar o confirmar archivos que parecen secretos (`.env`, claves, credenciales…).
- **Comandos**: `/commit` (revisa el diff, propone el mensaje y espera tu visto bueno) y `/pr` (redacta título y descripción y espera tu visto bueno antes de abrirlo).

## Cómo está hecho

- `src/shared/versiones.ts`: tipos, un solo contrato tipado (`OperacionesGit`) y lógica pura (siguiente versión, validación de rutas y nombres, análisis del diff).
- Fusión asistida: `src/shared/fusion.ts` (fusión a tres bandas pura sobre `cambiosDeLineas` de `diff.ts`: trozos común / auto / conflicto y decisiones), operaciones `fusionPrevia`, `fusionArchivo` y `fusionAplicar` de `Repositorio`, y `components/VersionesFusion.tsx` + `EditorFusion.tsx`. Tests: `tests/fusion.test.ts` (con git real).
- `src/main/core/git/`: `git.ts` (ejecución sin shell, sin pedir credenciales, mensajes en inglés para analizarlos), `analisis.ts` (salida de `status --porcelain=v2`, `log`, `for-each-ref`… y traducción de los errores habituales a mensajes que dicen qué hacer), `repositorio.ts` (las operaciones) y `operaciones.ts` (despachador).
- Un solo canal IPC, `git:operar`. El renderer manda el **id del proyecto**, nunca rutas de repositorio: main resuelve la carpeta desde `proyectos.json`, así que no se opera fuera de los proyectos registrados.
- Seguridad: git se ejecuta con `execFile` (sin shell); las rutas del usuario van siempre tras `--`, con `GIT_LITERAL_PATHSPECS` (sin comodines ni «magia») y se validan (sin `..`, rutas absolutas ni guiones iniciales); los nombres de rama, etiqueta y remoto se validan, y las URL de los remotos se muestran sin credenciales. No hay `push --force` ni `reset --hard`.
- Las escrituras de un mismo repositorio van en cola (evita `index.lock`); las lecturas usan `GIT_OPTIONAL_LOCKS=0`. Las rutas del estado son relativas a la raíz del repositorio, así que un proyecto que sea una subcarpeta de otro repositorio funciona igual.
- Los errores de autenticación se explican: la aplicación no puede pedir contraseñas, hay que usar una clave SSH (con ssh-agent) o un credential helper de git.

## Fuera de alcance (a propósito)

Reescribir historia (reset, rebase interactivo, push forzado), submódulos, firmar commits, y GitHub Enterprise con SSO (se admite otro servidor con `ODESK_GITHUB_HOST` y `ODESK_GITHUB_API`, sin probar).
