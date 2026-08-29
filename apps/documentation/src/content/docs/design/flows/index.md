---
title: Flujos
---

# Flujos

Un archivo por flujo: trigger, pasos, estados y caminos de fallo. Entregados por
Claude Design, **verbatim**.

> **Corrección de nombres pendiente de aplicar.** Estos documentos dicen
> `./mocks/` y `mocks/api.json`. El [ADR-0008](/decisiones/0008-multiarchivo-y-nombres/)
> los renombró a **`./laqi/`** y **`laqi/api.json`** (`mocks/` choca con la
> convención `__mocks__` de Jest y con los setups de MSW). Afecta a F6, F8 y F9.
> **El ADR manda; estos archivos son el registro de lo entregado.**

| #   | Flujo                               | Frecuencia            | Archivo                                   |
| --- | ----------------------------------- | --------------------- | ----------------------------------------- |
| F1  | Cambiar la respuesta activa         | decenas/hora          | [01](/diseno/flows/01-flip-response/)     |
| F2  | Ver qué está activo ahora           | continuo              | [02](/diseno/flows/02-scan-state/)        |
| F3  | Mirar los requests llegar           | continuo              | [03](/diseno/flows/03-watch-requests/)    |
| F4  | Activar un escenario                | varias/día            | [04](/diseno/flows/04-activate-scenario/) |
| F5  | Editar la definición de un endpoint | pocas/día             | [05](/diseno/flows/05-edit-endpoint/)     |
| F6  | Crear un endpoint                   | pocas/semana          | [06](/diseno/flows/06-create-endpoint/)   |
| F7  | Compartir el mock públicamente      | pocas/semana          | [07](/diseno/flows/07-share-publicly/)    |
| F8  | Recuperarse de un archivo roto      | pocas/semana, urgente | [08](/diseno/flows/08-broken-file/)       |
| F9  | Arrancar un proyecto nuevo          | una vez               | [09](/diseno/flows/09-fresh-project/)     |

La frecuencia es el argumento de layout: F1–F3 sin navegación, F4 sin salir de
la vista principal, F5–F9 pueden costar un cambio de vista o una banda.
