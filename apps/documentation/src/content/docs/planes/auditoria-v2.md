---
title: Auditoría de v2
---

# Auditoría de v2

**Fecha:** 2026-08-25
**Alcance:** `main...laqi-v2-packaging` — los planes 2a, 2b, 3, 4 y 5 juntos
(~7.4k líneas de fuente en `apps/cli` y `packages/{core,schema,server,mcp,editor}`).
**Método:** revisión adversarial multi-agente, con verificación por reproducción
antes de arreglar nada.

Los planes 1 y 2a ya habían pasado por revisores independientes durante su
ejecución. Los otros cuatro se ejecutaron sin esa segunda mirada, y esta
auditoría es la que la aporta.

## Resultado

**15 hallazgos filed, todos reales, todos cerrados.** Más un decimosexto que
no estaba en la lista (ver abajo). 436 tests.

### El hallazgo estructural, que era la causa de otros dos

El CRUD del control plane era **una segunda copia** de la clase `Project` del
servidor MCP — misma regla de archivo destino, mismo chequeo de id duplicado,
comentarios casi idénticos. Y ya habían divergido:

- `POST /api/endpoints` no corría `parseEndpointKey`. Un path como `/my orders`
  o `/../evil` se escribía en el archivo del usuario y devolvía **201**; en la
  recarga inmediata el loader lo rechazaba. El panel decía "creado" y acto
  seguido mostraba la banda roja, sobre una entrada muerta que había que
  borrar a mano.
- `DELETE` no limpiaba el override en `.laqi/state.json`. Recrear el mismo id
  más tarde lo revivía sirviendo la respuesta vieja, en silencio.

`Project` se movió a `@laqi/core` y las dos superficies lo usan. Una sola
implementación no puede driftear.

### Corrección

| Qué | Por qué importaba |
|---|---|
| Doble `decodeURIComponent` en el control plane | Hono ya decodifica: un path con `%` literal tiraba `URIError` → 500, y el endpoint quedaba ineditable e imborrable desde el panel |
| El `cors()` de la app pública se comía los mocks `OPTIONS` | `mock-app.ts` registra los mocks OPTIONS antes de su propio cors justo para que sean alcanzables; el de la app pública lo deshacía. 200 en local, **204 vacío por el túnel** |
| `seq` leído adentro del updater de React | Los eventos que llegan en un mismo flush salían con la misma key |
| El draft del detalle se reseteaba por identidad de objeto | `refresh()` devuelve objetos nuevos siempre: cualquier recarga ajena borraba lo que estabas tipeando |
| `getStatus` reportaba `config.port` | Con `--port 0` el panel mostraba `127.0.0.1:0` y ofrecía copiar un `curl` que falla |

### Robustez de la superficie que da a internet

| Qué | Por qué importaba |
|---|---|
| El Map del rate limiter no se purgaba nunca | La clave sale de un header que el atacante controla: rotarlo agregaba una entrada permanente por request, ~1.7M por día hasta matar el proceso |
| La salida de cloudflared se acumulaba para siempre | Un túnel de horas guardaba cada byte logueado y re-corría el regex sobre una cadena creciente |
| `close()` colgaba con un cliente SSE conectado | `http.Server#close` espera a las conexiones abiertas, y `/events` no termina solo. Con el panel abierto, no resolvía jamás |
| Escapes `%` malformados en los assets | `%` o `%zz` — tráfico de bots rutinario — salían como 500 con stack en vez de 404 |
| `--share-port` sin validar | `Number('abc')` llegaba como `NaN` a `server.listen()` y salía como stack pelado |

### Eficiencia

- `import_openapi` llamaba a `createEndpoint` por operación, y cada llamada
  recargaba y re-parseaba **todos** los archivos de mock y reescribía el
  destino entero — O(n²) de disco y una recarga del watcher por endpoint. Un
  spec de 150 operaciones hacía 150 de cada cosa. Ahora carga y escribe una vez.
- `reload()` emitía un `endpoints-changed` **más un `error` por archivo roto**,
  y el panel hace un refresh completo por evento: con tres archivos rotos, un
  guardado disparaba cuatro refreshes y dieciséis GETs. Un solo evento, y el
  panel los agrupa.
- El keep-alive del SSE era un `while (!closed) await stream.sleep(30)`, un
  timer 33 veces por segundo **por conexión** sólo para mirar un flag. Ahora
  espera `stream.onAbort` directo.

## El hallazgo 16, que estaba en un paréntesis

La sección de *non-findings* del review despachaba la guarda de contención de
`writer.ts` así:

> `resolveInside` correctly rejects escapes **(symlinks aside)**

Ese paréntesis era un agujero real. `resolve()` es puramente léxico y nunca
toca el disco, así que un symlink **dentro** del proyecto apuntando afuera
pasaba de largo:

```
laqi/escape -> /tmp/outside    →    write result: {"ok": true}
```

Es exactamente lo que el [ADR-0006](/decisiones/0006-servidor-mcp/) prohíbe: el
agente tiene que quedar acotado al directorio de mocks, y crear un symlink es
algo que el propio agente puede hacer. La guarda ahora resuelve rutas reales —
el root incluido, porque él mismo puede ser un symlink (en macOS `/tmp` lo es,
y compararlo sin resolver rechazaría todo uso legítimo).

**La lección:** lo más caro de la auditoría estaba en un paréntesis, dentro de
una sección titulada "cosas que revisé y descarté". Leer sólo la lista de
hallazgos habría dejado el agujero abierto.

## Una nota de peso, no de corrección

El SDK de MCP era dependencia runtime y arrastraba express, jose y ajv a
**toda** instalación, aunque nunca corras `laqi mcp`. Bundlearlo deja que el
tree-shaking tire el transport HTTP que no usamos: una instalación limpia pasó
de **97 paquetes a 6**, y `laqi mcp` sigue andando — verificado desde el
tarball bajo Node puro.
