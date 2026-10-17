# Fase 5 — Observabilidad, tracing y evals

## Tracing (`src/main/core/tracing/`)

Cada ejecución (`chat`, `flujo`, `grupo` o `eval`) genera una **traza** = árbol de spans con tiempos, entrada/salida y tokens:

```
agente asistente           (entrada: prompt, salida: respuesta, tokens, pasos, modelo)
├─ llm claude-sonnet-5-5   (último mensaje enviado, texto devuelto, tokens, parada)
├─ herramienta delegar
│  └─ agente investigador
│     ├─ llm …
│     └─ herramienta leer_archivo
├─ herramienta leer_archivo
├─ evento guardrail        (motivo del bloqueo)
└─ llm …
```

- **Cómo se construye**: `Trazador` usa `AsyncLocalStorage` para saber cuál es el span padre, así que las herramientas en paralelo, los subagentes,
  las consultas A2A y los resúmenes de contexto quedan anidados sin cambiar firmas. El `Harness` abre un span por agente y por herramienta
  (incluye la espera de la confirmación humana) y `LlmTrazado` (decorador de `ProveedorLLM`) uno por llamada al modelo.
- **Eventos puntuales** (`ruta`, `flujo_nodo`, `solicitud_humana`, `guardrail`, `worktree`, `contexto`, `a2a`, `flujo_fin`) se registran como spans de tipo `evento`.
- **Estado final**: el de `flujo_fin` si lo hay; si no, el del agente raíz. Tokens totales = suma de las llamadas al modelo (subagentes y resúmenes incluidos).
- **Almacenamiento**: `~/.odesk-agent/trazas/<ejecucionId>.json` (0600), las últimas 200. Máximo 2000 spans por traza (`truncada: true` si se excede) y
  4000 caracteres por texto.
- **Privacidad**: las credenciales se **redactan** (`[REDACTADO:tipo]`) antes de guardar prompts, resultados de herramientas y atributos.
- Sin `trazador` el Harness no mide nada (coste cero).

IPC: `trazasListar(limite?)` (resúmenes con nº de llamadas al modelo, herramientas, errores y tokens), `trazaObtener(id)`, `trazaEliminar(id)`.

## Evals (`src/main/core/evals/`)

Verifican con ejecuciones reales si lo que generan los agentes cumple la especificación y pasa las pruebas.

- **Caso** (`CasoEval`): proyecto inicial (`archivos`, normalmente con las pruebas que *son* la especificación), `prompt` y `aserciones`.
  Se ejecuta en un directorio temporal con el mismo Harness que producción (guardrails activos, trazado) y se borra al terminar.
- **Aserciones**: `archivo_existe`, `archivo_contiene` / `archivo_no_contiene` (texto o regex), `comando_pasa` (p. ej. `node --test`),
  `respuesta_contiene`, `herramienta_usada` / `herramienta_no_usada`, `sin_secretos`, `guardrail_activado`, `max_pasos`, `max_tokens`
  y `juez_llm` (un modelo evalúa un criterio en lenguaje natural; un veredicto ilegible cuenta como fallo).
  Además, todo caso exige `agente_completa` (el agente debe terminar en `completado`).
- **Suite** (`SuiteEval`): lista de casos y un `umbral` de tasa de éxito (por defecto 0,8). Los casos se ejecutan de uno en uno.
  Suite incluida, `basica`: implementar contra pruebas, corregir un bug sin tocar el test, investigar sin modificar y negarse a escribir una credencial.
- **Informe** (`InformeEval`): tasa, tokens, duración y, por caso, cada aserción con su detalle y el id de su traza. Se guardan en
  `~/.odesk-agent/evals/`, y `compararInformes` detecta **regresiones**, mejoras y casos nuevos frente a la ejecución anterior.
  Las ejecuciones parciales (`casos` filtrados) no se guardan para no falsear la comparación.
- **Seguridad del sandbox**: en un eval el agente puede escribir en el proyecto temporal y ejecutar solo los binarios de `comandosPermitidos`
  (por defecto `node`), nunca algo destructivo. **No es una frontera de seguridad** (`node -e` puede hacer cualquier cosa): ejecuta solo suites de confianza.
  Requiere `node` en el PATH.

### Cómo ejecutarlos

- `pnpm evals` — contra la API real (necesita `ANTHROPIC_API_KEY`; consume tokens; sin clave se omite). `EVAL_MODELO` cambia el modelo. Imprime cada caso, los fallos y la comparación con el informe anterior; falla si no se supera el umbral.
- IPC: `evalsSuites()`, `evalsEjecutar(suiteId, casos?)` → `{ informe, comparacion? }`, `evalsInformes(suiteId)`.
- Los tests de `tests/evals.test.ts` verifican el **motor** con un modelo simulado (pruebas reales de `node --test`), no la calidad del modelo.

## Límites conocidos

- Trazas y evals se ven en las pestañas «Trazas» y «Evals» del Asistente (`docs/interfaz.md`); no hay exportación.
- No se estima coste en dinero: solo tokens.
- Los casos se ejecutan en modo chat; no existe aún un caso que recorra el flujo completo con aprobaciones.
- La suite `basica` es pequeña: sirve como detector de regresiones, no como medida de calidad general. Amplíala con casos de tus proyectos.
- Las aserciones `juez_llm` dependen del modelo juez y pueden variar entre ejecuciones.
