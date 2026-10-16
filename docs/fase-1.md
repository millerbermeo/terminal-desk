# Fase 1 — Arquitectura base de agentes y MCP

Núcleo propio de agentes que llama a la API de Anthropic directamente (no envuelve ningún CLI). Corre en el proceso **main**; el renderer lo usa por IPC (`window.api.core`).

## Estructura

```
src/shared/core/        tipos compartidos (Mensaje, EventoAgente, HerramientaDef…)
src/main/core/
  agents/
    agente.ts           Agente: definición declarativa (sistema, herramientas permitidas, subagentes)
    bucle.ts            ejecutarBucle: modelo -> herramientas -> modelo (maxPasos, cancelación, tokens)
    harness.ts          Harness: ensambla agente + LLM + registro + política + eventos
    subagentes.ts       herramienta `delegar` (hijo con contexto limpio; al padre solo vuelve su respuesta)
    llm/                ProveedorLLM (interfaz) + ProveedorAnthropic
  tools/
    registro.ts         RegistroHerramientas: registrar / validar entrada / llamar (nunca lanza)
    integradas/         leer_archivo, listar_directorio, escribir_archivo, ejecutar_comando
  mcp/
    config.ts           ~/.centro-proyectos/mcp.json (0600), validado con zod
    cliente.ts          ClienteMcp (stdio)
    orquestador.ts      conecta servidores y registra sus tools como mcp__<servidor>__<tool>
  agentes-base.ts       agente raíz «asistente» y subagente «investigador»
  index.ts              Nucleo (fachada) + registrarIpcCore
```

## Política de seguridad (hasta la Fase 4)

Cada herramienta declara un `riesgo` (`lectura` | `escritura` | `ejecucion`; `clasificar()` lo afina por entrada).
El Harness solo ejecuta `lectura` por sí mismo; el resto exige un `Aprobador`. **Sin aprobador se deniega.** Desde la Fase 4 `Nucleo`
usa la confirmación humana y guardrails previos (ver `docs/fase-4.md`). Las herramientas de archivo están confinadas al proyecto
(`..`, rutas absolutas y enlaces simbólicos que escapan se rechazan); `ejecutar_comando` no usa shell.
Los servidores MCP tienen riesgo `ejecucion` por defecto (configurable por servidor).

## mcp.json

```json
{
  "servidores": {
    "fs": { "comando": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/ruta"], "riesgo": "escritura" },
    "git": { "comando": "uvx", "args": ["mcp-server-git"], "env": {}, "deshabilitado": false }
  }
}
```

Un servidor que falla al conectar queda en estado `error` sin afectar a los demás. `core:mcp-reiniciar` relee el archivo.

## API IPC (`window.api.core`)

`ejecutar({ prompt, proyectoId?, agenteId? }) -> ejecucionId` · `cancelar(id)` · `mcpEstado()` · `mcpReiniciar()` · `onEvento(cb)`.
Eventos: `inicio`, `paso`, `texto`, `herramienta_inicio`, `herramienta_fin`, `fin` (con `agente` y `profundidad` del emisor).

## Límites conocidos de la Fase 1

- El streaming de texto llega con el evento `texto_delta` (el evento `texto` trae el texto completo al terminar el paso). La interfaz está descrita en `docs/interfaz.md`.
- Sin memoria ni gestión de contexto (Fase 2).
