---
title: laqi v1 analysis
---

# laqi v1 analysis

**Date:** 2026-08-24
**Version analyzed:** 1.2.1 (commit `6c34c1b`)
**Method:** full reading of the code + actually running the server against
test cases built for the purpose. Bugs marked as _verified_ were reproduced
by running the server, not deduced by reading.

This document is the evidence that justifies [ADR-0001 (rewrite)](/decisions/0001-rewrite-v2/).

---

## 1. What laqi v1 was

A ~200-line JavaScript (CommonJS) mock server on top of Express 4. Four
files:

| File                   | Role                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `cli.js`               | Entry point. Four lines, no argument parsing.                |
| `src/index.js`         | Orchestration: loads config, starts server, watches files.   |
| `src/configuration.js` | Reads `mock.config.json` and walks `mock-data/` recursively. |
| `src/server.js`        | Builds the Express app and registers the endpoints.          |

The contract: you drop JSONs in `mock-data/`, run `npx laqi`, and you get
live endpoints at `localhost:8000`.

## 2. What worked (and is kept in v2)

**The response selector.** This is the idea that holds up, and the one that
justifies laqi existing at all given alternatives like `json-server` or
`msw`:

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

Each endpoint declares _several_ possible responses and `codeResponse`
chooses which one is active. That lets you test the frontend's error path
without touching code — which was the original problem: the backend isn't
ready and you need to see how your UI behaves with a 401.

Almost no mock server does this declaratively. It's the differentiator and
v2 keeps it, with a different syntax and without the limitations (see
[state resolution](/concepts/state-resolution/)).

**Everything else kept as an idea:**

- Hot-reload on file changes (chokidar). The intent was right.
- Nested folders to group endpoints.
- The `ip` field in the config, explicitly meant for mobile devs who can't
  use `localhost`. The instinct was good; the solution (binding to the LAN
  IP) fell short — see [ADR-0007](/decisions/0007-public-url/).
- The name. `llulla` (false) + `chasqui` (messenger) = **LAQI**, "false
  messenger". It stays.

## 3. What was broken

Twelve defects. The first five are **verified by running the server**.

### A. State leaking between requests — _verified_

`src/server.js:47` takes a **reference** to the JSON object loaded in
memory, and then **mutates** it:

```js
const body = response.body;          // reference, not a copy
if (Object.keys(req.query||[]).length > 0) body.query = req.query;   // MUTATES the config
```

The mutation is permanent. Data from one request leaks into every
subsequent one:

```
GET /post?leak=SECRET   ->  {"message":"OK","query":{"leak":"SECRET"}}
GET /post                ->  {"message":"OK","query":{"leak":"SECRET"}}   <-- leaked
```

It's the most serious of the twelve: it makes responses depend on request
history, which is exactly what a mock must never do.

### B. `return` where `continue` belonged — _verified_

`src/server.js:30`, inside a `for...in`:

```js
if (!endpoint) return;    // aborts the ENTIRE registration, not just this entry
```

A single invalid entry silently kills the registration of every remaining
endpoint.

```
{ "before": {...}, "broken": null, "after": {...} }

GET /before -> 200
GET /after  -> 404      <-- never registered
```

### C. Hung request — _verified_

If `codeResponse` doesn't match any `selectorCode`, the handler returns
without responding (`src/server.js:45`). The connection stays open until the
client's timeout.

```
curl -m 3 http://127.0.0.1:8000/hang  ->  http_code=000, time=3.006s
```

A typo in the selector name doesn't produce an error: it hangs the request.
It's the worst possible failure mode from a DX standpoint.

### D. Key collisions across files — _verified_

`loadData()` merges all files with `{...prev, ...curr}`. Two files that
define the same key: one silently wins.

**The repo itself has the broken example.** `mock-data/posts/get.json` and
`mock-data/posts/post.json` both define `"posts"`:

```
GET  /posts -> 404      <-- overwritten by post.json
POST /posts -> 200
```

That's why the `(get)files/:id` hack exists — but that hack only resolves
the collision _within_ a file, not across files.

### E. `(generate:uid)` was never implemented — _verified_

