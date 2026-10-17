# Fase 2 — Gestión de contexto y memoria

## Estructura

```
src/shared/core/memoria.ts       EntradaMemoria (regla | decision | hecho)
src/main/core/
  context/
    tokens.ts                    estimarTokens (~3,5 caracteres/token; sin tokenizador local)
    monitor.ts                   MonitorContexto: tokens de sistema + herramientas + mensajes vs. ventana útil
    compresion.ts                CompresorContexto: poda -> resumen
  memory/
    almacen.ts                   AlmacenJson: un JSON por id, escritura atómica y serializada; valida ids (sin path traversal)
    sesion.ts                    MemoriaCortoPlazo (conversaciones)
    largo-plazo.ts               MemoriaLargoPlazo (reglas, decisiones, hechos) + contextoPara()
    busqueda.ts                  BM25 léxico (sin embeddings, offline)
    herramientas.ts              buscar_memoria (lectura) y guardar_memoria (escritura -> requiere aprobación)
```

## Context Window Monitor y compresión

Antes de **cada** llamada al modelo (también en subagentes) el bucle invoca `preparar`:

1. Si ocupa menos del umbral (70 % de la ventana útil) no se toca nada.
2. **Poda**: los resultados de herramienta antiguos y largos (> 500 caracteres, fuera de los 6 mensajes finales) se
   sustituyen por `[resultado antiguo omitido: N caracteres]`. Sin coste de modelo.
3. Si sigue sobre el umbral: **resumen** de lo antiguo con un modelo barato (`claude-haiku-5-5`). El resumen se fusiona con el primer
   mensaje conservado, que siempre es de usuario y nunca un resultado de herramienta, así no se rompe ningún par
   `tool_use`/`tool_result` y los roles siguen alternando.
4. Si el resumen falla, se continúa con la poda. La conversación comprimida sustituye a la original (también en la sesión guardada).

Cada compresión emite el evento `contexto { estrategia, tokensAntes, tokensDespues }`.
Los tokens son una **estimación**; el uso real que devuelve la API se acumula en `ResultadoAgente.uso`.

## Memoria de dos niveles

- **Corto plazo** (`~/.odesk-agent/conversaciones/<sesionId>.json`): `SolicitudAgente.sesionId` continúa una conversación;
  `ejecutar` devuelve `{ ejecucionId, sesionId }`. No se guarda un `tool_use` sin su resultado. `sesionBorrar` la olvida.
- **Largo plazo** (`~/.odesk-agent/memoria/<proyectoId>.json`, más `global.json`): fuera del repo del proyecto.
  Al ejecutar, `contextoPara` añade al prompt del agente raíz todas las reglas (hasta la mitad de 1500 tokens)
  y las decisiones/hechos más relevantes para el prompt (BM25). La búsqueda tiene una interfaz simple (`buscar`) para sustituirla por una vectorial.
- El usuario gestiona la memoria por IPC (`memoriaListar/Guardar/Eliminar`). El agente puede guardar con `guardar_memoria`,
  pero como se inyecta en futuros prompts cuenta como escritura: se deniega sin aprobador (Fase 4).

## Límites conocidos

- Estimación de tokens aproximada (sin `count_tokens` de la API).
- Búsqueda solo léxica; la UI de memoria está en la pestaña «Memoria» del Asistente, pero no hay indicador del uso del contexto.
- Límites: 500 entradas por proyecto, 4000 caracteres por entrada.
