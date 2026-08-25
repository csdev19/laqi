---
title: Auditoría del Plan 1
---

# Auditoría del Plan 1

**Fecha:** 2026-08-24
**Método:** las suposiciones de API del plan se verificaron **ejecutando código
real** contra las versiones exactas que el plan fija (Zod 4.3.6, Hono 4.12.3,
chokidar 4, @hono/node-server 1.19), en un sandbox con Bun 1.3. No es una
revisión de lectura: cada afirmación de abajo tiene un experimento detrás.

**Contexto:** el plan lo ejecutarán subagentes con un modelo económico que
copiará el código verbatim. Por eso el estándar de la auditoría es "cero
improvisación necesaria": todo bug del plan sería un bug del producto.

**Resultado: 3 bugs reales encontrados y corregidos, 4 mejoras de robustez, y
todo lo verificado quedó anotado en el plan para que el ejecutor no lo
re-derive.** El plan ya está corregido; esta es la bitácora.

---

## Bugs encontrados (ya corregidos en el plan)

### 1. El test de `serve` no podía pasar: `port: 0` vs `min(1)`

`serve.test.ts` usa `ConfigSchema.parse({ port: 0 })` para pedir un puerto
efímero, pero `ConfigSchema` declaraba `port: z.number().int().min(1)`. El
primer test de la Tarea 12 habría lanzado en el `beforeEach`, y un ejecutor
económico habría "arreglado" cualquiera de los dos lados a ciegas.

**Corrección:** `min(0)` con comentario (`0` = puerto efímero del SO), y el test
de rechazo de rango usa `-1` en vez de `0`.

### 2. `parseJsonWithPosition` dependía del formato de error de V8

Verificado ejecutando el mismo JSON roto en ambos motores:

```
Node 22:  Expected double-quoted property name in JSON at position 22 (line 4 column 1)
Bun 1.3:  JSON Parse error: Property name must be a string literal
```

El plan extraía la posición con `/at position (\d+)/`. En Bun (JavaScriptCore)
**no hay posición en absoluto**, y en Node moderno el dato más directo es el
sufijo `(line N column N)`. Consecuencia: la banda de error del F8 habría
apuntado a la línea 1 siempre que el CLI corriera bajo Bun en desarrollo.

**Corrección:** se intenta primero `(line N column N)`, después `at position N`,
y se documenta la degradación bajo Bun (el CLI publicado con `npx` corre en
Node, así que producción siempre tiene posición). Los tests corren bajo Vitest
(Node), así que son deterministas.

### 3. Prototype chain: `X-Laqi-Response: toString` servía basura

Verificado: `'toString' in {}` es `true`. En `resolve.ts`,
`endpoint.responses[name]` con `name = 'toString'` devuelve la función heredada
de `Object.prototype` — truthy — así que pasaba el check `if (!response)` y el
handler intentaba servirla: `response.status` undefined → crash del handler en
runtime, disparable por cualquier cliente con un header.

**Corrección:** `Object.hasOwn` en el lookup de `resolve.ts` y en los dos
puntos análogos de `migrate.ts`, más un test nuevo
(`rejects a prototype-chain name like "toString"`).

---

## Mejoras de robustez (ya aplicadas)

### 4. chokidar 4 no observa rutas inexistentes → F9 roto

Verificado: con `watch([ruta-que-no-existe])`, crear la carpeta después **no
dispara ningún evento** (chokidar 4 eliminó esa capacidad de v3). El plan
filtraba las rutas con `existsSync` al arrancar, así que en un proyecto fresco
(flujo F9: cero mocks) la lista quedaba vacía y crear `laqi/` jamás recargaba.

**Corrección:** `watchMocks` ahora observa **la raíz del proyecto podando** todo
lo que no sea `laqi/` o `laqi.json` (la función `ignored` corta la descida, así
que no se indexa `src/` ni `node_modules`). El patrón se verificó ejecutándolo:
ruido filtrado, y `laqi/` creado tarde detectado. Firma nueva
(`{ root, dir, file, onChange }`) y un test nuevo para el caso F9.

### 5. Shebang en la línea 2

El bloque de `index.ts` tenía el comentario de ruta encima de
`#!/usr/bin/env node`. Copiado verbatim, el shebang no funciona. Corregido el
orden con nota explícita.

### 6. Pin de `@hono/node-server`

El plan pedía `^1.13.7`; hoy `bun add` sin pin instala la 2.x. Se verificó el
patrón completo del plan (serve con `port: 0`, `address()`, hot-swap de la app
sin soltar el socket, `close()`) contra **1.19.7** y se fijó esa versión.

### 7. Menores

- `report()` decía `watching ./laqi/` incluso en modo archivo único; ahora
  distingue por `runtime.source`.
- Anotada la limitación de que dos claves duplicadas **dentro del mismo
  archivo** las deduplica `JSON.parse` antes de que el loader las vea (gana la
  última) — inherente a JSON, la detección del ADR-0008 es entre archivos.
  Queda documentarla en el Plan 5.

## Verificado y correcto (sin cambios)

Para que el ejecutor no lo dude ni lo re-verifique:

| Suposición del plan                                                                                                                              | Resultado                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Zod 4.3.6: `superRefine` + `ctx.addIssue({ code: 'custom', path })`                                                                              | ✔ funciona, mensaje y path como esperan los tests  |
| Zod 4.3.6: `z.record(k, v)` de dos argumentos, `.default({})`, `.nullable().default(null)`                                                       | ✔                                                  |
| Hono 4.12.3: `app.on(method, path)`, `c.json(body, status)`, `c.body(null, 204)`, `app.all('*')` como 404, `hono/cors`, `hono/utils/http-status` | ✔ todo, incluido el 404 para métodos no declarados |
| `@hono/node-server` 1.19: `serve({fetch, port: 0})` + `address().port` + reemplazo de la app sin reiniciar el socket                             | ✔ hot-swap confirmado en vivo                      |
| chokidar 4: `import { watch }` nombrado, `ignored` como función, poda de dotfiles                                                                | ✔                                                  |
| `bun run test -- <filtro>` reenvía el filtro a vitest                                                                                            | ✔ (con y sin `--`)                                 |

## Cambios al plan derivados

- Sección nueva **"Notas para el ejecutor"** con las reglas para el modelo
  económico: copiar verbatim, no cambiar versiones, no debilitar tests, correr
  `bun run test` + `check-types` completos antes de cada commit, y no
  "corregir" APIs consultando documentación externa (ya están verificadas).
- Conteos de tests actualizados: resolve 13, serve+watcher 11, total ~95.
