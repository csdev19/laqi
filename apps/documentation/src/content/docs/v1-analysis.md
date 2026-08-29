---
title: Análisis de laqi v1
---

# Análisis de laqi v1

**Fecha:** 2026-08-24
**Versión analizada:** 1.2.1 (commit `6c34c1b`)
**Método:** lectura completa del código + ejecución real del servidor contra
casos de prueba construidos a propósito. Los bugs marcados como _verificados_
se reprodujeron corriendo el servidor, no se dedujeron leyendo.

Este documento es la evidencia que justifica el [ADR-0001 (rewrite)](/decisions/0001-rewrite-v2/).

---

## 1. Qué era laqi v1

Un mock server de ~200 líneas de JavaScript (CommonJS) sobre Express 4. Cuatro
archivos:

| Archivo                | Rol                                                           |
| ---------------------- | ------------------------------------------------------------- |
| `cli.js`               | Entry point. Cuatro líneas, sin parsing de argumentos.        |
| `src/index.js`         | Orquestación: carga config, levanta server, observa archivos. |
| `src/configuration.js` | Lee `mock.config.json` y recorre `mock-data/` recursivamente. |
| `src/server.js`        | Construye la app Express y registra los endpoints.            |

El contrato: pones JSONs en `mock-data/`, corres `npx laqi`, y tienes endpoints
vivos en `localhost:8000`.

## 2. Qué servía (y se conserva en v2)

**El selector de respuestas.** Ésta es la idea que vale y la que justifica que
laqi exista habiendo alternativas como `json-server` o `msw`:

```json
{
  "post": {
    "method": "GET",
    "codeResponse": "200",
    "responses": [
      { "statusCode": "200", "selectorCode": "200",      "body": { "message": "OK" } },
      { "statusCode": "400", "selectorCode": "error400", "body": { "code": "error1" } },
      { "statusCode": "401", "selectorCode": "error401", "body": { "code": "error2" } }
    ]
  }
}
```

Cada endpoint declara _varias_ respuestas posibles y `codeResponse` elige cuál
está activa. Eso permite probar el camino de error del frontend sin tocar código
— que era el problema original: el backend no está listo y necesitas ver cómo se
comporta tu UI con un 401.

Casi ningún mock server hace esto de forma declarativa. Es el diferenciador y v2
lo mantiene, con otra sintaxis y sin las limitaciones (ver
[resolución de estado](/concepts/state-resolution/)).

**Lo demás que se conserva como idea:**

- Hot-reload al cambiar archivos (chokidar). La intención era correcta.
- Carpetas anidadas para agrupar endpoints.
- El campo `ip` en la config, pensado explícitamente para devs mobile que no
  pueden usar `localhost`. La intuición era buena; la solución (bindear a la IP
  de LAN) se quedaba corta — ver [ADR-0007](/decisions/0007-public-url/).
- El nombre. `llulla` (falso) + `chasqui` (mensajero) = **LAQI**, "falso
  mensajero". Se queda.

## 3. Qué estaba roto

Doce defectos. Los cinco primeros están **verificados ejecutando el servidor**.

### A. Fuga de estado entre requests — _verificado_

`src/server.js:47` toma una **referencia** al objeto del JSON cargado en memoria,
y luego lo **muta**:

```js
const body = response.body;          // referencia, no copia
if (Object.keys(req.query||[]).length > 0) body.query = req.query;   // MUTA la config
```

La mutación es permanente. El dato de un request se filtra a todos los siguientes:

```
GET /post?leak=SECRETO  ->  {"message":"OK","query":{"leak":"SECRETO"}}
GET /post               ->  {"message":"OK","query":{"leak":"SECRETO"}}   <-- filtrado
```

Es el más grave de los doce: hace que las respuestas dependan del historial de
requests, que es exactamente lo que un mock no debe hacer.

### B. `return` donde iba `continue` — _verificado_

`src/server.js:30`, dentro de un `for...in`:

```js
if (!endpoint) return;    // aborta TODO el registro, no sólo esta entrada
```

Una sola entrada inválida mata el registro de todos los endpoints restantes, en
silencio.

```
{ "antes": {...}, "roto": null, "despues": {...} }

GET /antes   -> 200
GET /despues -> 404      <-- nunca se registró
```

### C. Request colgada — _verificado_

Si `codeResponse` no coincide con ningún `selectorCode`, el handler retorna sin
responder (`src/server.js:45`). La conexión queda abierta hasta el timeout del
cliente.

```
curl -m 3 http://127.0.0.1:8000/cuelgue  ->  http_code=000, time=3.006s
```

Un typo en el nombre del selector no da error: cuelga la request. Es el peor
modo de fallo posible desde el punto de vista de DX.

### D. Colisión de claves entre archivos — _verificado_

`loadData()` fusiona todos los archivos con `{...prev, ...curr}`. Dos archivos
que definan la misma clave: uno gana en silencio.

**El propio repo tiene el ejemplo roto.** `mock-data/posts/get.json` y
`mock-data/posts/post.json` ambos definen `"posts"`:

