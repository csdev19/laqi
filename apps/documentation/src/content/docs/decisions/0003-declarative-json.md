---
title: ADR-0003 — JSON declarativo como formato primario
---

# ADR-0003 — JSON declarativo como formato primario

**Estado:** Aceptada — parcialmente superada por [ADR-0008](/decisiones/0008-multiarchivo-y-nombres/)
**Fecha:** 2026-08-24

> **Nota:** el modo carpeta con _routing por filesystem_ descrito abajo fue
> reemplazado por el [ADR-0008](/decisiones/0008-multiarchivo-y-nombres/): cualquier
> cantidad de archivos, todos con claves `"METHOD /path"`, y la colisión de
> rutas resuelta con validación en vez de estructura. Los nombres también
> cambian (`laqi/`, `laqi.json`). Todo lo demás de este ADR sigue vigente.

## Contexto

Había que decidir el formato de los archivos de mock. v1 usaba JSON, pero con un
esquema que causó tres de sus peores defectos: el método codificado en la clave
del endpoint (que llevó al hack `(get)files/:id`), la fusión plana de archivos
(colisiones silenciosas) y `selectorCode` redundante dentro de un array.

La pregunta abierta era si seguir en JSON o pasar a TypeScript, que da tipos,
autocompletado y lógica.

## Decisión

**JSON declarativo como formato primario**, con esquema nuevo. TypeScript queda
como escape hatch opcional para el pequeño porcentaje de casos que necesitan
lógica de verdad.

## Por qué

El argumento completo está en [los tres escritores](/conceptos/tres-escritores/).
Resumido:

En v1 los archivos tenían un solo escritor: el humano. En v2 hay tres —el humano,
el editor web y la IA vía MCP— y eso impone una restricción dura: **el formato
tiene que ser round-trippeable por una máquina.** El editor web debe poder abrir
un archivo, cambiar un campo y reescribirlo sin destruir lo que no tocó.

Eso descarta TypeScript como fuente de verdad:

- Reescribir un `.ts` desde una UI exige un codemod de AST, y el resultado se
  degrada con cada pasada.
- La IA tendría que generar **código** en vez de **datos** — más superficie para
  alucinar y sin forma barata de validar.
- Cargar `.ts` significa **ejecutar código arbitrario** y meter un transpilador
  dentro del CLI.

## El esquema nuevo

**Modo archivo único** — `laqi.json` en la raíz. El caso de treinta segundos:

```json
{
  "$schema": "https://laqi.dev/schema.json",
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok":    { "status": 200, "body": [{ "id": "{{uuid}}", "name": "{{name}}" }] },
      "empty": { "status": 200, "body": [] },
      "boom":  { "status": 500, "delay": 2000, "body": { "code": "INTERNAL" } }
    }
  },
  "POST /users": {
    "default": "created",
    "responses": { "created": { "status": 201, "body": {} } }
  }
}
```

**Modo carpeta** — `laqi/` con routing por filesystem, cuando crece.
`laqi/users/[id].json`:

```json
{
  "GET":    { "default": "ok", "responses": { "ok": { "status": 200, "body": {} } } },
  "DELETE": { "default": "ok", "responses": { "ok": { "status": 204 } } }
}
```

Los dos compilan a la misma tabla de rutas interna. Se empieza con un archivo y
`laqi split` lo convierte en carpeta cuando estorba. **Soportar los dos modos es
deliberado**: "un archivo o una carpeta, un comando y está vivo" era lo que hacía
bueno a v1 y no se pierde.

## Qué arregla cada cambio

| Cambio                                 | Defecto de v1 que elimina                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| La clave es `"GET /users/:id"`         | El método deja de competir con el path → adiós al hack `(get)files/:id`                                                                          |
| Routing por filesystem en modo carpeta | Colisión entre archivos **imposible por construcción** (defecto D)                                                                               |
| `responses` es objeto, no array        | Muere `selectorCode` (era redundante con su propia clave); lookup O(1); nombre único garantizado                                                 |
| `status` es número                     | Compatible con Hono y Express 5 (defecto I)                                                                                                      |
| `delay` y `headers` de primera clase   | Simular red lenta y timeouts — crítico para React Native                                                                                         |
| `{{uuid}}`, `{{name}}`                 | Implementa de verdad el `(generate:uid)` que quedó a medias (defecto E)                                                                          |
| Validación Zod al cargar               | Selector inexistente, método inválido o entrada `null` fallan **al arrancar**, con mensaje claro, en vez de colgar la request (defectos B, C, G) |
| `$schema` publicado                    | Autocompletado y validación en VSCode, gratis                                                                                                    |

## Alternativas consideradas

**TypeScript como fuente de verdad.** Descartada por el argumento de los tres
escritores. Se mantiene como escape hatch opcional: un archivo `.ts` al lado del
JSON puede exportar un handler para el caso que necesita lógica real. El editor
web y el MCP no lo tocan, sólo lo muestran como "manejado por código".

**YAML.** Más legible y admite comentarios, pero el round-trip preservando
comentarios es frágil y los tres escritores lo tratarían distinto. La ganancia en
legibilidad no compensa.

**Mantener el esquema de v1 tal cual.** Descartada: es la fuente directa de tres
defectos verificados.

## Consecuencias

**A favor:**

- Un formato que los tres escritores comparten sin fricción.
- Validable barato, con errores al arrancar en vez de en runtime.
- Sin transpilador ni ejecución de código arbitrario en el CLI.

**En contra:**

- JSON no admite comentarios. Mitigado con un campo `description` opcional por
  endpoint y por respuesta.
- Es más verboso que TS para casos complejos. Para eso está el escape hatch.
- Rompe compatibilidad con v1. Mitigado con `laqi migrate`.
