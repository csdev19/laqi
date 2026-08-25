---
title: Revisión del diseño contra las decisiones
---

# Revisión del diseño contra las decisiones

**Fecha:** 2026-08-24
**Revisado:** `DESIGN.md`, `SCREENS.md`, `INTERACTIONS.md`, `STATE-MODEL.md`,
flujos F1–F9, y las siete capturas del prototipo.

El diseño es sólido y coherente con casi todo lo decidido. Lo que sigue es lo
que **no** cierra: un agujero de seguridad, una contradicción con el ADR-0003,
una inconsistencia interna del propio diseño, y varios huecos menores.

---

## Lo que confirma las decisiones

Vale la pena registrarlo porque valida los ADRs con una segunda cabeza:

- **El modelo de estado coincide exactamente** con
  [resolución de estado](/conceptos/resolucion-de-estado/): cuatro capas,
  `state` gana sobre `scenario`, y `header` **nunca muta estado** — sólo aparece
  en el log, nunca cambia un chip. Esa asimetría la dedujo el diseño por su
  cuenta y es correcta.
- **El control plane que define es la superficie del MCP.** `GET/PUT
/__laqi/api/state`, `GET/POST/PUT /__laqi/api/endpoints`, `GET
/__laqi/api/scenarios` mapean casi 1:1 contra las herramientas del
  [ADR-0006](/decisiones/0006-servidor-mcp/). Confirma la tesis de que se
  implementa una vez y se expone por tres superficies.
- **`"GET /users"` como ID de endpoint** es exactamente el formato del
  [ADR-0003](/decisiones/0003-json-declarativo/). Las capturas muestran
  `GET /users` y `POST /users` como filas separadas: el hack `(get)` de v1 queda
  enterrado.
- **Compartir apagado por defecto, cada sesión, y token enmascarado** coincide
  con el [ADR-0007](/decisiones/0007-url-publica/).

Y una cosa que el diseño resolvió **mejor** de lo que estaba especificado — ver
H3 abajo.

---

## Hallazgos

| #   | Hallazgo                                                   | Severidad                  |
| --- | ---------------------------------------------------------- | -------------------------- |
| H1  | El túnel expondría el control plane                        | **Bloqueante — seguridad** |
| H2  | Vuelve la colisión entre archivos; contradice el ADR-0003  | **Alta — estructural**     |
| H3  | Carga parcial vs fallo al arrancar (el diseño acierta)     | Alta — refina el ADR-0003  |
| H4  | `X-Laqi-Resolved` inconsistente y editable por el usuario  | Media                      |
| H5  | Los errores semánticos no tienen superficie                | Media                      |
| H6  | El hot-reload no puede reiniciar el servidor               | Media — implementación     |
| H7  | `/__laqi` es un prefijo reservado y no está declarado      | Media                      |
| H8  | Falta `DELETE` de endpoint en el contrato                  | Baja                       |
| H9  | El `curl` del detalle no contempla el modo compartido      | Baja                       |
| H10 | Nombre de la carpeta: `mocks/` vs `laqi/`                  | Baja — decisión            |
| H11 | Dos webfonts dentro de un binario que se instala con `npx` | Baja                       |
| H12 | Props del prototipo sin hogar definitivo                   | Baja                       |
| H13 | Inconsistencias del prototipo (estado fresh, log vacío)    | Cosmética                  |

---

### H1 — El túnel expondría el control plane · **bloqueante**

F7 levanta una URL pública que apunta al servidor. El diseño **nunca dice que
`/__laqi` deba quedar fuera del túnel.** Si el proxy pasa todo:

- `PUT /__laqi/api/endpoints/:id` → cualquiera con la URL **reescribe tus
  archivos de mock en tu disco**.
- `GET /__laqi/api/status` → filtra la ruta local del proyecto.
- `POST /__laqi/api/share` → un tercero controla el túnel.
- El propio panel queda navegable desde internet.

