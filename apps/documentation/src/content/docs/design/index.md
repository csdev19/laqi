---
title: Diseño del control panel
---

# Diseño del control panel

Diseño de `packages/editor`, producido con Claude Design a partir del brief en
[prompt-editor-web](/web-editor-prompt/).

> **Antes de implementar, leer [review-vs-decisions](/design/review-vs-decisions/).**
> Trece hallazgos, uno de ellos un agujero de seguridad bloqueante (`/__laqi`
> quedaría expuesto por el túnel) y otro que ya cambió una decisión
> ([ADR-0008](/decisions/0008-multifile-and-names/)).

## Contenido

| Archivo                                             | Qué contiene                                                    |
| --------------------------------------------------- | --------------------------------------------------------------- |
| [design](/design/design/)                           | Tokens, paleta, tipografía, layout, contratos de API            |
| [screens](/design/screens/)                         | Qué hay en cada pantalla y región, y por qué                    |
| [interactions](/design/interactions/)               | Inventario de elementos interactivos, estados y mapa de teclado |
| [state-model](/design/state-model/)                 | Las cuatro capas de resolución y sus reglas de precedencia      |
| [flows/](/design/flows/)                            | Un archivo por flujo (F1–F9): trigger, pasos, estados, fallos   |
| [review-vs-decisions](/design/review-vs-decisions/) | La revisión contra los ADRs                                     |

**Falta traer:** `Laqi Control Panel.dc.html`, el prototipo interactivo de
referencia. Está en el proyecto de diseño y no se puede reconstruir desde acá —
cópialo a esta carpeta cuando puedas, porque [design](/design/design/) lo cita
como la fuente de los valores exactos.

## Correcciones ya conocidas

Los documentos están **verbatim como se entregaron**. Estas correcciones ya
están decididas y hay que aplicarlas al implementar — no se editaron acá para
que el registro de lo entregado quede intacto:

| Dónde                                       | Corrección                                                           | Origen                                           |
| ------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Header, banda de error, F6, F8, F9, SCREENS | `./mocks/` → `./laqi/`, `mocks/api.json` → `laqi/api.json`           | [ADR-0008](/decisions/0008-multifile-and-names/) |
| Contratos de API                            | Todo `/__laqi/*` devuelve 404 por el túnel                           | H1                                               |
| Contratos de API                            | Falta `DELETE /__laqi/api/endpoints/:id`                             | H8                                               |
| Detalle, caja HEADERS                       | `x-laqi-resolved` sale de los headers editables, y lleva `(<layer>)` | H4                                               |
| Banda de error                              | También para errores semánticos, no sólo de parseo                   | H5                                               |
