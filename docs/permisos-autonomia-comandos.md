# Permisos, autonomía y comandos `/`

## Permisos persistentes

Reglas por proyecto (y globales) en `~/.centro-proyectos/permisos/<proyecto|global>.json` (0600). Se gestionan en la pestaña **Permisos**
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