El [ADR-0007](/decisiones/0007-url-publica/) ya lo exige ("el editor web y
el MCP no se exponen"), pero el diseño no lo encodea y es el tipo de cosa que se
implementa mal por omisión.

**Resolución:** el control plane se monta en un router aparte que sólo escucha
en la interfaz local. Lo que sale por el túnel es exclusivamente la superficie
de mocks; `/__laqi/*` devuelve 404 a través del relay — 404 y no 403, para no
confirmar que existe. Debe haber un test que lo verifique.

Además: el panel debería **decirlo** en la banda magenta. Una línea del tipo
`mocks only — the panel is not exposed` convierte una garantía invisible en algo
que el usuario ve.

---

### H2 — Vuelve la colisión entre archivos · **alta**

El diseño asume una carpeta `mocks/` con **varios archivos** (`api.json`,
`orders.json` — visibles en la banda de error y en F6), y cada archivo usa
claves `"METHOD /path"`.

Eso significa que `api.json` y `orders.json` pueden **ambos** definir
`"GET /users"`. Es el defecto D de v1 volviendo por la puerta de atrás.

El [ADR-0003](/decisiones/0003-json-declarativo/) lo había resuelto haciendo
que el modo carpeta usara routing por filesystem (`laqi/users/[id].json`), donde
la colisión es imposible por construcción.

**Recomendación: adoptar el modelo del diseño y resolver la colisión con
validación, no con estructura.** Razones:

1. Un solo formato de clave en todos lados es más simple que dos modos con
   sintaxis distinta.
2. **La banda de error ya existe** y maneja exactamente esta clase de problema.
   Una colisión es un error de carga con archivo y línea, igual que un JSON roto.
3. El routing por filesystem obliga a carpetas profundas
   (`mocks/api/v1/users/[id]/orders/[orderId].json`) para APIs profundas.
4. Cada endpoint ya lleva su `file` de origen en el contrato, así que el mensaje
   de error puede nombrar los dos archivos en conflicto.
5. El objetivo real del ADR-0003 era que **no hubiera colisiones silenciosas**.
   La estructura era un medio; la validación logra lo mismo y es más flexible.

Esto supera parte del ADR-0003 → **hace falta un ADR-0008**. Pendiente de tu
aprobación antes de escribirlo.

---

### H3 — Carga parcial en vez de fallo al arrancar · el diseño acierta

F8 dice: un archivo roto muestra la banda y **"el resto del mock se sigue
sirviendo"**, con el contador en `26 (+1 file failed)`.

Eso es **mejor** que lo que dejé escrito en
[tres-escritores](/conceptos/tres-escritores/), que dice "falla ruidosamente
al arrancar" y se puede leer como _fail-fast_. Reiniciar todo el mock porque un
archivo tiene una coma de más es hostil.

**Resolución:** la semántica correcta es **ruidoso pero no fatal, por archivo**.
El cargador es tolerante a fallos a nivel de archivo; cada archivo que falla
produce un error visible y retira sólo sus endpoints. Hay que corregir la
redacción del concepto.

---

### H4 — `X-Laqi-Resolved` inconsistente y editable

Dos problemas en el mismo panel:

1. **Formato.** `STATE-MODEL.md` dice que el valor es `<name> (<layer>)` y F3
   dice que el log imprime ese string verbatim. Pero la captura del detalle
   muestra `"x-laqi-resolved": "ok"` — sin la capa. Si el header no lleva la
   capa, el log no puede imprimirla verbatim y se rompe la promesa de que el
   panel es verificable contra el network tab.
2. **Editabilidad.** Aparece dentro de la caja `HEADERS`, que es un campo que el
   usuario edita. `x-laqi-resolved` lo **genera laqi**: no puede vivir ahí. Si
   el usuario lo edita, miente. Si laqi lo sobreescribe, la edición se pierde en
   silencio.

**Resolución:** el header se emite siempre como `<name> (<layer>)`, se calcula en
runtime, y la caja `HEADERS` sólo contiene los headers declarados por el usuario.
Los headers generados por laqi se muestran aparte y en sólo lectura.

---

### H5 — Los errores semánticos no tienen superficie

F8 cubre errores de **parseo** de JSON. No cubre archivos que parsean bien pero
son inválidos:

- `default` apunta a una respuesta que no existe (el defecto C de v1, el que
  colgaba la request)
- método HTTP inválido (defecto G de v1)
- ruta duplicada entre archivos (H2)
- `status` fuera de rango, `delay` negativo
- una ruta bajo el prefijo reservado `/__laqi` (H7)

**Resolución:** la misma banda, con la misma anatomía (archivo, línea, causa en
palabras, extracto). El diseño ya tiene el componente; sólo hay que alimentarlo
con los errores de Zod además de los de `JSON.parse`.

---

### H6 — El hot-reload no puede reiniciar el servidor

En v1 cada cambio de archivo mataba el servidor y volvía a escuchar (defecto H).
Con el panel abierto eso ahora **corta el SSE y deja la UI en blanco** en cada
guardado.

F5 pide "diff, don't remount" para la UI. Lo mismo tiene que valer del lado del
servidor: **la tabla de rutas se reemplaza en caliente**, el proceso y el socket
siguen vivos, y el cambio sale como evento `endpoints-changed`. Nunca un
`listen()` nuevo.

Es una restricción dura sobre `packages/core` y `packages/server`.

---

### H7 — `/__laqi` es un prefijo reservado

El panel, su API y el SSE viven bajo `/__laqi`. Eso significa que **el usuario no
puede mockear nada bajo esa ruta**. No está declarado en ningún lado.

**Resolución:** documentarlo, y que el validador rechace con mensaje claro
cualquier endpoint que empiece con `/__laqi`. Ojo que es exactamente el tipo de
cosa que rompe a alguien mockeando un backend real que use `__` como prefijo.

---

### H8 — Falta borrar endpoints

El contrato tiene `POST` y `PUT` de endpoints, y el detalle permite `Delete` de
una **respuesta**. No hay forma de borrar un **endpoint**.

**Resolución:** agregar `DELETE /__laqi/api/endpoints/:id` al contrato, y decidir
si el panel lo expone (probablemente en el detalle, junto a la ruta) o si se
borra sólo editando el archivo.

---

### H9 — El `curl` del detalle ignora el modo compartido

F7 hace bien: `Copy curl` de la banda incluye `Authorization: Bearer <token>`.
Pero el `curl` por respuesta de F5 es siempre
`curl -H 'X-Laqi-Response: ok' localhost:8000/users`.

Con el túnel activo, ese comando no sirve para probar desde otro dispositivo —
que es justo cuando lo necesitas.

**Resolución:** cuando compartir está activo, el `curl` del detalle usa la URL
pública y el bearer. O muestra las dos variantes.

---

### H10 — `mocks/` vs `laqi/`

El diseño usa `./mocks/` y `mocks/api.json`. El
[ADR-0003](/decisiones/0003-json-declarativo/) decía `laqi.json` o `laqi/`.

**Recomendación: quedarse con `mocks/`.** Le dice a alguien que abre el repo por
primera vez qué hay dentro; `laqi/` sólo dice qué herramienta lo lee. El archivo
único puede seguir siendo `laqi.json` en la raíz, o `mocks.json` por simetría —
hay que elegir y que el ADR-0008 lo registre.

---

### H11 — Dos webfonts dentro de un `npx`

`Source Serif 4` + `JetBrains Mono` empaquetadas en un binario que se instala
con `npx` es peso real, y el ADR-0005 pide mantener el bundle modesto.

**Resolución:** subsetear a los glifos que se usan (el panel no necesita el juego
completo), formato `woff2`, y una pila de fallback del sistema decente para que
la primera pintura no dependa de la fuente. Nada de traerlas de Google Fonts en
runtime: el panel tiene que funcionar sin internet.

---

### H12 — Props del prototipo sin hogar

`density` y `showDescriptions` son preferencias reales; `accent` y `logRate` son
sólo del prototipo.

El diseño dice que los settings van en el archivo de config, no en una pantalla.
Coherente. **Resolución:** `density` y `showDescriptions` a `laqi.config.json`;
`accent` y `logRate` se descartan. Y la barra `PROTOTYPE STATES` no existe en
`packages/editor` — el propio `SCREENS.md` ya lo dice.

---

### H13 — Inconsistencias del prototipo

Cosméticas, pero conviene no copiarlas:

- **Fresh project** muestra los cinco escenarios con 0 endpoints cargados. Un
  escenario referencia endpoints; con cero endpoints la tira debería estar vacía
  o ausente.
- **Log vacío** muestra `Resume` (o sea, pausado) mientras dice "Waiting for
  requests…". Si está pausado no está esperando.
- El log muestra `2221ms` para la respuesta `slow`, que está declarada con
  `delay: 3000`.

---

## Preguntas abiertas

1. **H2** — ¿se adopta multi-archivo con claves `"METHOD /path"` + detección de
   colisión, y se escribe el ADR-0008? Es la única que bloquea empezar.
2. **H10** — ¿`mocks/` como nombre de carpeta? ¿Y el archivo único se llama
   `laqi.json` o `mocks.json`?
3. **H8** — ¿borrar endpoints desde el panel, o sólo editando el archivo?
4. **Autoría de escenarios** — F4 la deja explícitamente fuera del panel ("viven
   en el archivo de config"). Decisión razonable, pero entonces hay que definir
   dónde sí: ¿sólo a mano, o también por MCP y CLI? Se inclina a que el MCP
   tenga `create_scenario`, ya que el agente es quien mejor sabe qué endpoints
   toca un escenario.
