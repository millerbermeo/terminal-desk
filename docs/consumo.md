# Control del consumo de tokens (Asistente por suscripción y terminales ✦)

## Qué pasaba
El CLI `claude` reenvía **todo el contexto en cada llamada** (a precio de caché, pero se acumula). Una conversación larga de pruebas en el
teléfono llegó a 350 k tokens por llamada, 378 llamadas y 87 M de tokens en 48 min, porque:

1. Los modelos de 1 M de ventana solo compactan solos al 95 % de 1 M (casi nunca).
2. Cada captura de pantalla leída con `Read` (147 en esa sesión, 79 MB en base64) se queda en el contexto y se reenvía siempre.
3. La app reanudaba la misma sesión del CLI sin límite.
4. El medidor sumaba mal: `modelUsage` del CLI **es acumulado de la sesión reanudada**, así que cada turno volvía a contar todo lo anterior
   (`uso.json` marcó 101 M y 29 USD cuando lo real era ~15 M). Las trazas de suscripción quedaban siempre en `error` y con 0 tokens
   (sin spans de agente/llm la traza no sabía cómo terminó ni cuánto gastó).

## Qué hace ahora
| Técnica | Dónde | Efecto |
|---|---|---|
| Autocompactación temprana del CLI (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=70`) | `AJUSTES_CONSUMO` en `suscripcion.ts` (Asistente y terminales ✦ en Linux/macOS) | El CLI compacta solo a ~140 k. Verificado: dispara en `-p`. |
| Salidas acotadas (`BASH_MAX_OUTPUT_LENGTH=20000`, `MAX_MCP_OUTPUT_TOKENS=12000`) | idem | Un comando/MCP gigante no inunda el contexto. |
| Rotación de sesión con resumen | `consumo.ts#decidirRotacion`, `rotacion.ts`, `Nucleo.ejecutarPorSuscripcion` | Respaldo si el CLI no compacta: contexto ≥ 170 k, ≥ 10 imágenes o > 55 min inactiva con ≥ 90 k (la caché de 1 h caducó y reanudar cuesta el contexto entero) → resumen con Haiku (~0,001 USD) a partir de la transcripción guardada y sesión nueva. El usuario ve una nota; su mensaje no cambia. Si el resumen falla se usa la cola del digest; sin transcripción no se rota. |
| Guardia de imágenes (plugin `odesk-guardia`) | `main/guardia.ts` | Gancho `PreToolUse` sobre `Read`: reduce capturas grandes a 1280 px (ImageMagick, ffmpeg, sips o Python+Pillow) y limita a 25 por sesión explicando cómo seguir con texto. |
| Medición exacta | `consumo.ts#diferenciaUso`, `sesiones-cli-meta.json` | Se anota solo la diferencia con el acumulado anterior del CLI. |
| Trazas y conversaciones con tokens | `Trazador.anotarUso`, `MemoriaCortoPlazo.anotarUso`, `finalizar(id, estado)` | Ya no quedan en `error` con 0. |
| Tope por ejecución | `--max-budget-usd` (5 USD; Haiku lateral y resúmenes 1) | Corta bucles descontrolados. |
| Prefijo de caché estable | `--exclude-dynamic-system-prompt-sections` | Mejor reutilización de la caché. |
| Avisos | eventos `aviso_consumo` (contexto ≥ 110 k o ejecución ≥ 1,5 USD) y `contexto_compactado` | Se ve en el chat. |

## Ajustes por entorno
`ODESK_ROTAR_CONTEXTO` (170000), `ODESK_ROTAR_IMAGENES` (10), `ODESK_ROTAR_INACTIVIDAD_MIN` (55), `ODESK_ROTAR_INACTIVO_CONTEXTO` (90000)
— un 0 desactiva ese criterio —, `ODESK_PRESUPUESTO_TURNO_USD` (5, 0 = sin tope), `ODESK_MAX_IMAGENES` (25), `ODESK_IMAGEN_LADO` (1280),
`ODESK_SIN_GUARDIA=1` (apaga el plugin). Las variables del CLI de `AJUSTES_CONSUMO` solo se fijan si el usuario no las definió.

## Cómo auditar
`~/.odesk-agent/uso/uso.json` (por día y modelo, ya con diferencias), `sesiones-cli-meta.json` (contexto, imágenes y rotaciones por
conversación) y las trazas. El gasto real por sesión del CLI está en `~/.claude/projects/*/<sesión>.jsonl` (`message.usage`).

## Segunda fase: lo que hace la extensión de Claude Code para VS Code

Se revisó la extensión (v2.1.304) y se probó contra el CLI real. Usa el SDK de agentes: **un proceso `claude` largo por conversación**
(entrada y salida stream-json) y peticiones de control sobre él. Odesk ahora hace lo mismo (`core/proceso-cli.ts`).

| Mejora | Dónde | Medido con el CLI real |
|---|---|---|
| **Proceso persistente por conversación** (`ProcesosCli`: máx. 4 vivos, se cierra a los 20 min sin uso, se relanza solo y reanuda si murió) | `proceso-cli.ts`, `Nucleo.correrCli` | Sin re-arranque por mensaje; un turno corto tarda ~4 s. `ODESK_PROCESO_POR_TURNO=1` vuelve a un proceso por mensaje. |
| **Cancelar = `interrupt`**, no matar | `ProcesoCli.ejecutar` | El proceso sigue vivo y atiende el siguiente mensaje; si no obedece en 4 s se mata. |
| **Herramientas recortadas** (`--tools`) | `herramientasCli` | Contexto base **24,7 k → 11,4 k** tokens (7,5 k sin `Agent`/`Skill`/web; `Agent` y `Skill` solo con agentes/skills activos). `ODESK_HERRAMIENTAS=todas` o una lista. |
| **Contexto estable en el prompt de sistema, lo variable delante del mensaje y solo si cambió** | `Nucleo.contextoPartes`, `MetaSesionCli.hashDinamico` | Un cambio en el prompt de sistema invalida la caché de TODA la conversación; antes cambiaba con el estado de git y la memoria. |
| **«Preguntar ahora» con `side_question`** | `Nucleo.preguntarLateral` | Responde en ~1,6 s con el contexto real y sin tocar la tarea. Si el contexto pasa de 80 k tokens (`ODESK_LATERAL_MAX_CONTEXTO`) se usa Haiku con la bitácora, que sale más barato. |
| **Uso real del contexto** (`get_context_usage`) | `Nucleo.contextoUso`, `BarraUso` | Desglose por categoría (sistema, herramientas, mensajes, margen de compactación) y la ventana efectiva (200 k con la compactación temprana). |
| **Deshacer cambios de archivos** (`rewind_files` + puntos de control) | `rebobinarArchivos`, botón «↩ Deshacer cambios» | Restaura lo editado con Edit/Write y borra lo creado después; con proceso vivo o reanudando la sesión. No cubre `Bash`. Al siguiente mensaje se avisa al modelo. |
| **Título de la conversación con el modelo barato** | `Nucleo.titular`, `fijarTituloAuto` | ~0,001 USD; respeta un título puesto a mano. `ODESK_SIN_TITULO=1` lo apaga. |
| **Esfuerzo de razonamiento** (`--effort`) | selector «Esfuerzo» del chat, `AjustesAsistente.esfuerzo` | Menos esfuerzo = menos tokens de pensamiento. Viaja con la cuenta. |
| **Tope de pasos por respuesta** (`ODESK_MAX_PASOS`, 200) | `LectorTurno` | Corta bucles descontrolados (en el proceso persistente el tope de gasto del CLI no tiene alcance claro, por eso no se usa). |

Notas de implementación:
- Un cambio en lo que fija el proceso (modelo, autonomía, plugins, MCP, carpetas, cuenta) lanza otro y reanuda la sesión (`firmaProceso`).
- `--max-budget-usd` es **por invocación** (verificado): solo se usa en el modo un-proceso-por-mensaje.
- `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true` se activa en todas las ejecuciones del Asistente para poder rebobinar.
- Las pruebas con un `claude` falso de un solo mensaje fijan `ODESK_PROCESO_POR_TURNO=1`; el modo persistente se prueba en `tests/proceso-persistente.test.ts` con uno multi-turno.