```
GET  /posts -> 404      <-- lo pisó post.json
POST /posts -> 200
```

Es la razón por la que se inventó el hack `(get)files/:id` — pero ese hack sólo
resuelve la colisión _dentro_ de un archivo, no entre archivos.

### E. `(generate:uid)` nunca se implementó — _verificado_

Aparece en `mock-data/multi-endpoint.json` como si fuera templating. No hay una
sola línea de código que lo procese (`grep` confirma cero usos).

```
GET /files -> {"message":"OK","id":"(generate:uid)"}    <-- string literal
```

### F. El watcher ignora la configuración

`src/index.js:14` es `chokidar.watch('./mock-data')` — string hardcodeado. Si
configuras `"path": "api-mocks"`, el servidor sirve desde ahí pero el hot-reload
observa una carpeta que no existe. La feature principal deja de funcionar sin
avisar.

### G. El watcher sólo escucha `change`

`.on('change', ...)`. Crear un archivo nuevo o borrar uno no recarga nada.

### H. Reinicio sin debounce ni manejo de errores

Cada cambio hace `stop()` + nueva app + `listen()`. Varios eventos seguidos
disparan `initialize` concurrentes → `EADDRINUSE`. El handler es `async` y no
tiene `catch`: cualquier fallo es una unhandled rejection.

### I. Los status codes son strings

`res.status("200")`. Funciona por coerción en Express 4; **Express 5 lanza
excepción**. La migración a Express 5 estaba bloqueada.

### J. `yargs` está declarado y nunca se importa

Es dependencia de producción con cero usos. No existe CLI: `laqi --port 3000` no
hace nada. El README lo lista como pendiente ("Documented CLI").

### K. `nodemon` está en `dependencies`

No en `devDependencies`. Todo el que hace `npm i laqi` se instala nodemon
completo — y con él, la vulnerabilidad crítica del punto 4.3.

### L. Cero tests

`npm test` es `echo "Error: no test specified" && exit 1`.

## 4. Qué era peligroso

Corriendo en `127.0.0.1` el riesgo real era bajo. **El punto importante es que
el plan de v2 (URL pública) convierte cada uno de estos en un problema real.**

### 4.1 CORS totalmente abierto

`src/server.js:19-20`:

```js
this.app.use(cors());          // Access-Control-Allow-Origin: *
this.app.options('*', cors());
```

En localhost es irrelevante. Con URL pública significa que cualquier página web
del planeta puede hacerle requests al mock. Y en cuanto exista record-and-replay
contra el backend real, el mock va a contener datos reales.

### 4.2 Autenticación: ninguna

No existe. El día que hay URL pública, cualquiera con el link entra. Las URLs de
túnel efímero (`*.trycloudflare.com`, `*.ngrok.io`) son escaneadas activamente
por bots.

**Consecuencia para v2:** cuando el servidor es público, token obligatorio por
defecto y CORS restringido. No opcional.

### 4.3 Diecinueve vulnerabilidades en dependencias, una crítica

`npm audit` sobre el árbol real:

```
19 vulnerabilities (3 low, 5 moderate, 10 high, 1 critical)
```

- **`minimist` — prototype pollution (crítica).** Entra por la cadena de
  **nodemon**, que está en `dependencies` (defecto K). Se le instalaba a los
  usuarios.
- `semver` — ReDoS (alta)
- `qs` — DoS por agotamiento de memoria
- `send` / `serve-static` — template injection → XSS

Express `4.17.2` es de 2021.

### 4.4 Path traversal en `path`

`src/configuration.js:43` pasa `this.path` directo a `fs.readdirSync` sin
validar. Un `"path": "../../.."` recorre el filesystem leyendo todo `.json` que
encuentre.

Hoy es auto-infligido — tú escribes tu propia config — así que la severidad real
es baja. Deja de serlo si la config alguna vez viene de un repo compartido, de un
template, o de la URL pública.

### 4.5 Inyección de método

`src/server.js:40`:

```js
this.app[method](path, handler)   // 'method' viene del JSON, sin whitelist
```

Una clave `"method": "constructor"` invoca propiedades arbitrarias del objeto
Express. No es RCE, pero es un crash-vector trivial.

**Consecuencia para v2:** whitelist explícita de verbos HTTP, validada con Zod al
cargar.

### 4.6 Las rutas se registran sin sanitizar

Las claves del JSON van directo al router. Una clave `"*"` registra un catch-all
que se traga todo lo demás.

---

## 5. Conclusión

La idea central (selector declarativo de respuestas) es buena y sobrevive. La
implementación tiene defectos en su núcleo — mutación de estado compartido,
control de flujo roto, colisiones silenciosas — que no son parches sino
consecuencias del diseño: un modelo de datos plano fusionado con spread, y
handlers que escriben sobre la configuración que sirven.

Arreglar los doce defectos sobre esta base cuesta más que reescribir 200 líneas,
y dejaría intactas las limitaciones estructurales (método codificado en la clave,
estado global único, sin validación, sin tests, CommonJS).

De ahí el [ADR-0001](/decisions/0001-rewrite-v2/).
