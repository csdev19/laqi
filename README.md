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
apps/cli          — the `laqi` CLI: serve, watch, migrate
```

## Running it

From inside a project that has mock files (see below), run:

```
bun <path-to-this-repo>/apps/cli/src/index.ts
```

That starts a server on `http://127.0.0.1:8000` by default, serving whatever
is declared under `./laqi/` or `./laqi.json` in your current directory, and
watches for changes to reload automatically.

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
2. **state** — a per-endpoint override, written to `.laqi/state.json` (by a
   future control panel or MCP server — not built yet on this branch).
3. **scenario** — the currently active scenario from `scenarios.json`, if
   one is set in state.
4. **default** — the endpoint's own `default` response. Always available,
   so a fresh project with no state always has something to serve.

Every response carries an `X-Laqi-Resolved: <name> (<layer>)` header so you
can always see which layer decided it.

## Why that name?

The name is composed of 2 Quechua words [llul**LA**](https://es.glosbe.com/quz/es/llulla) (meaning false) and [chas**Q**u**I**](https://es.glosbe.com/qu/es/chaski) (referring to a messenger) that together I give the meaning of "false-messenger" (l**L**ull**A** + chas**Q**u**I** = **LAQI**) for being a server that returns simulated or false information. Also that in English sounds like the word **"lucky"** 😃😃.

On spanish [here](documentacion/name.md)

## Contributors

- Cristian Sotomayor [@csdev19](https://github.com/csdev19) - Creator
