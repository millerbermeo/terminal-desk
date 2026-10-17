# Control de versiones (git)

Pantalla **Versiones** (barra lateral): gestiona con git la versión de cada proyecto sin salir de la aplicación.

## Qué se puede hacer

- **Cambios**: archivos conflictivos, preparados, modificados y nuevos; preparar o quitar archivos (uno o todos), descartar cambios (con confirmación), ver el diff con números de línea y confirmar con un mensaje (Ctrl+Enter). «Enmendar último» cambia el último commit.
- **Historial**: commits con sus ramas y etiquetas, paginado, filtrable por rama y texto. El detalle muestra autor, fecha, hash, padres y los archivos con sus diferencias. Desde ahí: crear una rama o una versión en ese commit y revertirlo (commit inverso, sin reescribir historia).
- **Ramas**: crear, cambiar, fusionar en la actual y eliminar (si tiene commits sin fusionar pide confirmar el borrado forzado). Ramas remotas (crear la local que las sigue) y remotos (agregar uno).
- **Versiones**: etiquetas anotadas de git. Sugiere la siguiente versión semántica (parche, menor, mayor) a partir de las existentes, indica cuántos commits hay desde la última y permite enviarlas al remoto.
- **Stash**: apartar los cambios sin confirmar (con o sin archivos nuevos), recuperarlos o aplicarlos y eliminarlos.
- **Sincronizar**: Obtener (fetch), Traer (pull sin mezclar; con rebase si la rama divergió) y Enviar/Publicar rama. Los conflictos de fusión, revert, pull o stash se resuelven en «Cambios» y se confirman, o se aborta la operación.
- **Primeros pasos**: inicializar el repositorio de un proyecto y configurar tu nombre y correo (global o del proyecto) cuando falta.

## Cómo está hecho

- `src/shared/versiones.ts`: tipos, un solo contrato tipado (`OperacionesGit`) y lógica pura (siguiente versión, validación de rutas y nombres, análisis del diff).
- `src/main/core/git/`: `git.ts` (ejecución sin shell, sin pedir credenciales, mensajes en inglés para analizarlos), `analisis.ts` (salida de `status --porcelain=v2`, `log`, `for-each-ref`… y traducción de los errores habituales a mensajes que dicen qué hacer), `repositorio.ts` (las operaciones) y `operaciones.ts` (despachador).
- Un solo canal IPC, `git:operar`. El renderer manda el **id del proyecto**, nunca rutas de repositorio: main resuelve la carpeta desde `proyectos.json`, así que no se opera fuera de los proyectos registrados.
- Seguridad: git se ejecuta con `execFile` (sin shell); las rutas del usuario van siempre tras `--`, con `GIT_LITERAL_PATHSPECS` (sin comodines ni «magia») y se validan (sin `..`, rutas absolutas ni guiones iniciales); los nombres de rama, etiqueta y remoto se validan, y las URL de los remotos se muestran sin credenciales. No hay `push --force` ni `reset --hard`.
- Las escrituras de un mismo repositorio van en cola (evita `index.lock`); las lecturas usan `GIT_OPTIONAL_LOCKS=0`. Las rutas del estado son relativas a la raíz del repositorio, así que un proyecto que sea una subcarpeta de otro repositorio funciona igual.
- Los errores de autenticación se explican: la aplicación no puede pedir contraseñas, hay que usar una clave SSH (con ssh-agent) o un credential helper de git.

## Fuera de alcance (a propósito)

Reescribir historia (reset, rebase interactivo, push forzado), resolver conflictos línea a línea en la interfaz (se abre el archivo en el editor), submódulos, clonar repositorios y firmar commits.