It appears in `mock-data/multi-endpoint.json` as if it were templating.
There isn't a single line of code that processes it (`grep` confirms zero
usages).

```
GET /files -> {"message":"OK","id":"(generate:uid)"}    <-- literal string
```

### F. The watcher ignores the configuration

`src/index.js:14` is `chokidar.watch('./mock-data')` — a hardcoded string.
If you configure `"path": "api-mocks"`, the server serves from there but
hot-reload watches a folder that doesn't exist. The main feature silently
stops working.

### G. The watcher only listens for `change`

`.on('change', ...)`. Creating a new file or deleting one reloads nothing.

### H. Restart with no debounce or error handling

Every change does `stop()` + a new app + `listen()`. Several events in a row
trigger concurrent `initialize` calls → `EADDRINUSE`. The handler is `async`
with no `catch`: any failure is an unhandled rejection.

### I. Status codes are strings

`res.status("200")`. It works by coercion in Express 4; **Express 5 throws**.
The migration to Express 5 was blocked.

### J. `yargs` is declared and never imported

It's a production dependency with zero usages. There's no CLI:
`laqi --port 3000` does nothing. The README lists it as pending
("Documented CLI").

### K. `nodemon` is in `dependencies`

Not in `devDependencies`. Everyone who runs `npm i laqi` installs the full
nodemon package — and with it, the critical vulnerability from section 4.3.

### L. Zero tests

`npm test` is `echo "Error: no test specified" && exit 1`.

## 4. What was dangerous

Running on `127.0.0.1` the real risk was low. **The important point is that
the v2 plan (public URL) turns every one of these into a real problem.**

### 4.1 CORS wide open

`src/server.js:19-20`:

```js
this.app.use(cors());          // Access-Control-Allow-Origin: *
this.app.options('*', cors());
```

On localhost it's irrelevant. With a public URL it means any web page on the
planet can send requests to the mock. And once record-and-replay against the
real backend exists, the mock is going to contain real data.

### 4.2 Authentication: none

There is none. The day there's a public URL, anyone with the link gets in.
Ephemeral tunnel URLs (`*.trycloudflare.com`, `*.ngrok.io`) are actively
scanned by bots.

**Consequence for v2:** when the server is public, a token is mandatory by
default and CORS is restricted. Not optional.

### 4.3 Nineteen dependency vulnerabilities, one critical

`npm audit` on the actual tree:

```
19 vulnerabilities (3 low, 5 moderate, 10 high, 1 critical)
```

- **`minimist` — prototype pollution (critical).** Comes in through the
  **nodemon** chain, which is in `dependencies` (defect K). It got installed
  onto users' machines.
- `semver` — ReDoS (high)
- `qs` — DoS via memory exhaustion
- `send` / `serve-static` — template injection → XSS

Express `4.17.2` is from 2021.

### 4.4 Path traversal in `path`

`src/configuration.js:43` passes `this.path` directly to `fs.readdirSync`
without validation. A `"path": "../../.."` walks the filesystem reading
every `.json` it finds.

Today it's self-inflicted — you write your own config — so the real
severity is low. It stops being low the moment the config ever comes from a
shared repo, a template, or the public URL.

### 4.5 Method injection

`src/server.js:40`:

```js
this.app[method](path, handler)   // 'method' comes from the JSON, no whitelist
```

A `"method": "constructor"` key invokes arbitrary properties of the Express
object. It's not RCE, but it's a trivial crash vector.

**Consequence for v2:** explicit whitelist of HTTP verbs, validated with Zod
at load time.

### 4.6 Routes are registered without sanitizing

The JSON keys go straight to the router. A `"*"` key registers a catch-all
that swallows everything else.

---

## 5. Conclusion

The core idea (declarative response selector) is good and survives. The
implementation has defects at its core — shared state mutation, broken flow
control, silent collisions — that aren't patches away but consequences of the
design: a flat data model merged with spread, and handlers writing over the
configuration they serve.

Fixing the twelve defects on this foundation costs more than rewriting 200
lines, and would leave the structural limitations intact (method encoded in
the key, single global state, no validation, no tests, CommonJS).

Hence [ADR-0001](/decisions/0001-rewrite-v2/).
