# Fase 4 — Seguridad, aislamiento y control

## Estructura

```
src/main/core/
  git/
    git.ts                 git(): execFile sin shell, GIT_TERMINAL_PROMPT=0, nunca lanza
    worktree.ts            GestorWorktrees: crear / cambios / confirmar / publicar / descartar / listar
  guardrails/
    secretos.ts            detectarSecretos (AWS, GitHub, Anthropic/OpenAI, Slack, Google, Stripe, JWT, claves privadas, URLs con credenciales…)
    rutas.ts               rutaSensible (.env, *.pem, id_rsa, .npmrc, .ssh/…) y rutaProtegidaEscritura (.git, node_modules)
    destructivo.ts         esDestructiva: rm, mv, sudo, curl, git push/reset --hard/clean/rebase/branch -D…, publish, MCP delete/drop…
    motor.ts               MotorGuardrails.validarLlamada (se conecta al Harness)
  hitl/aprobador.ts        crearAprobadorHumano: confirmación del usuario para escrituras y ejecuciones
  orchestrator/verificaciones.ts   typecheck / lint / test del propio proyecto (scripts de package.json)
```

## Git worktrees

Los flujos (`modo: 'flujo'`) se ejecutan **por defecto** (`aislado !== false`) en un worktree propio:
`~/.centro-proyectos/worktrees/<proyectoId>/<id>` con la rama `agente/<resumen>-<id>`, creado desde `HEAD`. Vive fuera del repo, así que el
agente no toca el árbol de trabajo del usuario. Se enlaza `node_modules` del repo para poder ejecutar las verificaciones (se excluye al confirmar).

Ciclo de vida (eventos `worktree`):

| Fin del flujo | Qué pasa con el worktree |
|---|---|
| `completado` | Se revisa el diff completo (incluidos archivos nuevos) en busca de credenciales. Limpio: **commit en la rama del worktree** (`confirmado`). Con credenciales: no se confirma, `fallido`, `conservado`. |
| `fallido` | `conservado` para inspeccionar. |
| `rechazado` / `cancelado` | `descartado` (se elimina worktree y rama). |

La rama **no se integra ni se sube sola**: el usuario la revisa y la fusiona. Si el proyecto no es un repo git con commits, `ejecutar` falla con un mensaje
claro (usa `aislado: false` para trabajar en el directorio del proyecto, con confirmación humana igualmente).

IPC: `worktreesListar(proyectoId)`, `worktreeDescartar(proyectoId, id)` (la UI debe confirmar: se pierde lo no integrado) y
`worktreePublicar(proyectoId, id)` (`git push -u origin <rama>`, pide confirmación humana marcada como destructiva).

## Guardrails

Se evalúan en el Harness **antes del aprobador y para toda llamada, también de lectura**: lo bloqueado no se le ofrece al usuario. El modelo recibe
«Bloqueado por guardrails: …» y se emite el evento `guardrail`. Nunca se devuelve el secreto completo (extracto redactado).

- `leer_archivo`: no se leen `.env`, claves, `.npmrc`… (su contenido iría a la API del modelo). Las plantillas `.env.example` sí.
- `escribir_archivo`: bloquea rutas sensibles/protegidas, credenciales en el contenido y JSON inválido (excepto `tsconfig*`/`jsconfig*`).
- `ejecutar_comando`: bloquea comandos con argumentos que apuntan a archivos sensibles (`cat .env`).
- `guardar_memoria` y herramientas MCP: no reciben credenciales.
- Al confirmar un flujo se escanea el diff completo (defensa en profundidad para lo que no pasó por `escribir_archivo`).
- **Verificación estática del proyecto**: el nodo `pruebas` del flujo ejecuta, en orden y parando en la primera que falla, los scripts `typecheck`
  (o `type-check`/`check-types`/`tsc`), `lint` y `test` del `package.json`, con el gestor que indique el lockfile. La salida del fallo vuelve al generador (máx. 3 intentos).
  Se listan en la aprobación del plan.

## Human in the loop

`crearAprobadorHumano` pregunta (evento `solicitud_humana`, `clase: 'accion'`, con la acción exacta: comando, ruta + contenido…) antes de cualquier
herramienta que no sea de solo lectura. Responder con `core.responder(solicitudId, { aprobado, recordar? })`.

- `recordar: true` no vuelve a preguntar por esa herramienta durante la ejecución. **Nunca aplica a acciones destructivas** (`destructivo: true`), que se preguntan siempre.
- Cancelar la ejecución mientras se espera deniega la acción.
- En el flujo, aprobar el plan autoriza únicamente `escribir_archivo` del generador (siempre pasando antes por los guardrails); cualquier otra acción del generador pasa por el usuario. El planificador nunca puede escribir.
- Chat normal (`modo` ausente) también pasa por el aprobador humano. Los especialistas A2A siguen siendo de solo lectura (sin aprobador).

## Límites conocidos

- La detección de credenciales es por patrones: puede dar falsos negativos (secretos sin formato conocido) y algún falso positivo.
- La clasificación de acciones destructivas es una lista; `ejecutar_comando` corre sin shell (no hay pipes), pero un script del proyecto (`npm run x`) puede hacer cualquier cosa: por eso exige confirmación.
- Los hooks de git del repo (p. ej. husky) se ejecutan al confirmar.
- La confirmación se responde desde el modal del Asistente (ver `docs/interfaz.md`); sin esa pantalla abierta, el agente espera hasta que se cancele.
