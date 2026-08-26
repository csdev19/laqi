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

---

# Segunda ronda

**Fecha:** 2026-08-26
**Alcance:** todo lo que la primera ronda no cubrió — los propios arreglos de
esa ronda (commits `0a0143f`, `bbb0108`, `de8254a`) y el ejemplo
`examples/todo-app`, ninguno revisado por nadie.
**Método:** cuatro ángulos en paralelo con un modelo barato, cada uno obligado
a **reproducir** antes de reportar y a descartar lo que no pudiera demostrar.

## Resultado

**10 hallazgos, todos reales.** El ángulo de seguridad no encontró nada: los
siete arreglos de la primera ronda aguantaron bajo pruebas en proceso.

## Lo peor: dos regresiones de los arreglos de la primera ronda

El ángulo «¿algún fix rompió otra cosa?» era el correcto, y encontró
exactamente lo que temía.

**1. El túnel se congelaba.** Arreglando «el buffer crece sin límite» se
quitaron los listeners de `stdout`/`stderr` del proceso de cloudflared. Eso no
sólo deja de acumular: **pausa el stream**. Node deja de vaciar el pipe, el
pipe se llena, y cloudflared —que escribe a stderr de forma bloqueante— se
traba para siempre en su próximo log. Un túnel de horas simplemente moría.

Y hay una segunda lección: **los dos tests escritos junto a ese arreglo
afirmaban `listenerCount === 0`**, o sea fijaban el bug en su lugar. Un test
puede consagrar el error que acompaña.

**2. El chequeo de duplicados se esquivaba con un espacio.** El arreglo
normalizaba las claves *del archivo* pero seguía armando el id con el path
crudo. `"/users "` pasaba los dos controles, quedaban dos claves que
normalizan al mismo id, y la tabla de rutas rechazaba ambas — matando el
endpoint que ya andaba. Justo el fallo que ese commit decía cerrar.

**3. El puerto mal culpado.** Deducir qué listener falló leyendo el texto del
error se equivoca en las dos direcciones: bajo Bun el mensaje de `EADDRINUSE`
no trae `":puerto"`, así que con `--share` un puerto principal ocupado
culpaba a `--share-port`; bajo Node, un puerto de túnel cuyos dígitos empiezan
igual que el principal culpaba a `--port`. Ahora `startServer` marca en el
propio error cuál falló.

## Concurrencia y estado

| Qué | Por qué importaba |
|---|---|
| Los contadores del rate limiter se reconstruían en cada hot-reload | Guardar **cualquier** archivo local le devolvía la cuota entera a un cliente limitado en el túnel: la única protección DoS de la superficie pública, reseteada por una tecla |
| `writeFileObject` usaba un `.tmp` de nombre fijo | Esta release conecta **dos procesos** a los mismos archivos (el MCP y el control plane). Medido: de 80 endpoints creados en paralelo quedaban **48**, más un crash con `ENOENT` al renombrar un temporal que el otro proceso ya se había llevado. Ahora: temporales únicos y un lock de archivo con recuperación de locks viejos — 80/80 |

## El ejemplo: el panel no mandaba

El hallazgo más vergonzoso, y es un error de diseño, no un descuido.

`examples/todo-app` pedía cada página con `X-Laqi-Response: page-N`. Esa es la
capa de **mayor precedencia** de laqi: le gana a los overrides del panel y a
los escenarios. Una app que la manda en cada request se pisa el panel en cada
request — así que **la feature que el README anunciaba no funcionaba**:
flipear `GET /todos` a `error`, `empty` o `slow`, o activar `backend-caido`,
no llegaba nunca a la app.

Peor: la verificación original se hizo con curl **sin** ese header, o sea
probando un camino que la app no toma. Ver lo que uno quiere ver.

El mock ahora devuelve la lista entera y la app la pagina del lado del
cliente. Un backend real paginaría en el servidor; laqi ignora el query
string, así que ésta es la forma honesta — y deja el panel al mando, que es
todo el punto del ejemplo. El README explica por qué, para que no se
reintroduzca.

Con eso se fueron también dos consecuencias: pedir `page-3` (alcanzable tras
crear dos todos) devolvía un 500 sin salida, porque es un nombre de respuesta
que el mock nunca declaró.

Además, en el mismo ejemplo:

- Un todo creado mostraba el título **enlatado del mock** en vez de lo que el
  usuario escribió. Del servidor sólo se toma la forma; el título sale de lo
  tipeado, que es lo que un backend real devolvería.
- Leer la cookie de sesión durante el render daba `null` en SSR y la sesión
  real al hidratar: **mismatch de hidratación** en cada carga de alguien
  logueado, y redirección a `/login` para quien sí tenía sesión. Ahora hay un
  store con `useSyncExternalStore` —`null` en el servidor por
  construcción— y un flag `ready` para que los guards esperen al montaje.
- El manejo del 401 en el perfil hacía efectos **durante el render**
  (escribir una cookie y navegar), que corre dos veces bajo StrictMode.

## La lección de esta ronda

La primera ronda dejó su hallazgo más caro en un paréntesis. Ésta dejó dos de
sus tres peores en **arreglos hechos apurados sin revisar**, y uno de ellos
con un test que consagraba el bug.

Arreglar rápido y no revisar el arreglo tiene un costo medible: **2 de 10**
hallazgos de esta ronda existen sólo porque la ronda anterior no se revisó.
