# Fase 3 — Orquestación, ruteo y A2A

## Estructura

```
src/main/core/
  orchestrator/
    grafo.ts               GrafoEstados<E>: nodos que devuelven {estado, siguiente}; límite de transiciones, cancelación, contador de intentos
    puerta.ts              PuertaHumana: espera una decisión del usuario (aprobar/rechazar); se rechaza al cancelar
    flujo-desarrollo.ts    planificacion -> aprobacion -> generacion -> pruebas -> confirmacion
    verificaciones.ts      typecheck/lint/test del proyecto (antes pruebas.ts)
  router/router.ts         Router + ClasificadorHeuristico (interfaz Clasificador sustituible)
  a2a/
    bus.ts                 BusA2A: petición/respuesta entre agentes, anti-ciclos, herramienta consultar_agente
    submodulos.ts          un especialista por proyecto del grupo + coordinador
```

## Flujo de desarrollo (`SolicitudAgente.modo = 'flujo'`, requiere `proyectoId`)

```
planificacion -> aprobacion -> generacion -> pruebas -> confirmacion -> FIN
      ^   rechazado (comentario) |      ^      fallan (salida)  |           |
      +----------------------------+      +---------------------+-----------+ rechazado (comentario)
```

- **Planificación**: agente `planificador`, solo lectura. Devuelve el plan.
- **Aprobación**: evento `solicitud_humana` (`clase: 'plan'`); responder con `core.responder(solicitudId, { aprobado, comentario? })`.
  Rechazar vuelve a planificar con el comentario (máx. 3 planes).
- **Generación**: agente `generador`. Con el plan aprobado **solo `escribir_archivo`** queda autorizado (confinado al proyecto);
  cualquier otra acción no de lectura sigue denegada.
- **Pruebas**: ejecuta `typecheck`, `lint` y `test` del `package.json` (ver `docs/fase-4.md`). Los comandos los fija el sistema, no el
  modelo, y se muestran al aprobar el plan. Si falla alguno, la salida vuelve al generador (máx. 3 generaciones).
- **Confirmación**: segunda `solicitud_humana` (`clase: 'confirmacion'`). Rechazar manda de vuelta a generación con el comentario.
  En un worktree (Fase 4) confirma en la rama del worktree; nunca hace push.
- Eventos: `flujo_nodo {nodo, intento}`, `solicitud_humana`, y `flujo_fin {estado: completado|rechazado|fallido|cancelado, resumen}`.
  Cancelar la ejecución rechaza las solicitudes pendientes.

## Router

Sin `modelo` explícito, el chat usa `Router.decidir(prompt)`: `simple -> haiku`, `media -> sonnet`, `compleja -> opus`
(heurística: longitud, alcance, nº de archivos, verbos de modificación, preguntas cortas). Emite el evento `ruta` con
`{complejidad, modelo, razon, sugerirFlujo}`. `sugerirFlujo` es solo una **recomendación** para la UI: el flujo (que escribe archivos)
nunca se activa solo. Flujos y grupos no bajan del modelo intermedio.

## A2A (`SolicitudAgente.grupoId`)

Cada proyecto del grupo (Backend, Frontend, Mobile…) tiene un agente especialista **de solo lectura** registrado en el bus.
Un `coordinador` (sin acceso a archivos) los consulta con `consultar_agente`, en paralelo si son independientes, y sintetiza la respuesta.
Los especialistas también pueden consultarse entre sí. El bus rechaza ciclos (A -> B -> A) y cadenas de más de 3 saltos. Cada consulta
emite `a2a { de, a, fase: envio|respuesta, texto }`, y la actividad interna de cada especialista llega con su nombre en `agente`.

## Cambios en el Harness

`PeticionEjecucion` admite `modelo` (solo agente raíz), `extras` (herramientas solo para esa ejecución, solo agente raíz) y `aprobar`
(sustituye al aprobador solo en esa ejecución).

## Límites conocidos

- Router heurístico (no probado con datos reales); el clasificador por LLM queda para cuando haya evals (Fase 5).
- Los eventos de una ejecución pueden llegar al renderer antes de que `ejecutar` devuelva el id: la UI debe filtrar por `ejecucionId` al recibirlos.
- Los especialistas A2A no escriben; modificar varios submódulos exige lanzar un flujo en cada proyecto.
- Las aprobaciones se responden en el modal del Asistente (`docs/interfaz.md`).
- La Fase 4 sustituye la denegación por defecto por confirmación humana y ejecuta el flujo en un git worktree.
