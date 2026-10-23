# Comandos de arranque

Cada proyecto puede tener **varios comandos de arranque** (base de datos, API, frontend, workers…) que se lanzan **en orden, uno por uno**, cada uno en su propia terminal, esperando a que esté listo antes de pasar al siguiente. **Se guardan en la base de datos de la cuenta** (API: `terminal-desk-api/src/arranque/`, migración `0011_arranque_en_la_nube`): los ven todos los equipos. Se abren desde el rayo ⚡ de la fila del proyecto en la barra lateral.

## Archivos

| Archivo | Qué hay |
|---|---|
| `src/shared/arranque.ts` | Parte pura: tipos, validación, duplicados, orden, `clasificarPuerto`, operaciones IPC (`OperacionesArranque`) |
| `src/main/arranque/almacen.ts` | Interfaz `StoreArranque` (dónde viven los comandos) y `MemoriaArranque` (referencia y pruebas) |
| `src/main/arranque/nube.ts` | `ArranqueNube`: el store real, contra `/arranque` del API (tabla `project_start_commands`), con caché de 2 s, espejo local para leer sin conexión y subida única de los JSON locales de la versión anterior |
| `src/main/arranque/servicio.ts` | `ServicioArranque`: tanda secuencial, espera de «listo», revisión de puertos, detener, vigilancia |
| `src/main/arranque/operaciones.ts` | Despacho del canal `arranque:operar` (valida lo que llega del renderer) |
| `src/main/puertos.ts` | `duenoDePuerto` (`ss` / `lsof` / `netstat`, padres con `ps`, carpeta con `/proc` o `lsof`), `cerrarProceso` |
| `src/renderer/components/ArranqueProyecto.tsx` | Ventana de edición y control |
| `scripts/e2e/arranque.mjs` | Prueba con Electron real: `pnpm build && pnpm e2e:arranque` con un API mínimo en memoria, o `API_REAL=1 pnpm e2e:arranque` con el API y Postgres de verdad (base `desk_e2e_arranque` desechable; comprueba también lo guardado en la base). `CAPTURA=/ruta.png` guarda una foto del modal |

## Reglas

- **Sin repetidos en un proyecto**: mismo comando (sin importar espacios ni mayúsculas) **en la misma carpeta**, mismo nombre o mismo puerto. El mismo comando en otra carpeta (monorepo: `pnpm dev` en `api/` y en `web/`) es válido.
- Un comando por entrada: nada de saltos de línea ni caracteres de control (escritos en la terminal serían teclas). La carpeta es relativa y no puede salir del proyecto (`..`).
- **Cuándo está «listo»** (`esperar`): `puerto` (se abre), `texto` (aparece en la salida; el texto no puede estar en el propio comando, porque la terminal lo repite), `tiempo` (pausa fija) o `nada`. En `puerto`/`texto`, `esperaMs` es el máximo antes de dar error. Si el comando termina antes (el shell vuelve a esperar órdenes, solo Linux/macOS) es error, salvo en `tiempo`.
- Si un comando falla la tanda se corta y los demás quedan «omitidos»; «Seguir aunque uno falle» las sigue.
- Los comandos se **escriben en el shell interactivo** (hereda PATH/nvm, como los proveedores de IA). Main crea la pty y avisa por `arranque:terminal`; la interfaz la adjunta con `ptyExistente` en la sección **«Servicios»** de la barra lateral (`components/Servicios.tsx`: chips con el estado de cada uno, «Detener todo», rejilla o pestañas), **no** en la rejilla de terminales del proyecto. `TerminalInfo.arranque` marca esas celdas; la sección está siempre montada (oculta) para no matar los procesos, y su insignia cuenta los abiertos. Al lanzar desde la ventana del ⚡ se salta a «Servicios» (`onVer`); el arranque automático no mueve al usuario. Detener mata la pty y la celda se quita (`arranque:estado` con `ptyId`); si el comando termina solo, la celda se queda con su salida.

## Puertos

Antes de lanzar un comando con puerto se mira si ya está ocupado y **quién** lo ocupa (`clasificarPuerto`): primero por el árbol de procesos (si cuelga de una terminal que abrió el arranque), luego por la carpeta de trabajo del proceso frente a las de los proyectos (gana la más específica).

| Tipo | Qué pasa |
|---|---|
| `en-marcha` / `mismo-proyecto` | Se da por ya en marcha (`omitido`) y la tanda sigue |
| `otro-proyecto` / `ajeno` | **No se pisa**: error, o el usuario elige *omitir* o *liberar* (cerrar ese proceso; se vuelve a comprobar que sigue siendo el que escucha y se espera a que el puerto quede libre) |
| `configurado-en-otro` | Aviso: está libre pero otro proyecto lo tiene en sus comandos (también al guardar) |

`revisar` no cambia nada; `arrancar` acepta `resoluciones` por comando (solo `omitir` o `liberar`). **Autoarrancar nunca cierra procesos.** Windows: solo se sabe el pid (no el padre ni la carpeta), así que lo no propio sale como `ajeno`.

## «Arrancar siempre»

El campo `siempre` de un comando lo lanza solo al **abrir el proyecto** en la barra lateral (clic que crea su terminal, o su grupo): `autoarrancar` ignora los que ya corren, así que volver a abrirlo no duplica nada. Un comando detenido a mano se vuelve a lanzar la próxima vez que se abre el proyecto.

## En la base de datos (API)

Tabla `project_start_commands` (`id`, `user_id`, `project_id` → `projects` con borrado en cascada, `name`, `command`, `cwd`, `port`, `position`, `wait_for`, `ready_text`, `wait_ms`, `always`). Índices únicos por proyecto: nombre (sin mayúsculas), comando+carpeta (sin mayúsculas) y puerto; por eso dos equipos guardando lo mismo a la vez dan un 409 y nunca duplicados. Endpoints (JWT, solo los de la cuenta):

| Ruta | Qué hace |
|---|---|
| `GET /arranque[?projectId=]` | Todos los de la cuenta (o de un proyecto), en orden de arranque |
| `PUT /arranque` | Crea (sin `id`) o edita (con `id`); valida igual que el escritorio y responde 409 si repite |
| `PUT /arranque/orden` | `{projectId, ids}`: el orden de arranque (los ids que falten van detrás) |
| `DELETE /arranque/:id` | Elimina |

Las reglas de `shared/arranque.ts` (escritorio) y `arranque.service.ts` (API) son las mismas: si cambias unas, cambia las otras. El escritorio valida primero (mensaje al instante) y el servidor vuelve a validar.

**Sin conexión**: cada lectura correcta se copia a `~/.odesk-agent/arranque/espejo.json` (0600). Si el servidor no responde, se lee de ahí y se puede arrancar el entorno (docker y servidores locales no necesitan Internet); editar, reordenar y eliminar piden conexión. **Migración**: los `<proyecto>.json` de la primera versión (solo locales) se suben una vez al abrir y se renombran a `.migrado`.

**Al desplegar**: aplicar la migración del API (`pnpm migration:ejecutar`) y reiniciarlo antes de usar la versión nueva del escritorio; contra un API sin esa ruta, el rayo ⚡ da error al abrir.
