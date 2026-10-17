# Permisos, autonomía y comandos `/`

## Permisos persistentes

Reglas por proyecto (y globales) en `~/.odesk-agent/permisos/<proyecto|global>.json` (0600). Se gestionan en la pestaña **Permisos**
del Asistente, y desde el modal de confirmación con **«Permitir siempre en este proyecto»**, que guarda la regla exacta.

| Campo | Valores |
|---|---|
| `tipo` | `comando` (línea de comando) o `herramienta` (nombre, admite `*` final: `mcp__db__*`) |
| `accion` | `permitir` (no pregunta) o `denegar` (el agente no puede hacerlo) |
| `patron` | `pnpm test` (exacto) · `git commit *` (cualquier argumento detrás; el `*` solo va al final) |

Reglas de seguridad:

- **`denegar` gana siempre** y se evalúa antes del aprobador (junto a los guardrails): lo denegado ni se pregunta.
- **Lo destructivo nunca se permite por regla** (`rm`, `git push`, `reset --hard`, `clean`, `sudo`, `curl`, publicar…): siempre pide confirmación.
  Tampoco se ofrece «Permitir siempre» en esas acciones. `git -c …` cuenta como destructivo (permite ejecutar programas).
- **Intérpretes con comodín no se permiten** (`node *`, `bash *`, `python *`, `npx *`, `env *`, `docker *`…): equivaldrían a «permitir todo». Sí se admite el
  comando exacto (`node scripts/seed.js`).
- Un binario con ruta (`./git`) no coincide con una regla del comando del PATH (`git`).
- Los guardrails (credenciales, `.env`, `.git`) siguen activos por encima de cualquier regla.

## Modos de autonomía

Desplegable **Preguntar todo | Aceptar ediciones | Autónomo** en la cabecera del chat (se recuerda por proyecto; `SolicitudAgente.autonomia`). Los guardrails y las reglas de
permisos valen en los tres modos, y **lo destructivo siempre pide confirmación**.

| Modo | Escrituras de archivos | Comandos | Plan del Flujo | Presupuesto |
|---|---|---|---|---|
| **Preguntar** (por defecto) | confirma | confirma (salvo reglas) | lo apruebas tú | — |
| **Ediciones** | pasan solas (dentro del proyecto, tras los guardrails) | confirma (salvo reglas) | lo apruebas tú | — |
| **Autónomo** | pasan solas | solo `typecheck`, `lint` y `test` del proyecto (exactos) pasan solos; el resto confirma | se aprueba solo (evento `aprobacion_automatica`) | 300 000 tokens por ejecución, compartidos entre agentes, subagentes y fases |

- Siguen pidiendo confirmación en **todos** los modos: acciones destructivas, comandos que no sean verificaciones ni estén permitidos por regla, herramientas MCP
  y escrituras en la memoria. En el Flujo, la **confirmación final** del resultado también es siempre tuya.
- Al agotarse el presupuesto, el agente se detiene (`limite_pasos` con «Presupuesto de tokens agotado»).
- Activar «Autónomo» pide confirmación. Lo más seguro es usarlo con el Flujo aislado en una rama.
- Cada turno ejecutado con menos confirmaciones lleva una etiqueta (autónomo / acepta ediciones).

## Comandos con `/`

Se escriben en la caja del chat; al teclear `/` aparece el autocompletado (↑↓, Tab o Enter para completar, Esc para cerrarlo).

**Incluidos:** `/flujo <petición>`, `/chat`, `/modo preguntar|ediciones|autonomo`, `/nueva`, `/historial`, `/permisos`, `/comandos`, `/ayuda`.

**Propios** (`/comandos` o la pestaña **Comandos /** del Asistente; por proyecto o globales, el del proyecto manda), guardados en
`~/.odesk-agent/comandos/<proyecto|global>.json` (0600):

| Tipo | Qué hace |
|---|---|
| **prompt** | Plantilla que se envía al agente con el modo actual. `$ARGUMENTOS` se sustituye por lo que se escriba detrás (si no aparece, se añade al final). |
| **ejecutable** | Programa fijo (argv, sin shell; el nombre no puede llevar espacios). No pasa por el modelo: su salida aparece en el chat (`comando_salida`) y se adjunta al siguiente mensaje para que el agente la vea. Admite argumentos tras el nombre si se activa (se dividen por espacios, con comillas, y nunca pasan por una shell). |

Cómo se ejecuta un comando propio (misma tubería que las acciones del agente):

1. **Guardrails y reglas de denegación** primero (`cat .env` o un comando denegado ni se pregunta).
2. **Lo destructivo siempre pregunta**, incluso si el comando está marcado como «permitido» (al guardarlo no se deja marcar como permitido).
3. Un comando «permitido» o con una regla `permitir` se ejecuta sin preguntar; el resto pide confirmación (con «Permitir siempre»).
4. Un intérprete con argumentos libres (`node`, `bash`…) no puede ser «permitido».

Timeout de 10 minutos, salida recortada a 20 000 caracteres; se puede cancelar.

## Límites conocidos

- Los comandos ejecutables y las reglas son por programa y argumentos exactos: no entienden pipes ni redirecciones (no hay shell).
- «Autónomo» solo reconoce como verificaciones los scripts `typecheck`/`type-check`/`check-types`/`tsc`, `lint` y `test` del `package.json`.
- El presupuesto de tokens cuenta las llamadas de los agentes y subagentes, no los resúmenes de contexto ni el modelo juez de los evals.
