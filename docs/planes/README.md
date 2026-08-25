# Planes de implementación

v2.0.0 se implementa en seis planes (el 2 se partió en dos para que cada uno
cierre con su propio PR). Cada uno produce software que funciona y se puede
testear por sí solo, y se ejecuta en orden.

| # | Plan | Entrega | Estado |
|---|------|---------|--------|
| 1 | [Fundación y servidor de mocks](2026-08-24-01-fundacion-y-servidor.md) | `laqi` corre y sirve mocks desde `laqi.json` o `laqi/`, con validación, hot-reload y las cuatro capas de resolución. Más `laqi migrate`. **13 tareas, ~95 tests.** Auditado: [auditoría](auditoria-plan-01.md). | **Mergeado** — [PR #1](https://github.com/csdev19/laqi/pull/1) |
| 2a | Control plane | `/__laqi/api/*` (endpoints, estado, escenarios, share, status), SSE de requests en vivo, y el 404 de `/__laqi` a través del túnel (H1) — sobre `packages/server` | Por escribir |
| 2b | Editor web | `packages/editor` (React + Vite), servido en `/__laqi`, consumiendo el contrato de 2a | Por escribir, depende de 2a |
| 3 | Servidor MCP | `packages/mcp` y `laqi mcp` | Por escribir |
| 4 | URL pública | `laqi --share` con cloudflared, y el endurecimiento de seguridad del H1 | Por escribir |
| 5 | Documentación y empaquetado | `apps/documentation` en Astro + Starlight; build con tsdown y `npx laqi` funcionando en Node limpio | Por escribir

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
- [Diseño del control panel](../diseno/) — sobre todo `DESIGN.md` (contratos de
  API) y `STATE-MODEL.md`
- [Revisión del diseño](../diseno/revision-vs-decisiones.md) — los 13 hallazgos,
  repartidos entre los planes que corresponden

## Cobertura de los doce defectos de v1

Los doce del [análisis](../analisis-v1.md) quedan cerrados en el Plan 1, salvo uno:

| Defecto | Dónde |
|---------|-------|
| A — fuga de estado entre requests | Tarea 10 (`structuredClone`, con test de regresión) |
| B — `return` en vez de `continue` | Tareas 4 y 6 (validación por clave) |
| C — request colgada | Tareas 9 y 10 (todo camino termina en respuesta) |
| D — colisión entre archivos | Tarea 7 |
| E — `(generate:uid)` sin implementar | **Fuera del Plan 1** — templating en un plan posterior |
| F — watcher con ruta hardcodeada | Tarea 12 (sale de la config) |
| G — sólo escuchaba `change` | Tarea 12 (`add`/`change`/`unlink`, con tests) |
| H — reinicios concurrentes, EADDRINUSE | Tarea 12 (debounce + hot-swap, con test) |
| I — status codes como string | Tareas 2 y 13 |
| J — `yargs` declarado y sin usar | Tarea 12 (`node:util.parseArgs`, cero dependencias) |
| K — `nodemon` en `dependencies` | Tarea 1 |
| L — cero tests | Todo el plan (TDD obligatorio) |
