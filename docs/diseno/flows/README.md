# Flujos

Un archivo por flujo: trigger, pasos, estados y caminos de fallo. Entregados por
Claude Design, **verbatim**.

> **Corrección de nombres pendiente de aplicar.** Estos documentos dicen
> `./mocks/` y `mocks/api.json`. El [ADR-0008](../../decisiones/0008-multiarchivo-y-nombres.md)
> los renombró a **`./laqi/`** y **`laqi/api.json`** (`mocks/` choca con la
> convención `__mocks__` de Jest y con los setups de MSW). Afecta a F6, F8 y F9.
> **El ADR manda; estos archivos son el registro de lo entregado.**

| # | Flujo | Frecuencia | Archivo |
|---|-------|-----------|---------|
| F1 | Cambiar la respuesta activa | decenas/hora | [01](01-flip-response.md) |
| F2 | Ver qué está activo ahora | continuo | [02](02-scan-state.md) |
| F3 | Mirar los requests llegar | continuo | [03](03-watch-requests.md) |
| F4 | Activar un escenario | varias/día | [04](04-activate-scenario.md) |
| F5 | Editar la definición de un endpoint | pocas/día | [05](05-edit-endpoint.md) |
| F6 | Crear un endpoint | pocas/semana | [06](06-create-endpoint.md) |
| F7 | Compartir el mock públicamente | pocas/semana | [07](07-share-publicly.md) |
| F8 | Recuperarse de un archivo roto | pocas/semana, urgente | [08](08-broken-file.md) |
| F9 | Arrancar un proyecto nuevo | una vez | [09](09-fresh-project.md) |

La frecuencia es el argumento de layout: F1–F3 sin navegación, F4 sin salir de
la vista principal, F5–F9 pueden costar un cambio de vista o una banda.
