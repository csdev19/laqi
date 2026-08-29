# LAQI

⚡⚡ Laqi is a mock server to speed up frontend development ⚡⚡

> **Status: v2, unreleased.** Once `2.0.0` is published, `laqi` on npm is
> this v2. Until that release, plain `laqi` is still the unrelated 1.2.1
> from 2022. See [Releasing](#releasing) for what "once published" means.
>
> ```
> bunx laqi        # or: npx laqi — once 2.0.0 ships
> ```

**Want to try it?** There is a [15-minute hands-on walkthrough](apps/documentation/src/content/docs/probar-v2.md)
covering everything: serving mocks, the four resolution layers, the web
panel, driving it from a coding agent over MCP, and the public URL.

**Want to see it used?** [`examples/todo-app`](examples/todo-app) is a
TanStack Start frontend built against laqi — todo list with pagination and
CRUD, a profile page, and a login flow. Run the two side by side and flip
responses in the panel while the app is open.

## Monorepo layout

```
packages/schema   — Zod schemas: config, endpoint, response, scenarios, state
packages/core     — loading mocks from disk, route table, resolution, state store
packages/server   — the Hono app that actually serves mock responses
packages/editor   — the web control panel (React + Vite), served at /__laqi
packages/mcp      — the MCP server, for coding agents
apps/cli          — the `laqi` CLI: serve, watch, migrate, mcp
examples/todo-app — a TanStack Start frontend built against laqi
apps/documentation — the docs site (Astro + Starlight)
```

## Running it

Once `2.0.0` is published (see [Releasing](#releasing)), from inside
a project that has mock files (see below):

```
npx laqi
```

Until that release, `laqi` still resolves to the unrelated 1.2.1 — build it
from this repo and use the binary it produces:

```
bun install
bun run build
node <path-to-this-repo>/apps/cli/dist/index.mjs
```

`bun run build` builds the panel first and bundles it into the CLI, so the
binary is self-contained and runs on plain Node 20+ with no Bun involved.

Either way that starts a server on `http://127.0.0.1:8000`, serving whatever
is declared under `./laqi/` or `./laqi.json` in your current directory, and
watches for changes to reload automatically. The web panel is at
`http://127.0.0.1:8000/__laqi`.

During development on laqi itself you can skip the build and run the source
directly with `bun apps/cli/src/index.ts` — the panel then needs
`bun run build --filter=@laqi/editor` once, and says so if you forget.

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

If you have an old `mock.config.json` / `mock-data/` project, run (once the
`2.0.0` is published — see [Releasing](#releasing); until then, use the
locally built binary as shown above with `migrate --dry-run` appended):

```
npx laqi migrate --dry-run
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
is left at its loopback default. The web panel above consumes it, and so
does the MCP server described below.

The SSE stream carries every request the mock server answers, including the
ones that matched no route (`endpointId` is `null` on those, and they carry
no resolution because nothing resolved them).

## Sharing it publicly

`localhost` is not reachable from a physical phone, from Expo Go on mobile
data, or from a teammate on another network — which is the problem that
started this rewrite. `laqi --share` opens a public URL to your mocks:

```
laqi --share
```

It needs [`cloudflared`](https://github.com/cloudflare/cloudflared) on your
PATH (`brew install cloudflared`; no account, no login). laqi prints the URL,
a bearer token, and a ready-to-paste `curl`.

**What goes through the tunnel is only the mocks.** The panel and the control
plane live on a second, local-only listener — they are not protected behind
the tunnel, they are not on it at all, and every `/__laqi` path answers 404
through the public URL. Someone having your mock URL can never mean they can
rewrite your mock files.

The rest of what shared mode turns on:

- **A bearer token is required.** Every request without
  `Authorization: Bearer <token>` gets 401. `--share --public` turns that off
  and says loudly that it did.
- **CORS is never `*`.** Only origins declared in `laqi.config.json` as
  `"cors": ["https://your.app"]` are allowed. With the default config no
  browser origin is allowed at all — `curl` and React Native do not send
  `Origin`, so they are unaffected.
- **Rate limiting**, per caller and overall.

```
  --share              open a public URL to the mocks
  --public             with --share: no token. Anyone with the URL can read
                       your mocks.
  --share-port <n>     local port the tunnel points at (default: port + 1)
```

## Using it from a coding agent (MCP)

`laqi mcp` runs an MCP server over stdio, so an agent building a screen can
create the endpoints it needs, flip responses, and activate scenarios without
you opening a file.

Point your agent at the project directory — the server operates on the mock
files there, so it works whether or not `laqi` is currently running.

```json
{
  "mcpServers": {
    "laqi": {
      "command": "npx",
      "args": ["laqi", "mcp"],
      "cwd": "<your-project>"
    }
  }
}
```

That config works once `2.0.0` is published (see
[Releasing](#releasing)) — before that, `laqi` still resolves to the
unrelated 1.2.1. In Claude Code this
goes in `.mcp.json` at your project root; Cursor uses the same shape. Right
now, and whenever you're developing laqi itself, point `command` at the built
binary instead (`node`, with the path to `dist/index.mjs` and `mcp` as
args).

Tools: `list_endpoints`, `get_state`, `set_response`, `set_scenario`,
`reset_state`, `create_endpoint`, `update_endpoint`, `delete_endpoint`,
`import_openapi`.

`import_openapi` turns an OpenAPI 3.x document into mocks, generating example
bodies from the schemas. It takes JSON (convert YAML first), never overwrites
an existing endpoint unless you ask, and reports whatever it skipped and why
rather than failing the whole import.

## Generate types and data

The panel closes the loop around the data model in both directions:

- **Data → types.** Every endpoint detail has a _Copy types_ button with a
  language dropdown — TypeScript, Zod, Swift, Kotlin, Dart, Python, Go and
  twenty more. Types are derived from the live response body on demand, so
  they can never go stale.
- **Model → data.** Paste a TypeScript interface (a dirty real-world one is
  fine — `extends`, `Pick`, imports from libraries that are not present) and
  laqi generates realistic seeded data from it: `email` fields get emails,
  `createdAt` gets dates, ids are sequential. _Regenerate_ on any response
  re-randomises the values from the shape the data already has.

The same two operations are MCP tools (`get_types`, `generate_data`), so an
agent can do the whole thing: paste the model from the backend discussion,
mount the mock, hand you the types.

Nothing is ever persisted except ordinary mock JSON — generated data lands in
your `laqi/` files through the same write path as the editor, and models are
never stored (types come from the data, not from a saved schema).

## Why that name?

The name is composed of 2 Quechua words [llul**LA**](https://es.glosbe.com/quz/es/llulla) (meaning false) and [chas**Q**u**I**](https://es.glosbe.com/qu/es/chaski) (referring to a messenger) that together I give the meaning of "false-messenger" (l**L**ull**A** + chas**Q**u**I** = **LAQI**) for being a server that returns simulated or false information. Also that in English sounds like the word **"lucky"** 😃😃.

On spanish [here](apps/documentation/src/content/docs/nombre.md)

## Contributors

- Cristian Sotomayor [@csdev19](https://github.com/csdev19) - Creator

## Releasing

Releases are cut by [release-please](https://github.com/googleapis/release-please)
and published by GitHub Actions. Nobody publishes from a laptop.

1. Merge normal PRs into `main` with Conventional Commit titles.
2. release-please maintains a rolling **release PR** that accumulates the
   changelog and recomputes the version. Read it.
3. **Merging that release PR is the act of releasing.** It bumps
   `apps/cli/package.json`, writes `CHANGELOG.md`, and pushes a `v*` tag.
4. The tag triggers `release-npm.yml`, which builds and publishes.

**The first release is `2.0.0`.** The manifest seeds `1.2.1` (the last
version actually published) so release-please computes forward from there,
and the commit that adopted this pipeline (`df765c9`) is a `feat!`, so the
first release PR proposes `2.0.0`. Merging it publishes v2 to `latest` —
that merge is the act of going to production, and it replaces the 2022 v1
for every `npx laqi` user. Do not merge it before meaning it.

The dist-tag is derived from the version: anything with a `-` goes to its
prerelease tag, anything else to `latest`. See
[ADR-0010](apps/documentation/src/content/docs/decisiones/0010-release-y-npm.md).

To rehearse the pipeline without publishing, run **Publish to npm** from the
Actions tab with `dry_run` checked.

### Setup, once

Two secrets in the repository's `production` environment:

| Secret                 | What                                                  | Why                                                                   |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `RELEASE_PLEASE_TOKEN` | Fine-grained PAT, Contents + Pull requests read/write | A tag pushed by the default `GITHUB_TOKEN` does not trigger workflows |
| `NPM_TOKEN`            | npm granular token, read/write on `laqi` only         | Publishing                                                            |
