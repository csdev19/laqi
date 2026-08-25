---
title: Planes de implementación
---

# Planes de implementación

v2.0.0 se implementa en seis planes (el 2 se partió en dos para que cada uno
cierre con su propio PR). Cada uno produce software que funciona y se puede
testear por sí solo, y se ejecuta en orden.

**Los seis están ejecutados.**

| #   | Plan                                                                         | Entrega                                                                                                                                                                                                               | Estado                                                         |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | [Fundación y servidor de mocks](/planes/2026-08-24-01-fundacion-y-servidor/) | `laqi` corre y sirve mocks desde `laqi.json` o `laqi/`, con validación, hot-reload y las cuatro capas de resolución. Más `laqi migrate`. **13 tareas, ~95 tests.** Auditado: [auditoría](/planes/auditoria-plan-01/). | **Mergeado** — [PR #1](https://github.com/csdev19/laqi/pull/1) |
| 2a  | [Control plane](/planes/2026-08-24-02a-control-plane/)                      | `/__laqi/api/*` (CRUD de endpoints, estado, escenarios, status), SSE de requests en vivo, sobre `packages/server`. La separación estructural que el Plan 4 necesita para excluir `/__laqi` del túnel (H1) — el bloqueo en sí es responsabilidad de ese plan. **11 tareas, 50 tests nuevos.** | **Listo para mergear** — [PR #3](https://github.com/csdev19/laqi/pull/3) |
| 2b  | [Editor web](/planes/2026-08-25-02b-editor-web/)                            | `packages/editor` (React + Vite), servido en `/__laqi`, consumiendo el contrato de 2a. Cierra dos huecos del evento de request de 2a (no-route sin evento, path como patrón). **37 tests del panel.** | **Ejecutado** |
| 3   | [Servidor MCP](/planes/2026-08-25-03-servidor-mcp/)                         | `packages/mcp` y `laqi mcp`: nueve herramientas sobre stdio, incluido `import_openapi`. Cierra tres agujeros de validación de escritura que el ADR-0006 advertía. **62 tests, 14 sobre stdio real.** | **Ejecutado** |
| 4   | [URL pública](/planes/2026-08-25-04-url-publica/)                           | `laqi --share` con cloudflared. H1 cerrado por arquitectura: un segundo listener que sólo monta mocks es el que ve el túnel. Token, CORS restringido, rate limiting. **Verificado en vivo.** | **Ejecutado** |
| 5   | [Documentación y empaquetado](/planes/2026-08-25-05-empaquetado/)           | Build con tsdown: un paquete con el panel adentro, verificado desde un tarball real sobre Node limpio, con bun fuera del PATH. Cierra la fuga de SSE que venía diferida. | **Ejecutado** |

## Por qué en este orden

El plan 1 es el único que no depende de nada y del que dependen todos los demás:
el control plane, el MCP y el túnel operan sobre la tabla de rutas y el store de
estado que construye `packages/core`.

Además el plan 1 ya es **un producto usable**: un mock server correcto, con los
doce defectos de v1 arreglados y el formato nuevo. Si algo se detiene después,
lo que quedó sirve.

Cada plan se escribe cuando el anterior está ejecutado, no antes — así el
siguiente se apoya en código real en vez de en suposiciones.

## Contexto que todos los planes asumen

- [ADRs 0001–0008](../decisiones/) — las decisiones estructurales
- [Conceptos](../conceptos/) — los tres escritores y la resolución de estado
- [Diseño del control panel](../diseno/) — sobre todo [design](/diseno/design/)
  (contratos de API) y [state-model](/diseno/state-model/)
- [Revisión del diseño](/diseno/revision-vs-decisiones/) — los 13 hallazgos,
  repartidos entre los planes que corresponden

## Cobertura de los doce defectos de v1

Los doce del [análisis](/analisis-v1/) quedan cerrados en el Plan 1, salvo uno:

| Defecto                                | Dónde                                                  |
| -------------------------------------- | ------------------------------------------------------ |
| A — fuga de estado entre requests      | Tarea 10 (`structuredClone`, con test de regresión)    |
| B — `return` en vez de `continue`      | Tareas 4 y 6 (validación por clave)                    |
| C — request colgada                    | Tareas 9 y 10 (todo camino termina en respuesta)       |
| D — colisión entre archivos            | Tarea 7                                                |
| E — `(generate:uid)` sin implementar   | **Fuera del Plan 1** — templating en un plan posterior |
| F — watcher con ruta hardcodeada       | Tarea 12 (sale de la config)                           |
| G — sólo escuchaba `change`            | Tarea 12 (`add`/`change`/`unlink`, con tests)          |
| H — reinicios concurrentes, EADDRINUSE | Tarea 12 (debounce + hot-swap, con test)               |
| I — status codes como string           | Tareas 2 y 13                                          |
| J — `yargs` declarado y sin usar       | Tarea 12 (`node:util.parseArgs`, cero dependencias)    |
| K — `nodemon` en `dependencies`        | Tarea 1                                                |
| L — cero tests                         | Todo el plan (TDD obligatorio)                         |
