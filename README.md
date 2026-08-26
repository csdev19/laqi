# LAQI

⚡⚡ Laqi is a mock server to speed up frontend development ⚡⚡

> **Status: v2, pre-release.** This README describes the code as it exists on
> this branch today. The packaged `npx laqi` binary is **not available yet**
> (it needs a `tsdown` build and a `bin` entry that runs under plain Node —
> that's deferred to a later plan). Until then, run it with Bun straight from
> source, as shown below.

## Monorepo layout

```
packages/schema   — Zod schemas: config, endpoint, response, scenarios, state
packages/core     — loading mocks from disk, route table, resolution, state store
packages/server   — the Hono app that actually serves mock responses
packages/editor   — the web control panel (React + Vite), served at /__laqi
apps/cli          — the `laqi` CLI: serve, watch, migrate
apps/documentation — the docs site (Astro + Starlight)
```

## Running it

From inside a project that has mock files (see below), run:

```
bun <path-to-this-repo>/apps/cli/src/index.ts
```

That starts a server on `http://127.0.0.1:8000` by default, serving whatever
is declared under `./laqi/` or `./laqi.json` in your current directory, and
watches for changes to reload automatically.

The web panel lives at `http://127.0.0.1:8000/__laqi`. It ships as a Vite
build that is not committed, so build it once first:

```
bun run build --filter=@laqi/editor
```

Until you do, `/__laqi` answers with a page telling you exactly that — the
mock server itself works either way.

Useful flags:

```
  --port <number>      port to listen on          (default 8000)
  --host <address>     address to bind            (default 127.0.0.1)
  --dir <path>         mocks folder               (default laqi)
  --file <path>        single mock file           (default laqi.json)
  --help                show usage
```

Configuration can also live in a `laqi.config.json` file at your project
root, with the same keys (`port`, `host`, `dir`, `file`, plus `cors`,
`density`, `showDescriptions`).

### Migrating from v1

If you have an old `mock.config.json` / `mock-data/` project, run:

```
bun <path-to-this-repo>/apps/cli/src/index.ts migrate --dry-run
```

to preview the converted `laqi.json`, or drop `--dry-run` to write it.

## Mock file format

Mocks live either in a `laqi/` folder (any number of `*.json` files,
nested folders allowed) or in a single `laqi.json` file — the folder wins if
both exist. Each file is a JSON object whose keys are `"METHOD /path"`:

```json
{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok": { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "error": { "status": 500, "body": { "message": "boom" } }
    }
  },
  "GET /users/:id": {
    "default": "found",
    "responses": {
      "found": { "status": 200, "body": { "id": 1, "name": "Ada" } },
      "missing": { "status": 404 }
    }
  }
}
```

- `default` picks which named response is served when nothing else says
  otherwise.
- Each response can set `status`, `body`, `delay` (ms), and `headers`.
- `:param` segments in a path are dynamic, matched by Hono's router.

A special `scenarios.json` file (at the top of the `laqi/` folder) maps a
scenario name to a set of endpoint → response-name overrides, so you can
flip several endpoints at once:

```json
{
  "checkout-broken": {
    "GET /cart": "empty",
    "POST /checkout": "error"
  }
}
```

## How a response gets picked

For every request, laqi resolves which named response to serve by checking
four layers, in this order — the first one that applies wins:

1. **header** — an explicit `X-Laqi-Response: <name>` (or
   `X-Laqi-Scenario: <name>`) request header. Doesn't persist anything.
2. **state** — a per-endpoint override, written to `.laqi/state.json` via
   the control plane API below (a web panel or MCP server, in a later
   plan, will write there too).
3. **scenario** — the currently active scenario from `scenarios.json`, if
   one is set in state.
4. **default** — the endpoint's own `default` response. Always available,
   so a fresh project with no state always has something to serve.

Every response carries an `X-Laqi-Resolved: <name> (<layer>)` header so you
can always see which layer decided it.

## The control panel

`/__laqi` is a local web panel over the same API described below. It is the
fastest way to do the frequent thing — flip which response an endpoint serves —
without touching a file or restarting anything.

- **One click per flip.** Every response is a visible chip on its endpoint's
  row; clicking one makes it live. Clicking the file's own default again
  removes the override rather than writing an identical one.
- **The list says what you changed.** Rows overridden by you tint magenta,
  rows moved by a scenario tint violet, and each row names the layer that
  decided it — the same four words the `X-Laqi-Resolved` header uses.
- **A live request log** sits beside the list, never behind a tab. Requests
  that matched no route get the loudest row in the pane, because "why is my
  mock not answering?" is the most common confusion. Clicking a row jumps to
  the endpoint that served it.
- **`⌘K`** reaches any endpoint/response pair by name: `orders boom` flips
  `POST /orders` to its `boom` response without touching the mouse.
- **Endpoint detail** edits the definition itself — status, delay, body,
  response names — and writes it back to the file it came from. It also hands
  you a ready-made `curl` carrying `X-Laqi-Response`.

The panel is served only when laqi is listening on loopback. With
`--host 0.0.0.0` neither the panel nor the API is mounted.

## Control plane API

Alongside the mocks, `laqi` serves a small HTTP + SSE API under `/__laqi`,
local-only by default:

```
GET    /__laqi/api/endpoints          list loaded endpoints
POST   /__laqi/api/endpoints          create one
PUT    /__laqi/api/endpoints/:id      update one (:id is URL-encoded, e.g. "GET /users")
DELETE /__laqi/api/endpoints/:id      delete one
GET    /__laqi/api/state              read the active overrides + scenario
PUT    /__laqi/api/state              flip them
GET    /__laqi/api/scenarios          read scenarios.json (read-only — edit the file to author one)
GET    /__laqi/api/status             what's being watched, endpoint count, load errors
GET    /__laqi/events                 live SSE stream: request | endpoints-changed | error
```

Every write goes through the same file it would if you'd hand-edited it,
and reloads immediately — no restart, no waiting on the file watcher. This
API has no authentication yet; it's withheld automatically unless `--host`
is left at its loopback default. The web panel above consumes it; an MCP
server is on the roadmap.

The SSE stream carries every request the mock server answers, including the
ones that matched no route (`endpointId` is `null` on those, and they carry
no resolution because nothing resolved them).

## Why that name?

The name is composed of 2 Quechua words [llul**LA**](https://es.glosbe.com/quz/es/llulla) (meaning false) and [chas**Q**u**I**](https://es.glosbe.com/qu/es/chaski) (referring to a messenger) that together I give the meaning of "false-messenger" (l**L**ull**A** + chas**Q**u**I** = **LAQI**) for being a server that returns simulated or false information. Also that in English sounds like the word **"lucky"** 😃😃.

On spanish [here](apps/documentation/src/content/docs/nombre.md)

## Contributors

- Cristian Sotomayor [@csdev19](https://github.com/csdev19) - Creator
