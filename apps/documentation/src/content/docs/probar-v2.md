---
title: Try laqi v2
---

# Try laqi v2

An end-to-end walkthrough, about 15 minutes, through everything v2 does:
serving mocks, the four resolution layers, the web panel, the API, the MCP
server and the public URL. Every step shows the exact command and what you
should see.

You need **Node 20+**. Bun is only needed to build from the repo (step 0); the
resulting binary runs on plain Node.

## 0. Build the binary

Until the package is published to npm, build it once from the repo:

```bash
git clone git@github.com:csdev19/laqi.git
cd laqi
bun install
bun run build
```

That leaves a self-contained CLI at `apps/cli/dist/index.mjs` — with the web
panel inside it. So you don't have to type the full path in every step:

```bash
alias laqi="node $(pwd)/apps/cli/dist/index.mjs"
```

> Once the package is on npm, everything below works the same with `npx laqi`
> and without this step.

## 1. A project with mocks

In any empty folder (outside the laqi repo):

```bash
mkdir demo && cd demo && mkdir laqi
```

`laqi/api.json` — the keys are `"METHOD /path"`:

```json
{
  "GET /users": {
    "description": "the people",
    "default": "ok",
    "responses": {
      "ok": { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "boom": { "status": 500, "body": { "message": "boom" } }
    }
  },
  "GET /users/:id": {
    "default": "found",
    "responses": {
      "found": { "status": 200, "body": { "id": 1, "name": "Ada" } },
      "missing": { "status": 404 }
    }
  },
  "POST /orders": {
    "default": "created",
    "responses": {
      "created": { "status": 201, "body": { "id": 9 } },
      "error": { "status": 500, "delay": 2000, "body": { "message": "nope" } }
    }
  }
}
```

`laqi/scenarios.json` — one scenario moves several endpoints at once:

```json
{
  "everything-broken": { "GET /users": "boom", "POST /orders": "error" },
  "new-user": { "GET /users": "empty" }
}
```

## 2. Start it and make a request

```bash
laqi
```

```
⚡ laqi  http://127.0.0.1:8000
   watching ./laqi/  ·  3 endpoints
```

From another terminal:

```bash
curl -i http://127.0.0.1:8000/users
```

Look at the **`X-Laqi-Resolved: ok (default)`** header: every response says
what was served and **which layer decided it**. That header is the thread
running through everything below.

```bash
curl http://127.0.0.1:8000/users/42        # :id is dynamic
curl -X POST http://127.0.0.1:8000/orders  # 201
curl http://127.0.0.1:8000/typo            # 404, listing the routes that do exist
```

## 3. The four layers, one at a time

Highest to lowest precedence: `header` → `state` → `scenario` → `default`.

**The `header` layer** — per request, persists nothing. This is how you try a
response without changing anyone's state:

```bash
curl -i -H 'X-Laqi-Response: boom' http://127.0.0.1:8000/users
# 500 · X-Laqi-Resolved: boom (header)
curl -i http://127.0.0.1:8000/users
# 200 again: nothing was left switched on
```

**The `state` layer** — a persistent per-endpoint override (this is what the
panel writes):

```bash
curl -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'Content-Type: application/json' \
  -d '{"scenario":null,"overrides":{"GET /users":"boom"}}'
curl -i http://127.0.0.1:8000/users
# 500 · X-Laqi-Resolved: boom (state)
```

That went into `.laqi/state.json` — a machine file, gitignored. Your mocks in
`laqi/` were not touched.

**The `scenario` layer**:

```bash
curl -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"new-user","overrides":{}}'
curl -i http://127.0.0.1:8000/users
# 200 [] · X-Laqi-Resolved: empty (scenario)
```

And the key rule: **a per-endpoint override beats the active scenario**. With
`new-user` active, add `"overrides":{"GET /users":"boom"}` and `/users` serves
`boom (state)` while the rest of the scenario stays in effect.

Back to a clean slate:

```bash
curl -X PUT http://127.0.0.1:8000/__laqi/api/state \
  -H 'Content-Type: application/json' -d '{"scenario":null,"overrides":{}}'
```

## 4. The panel

Open **http://127.0.0.1:8000/__laqi** in a browser. Everything from step 3,
without curl:

- **One click on a chip** makes that response live. The row tints magenta and
  reads `state`. Click the chip that is the file's own default and the
  override is removed rather than rewritten as an identical one.
- **The scenario chips** at the top: activate `everything-broken` and watch
  how many rows tint violet.
- **The log on the right** shows every request live — fire the curls from
  step 2 and watch them land. A path that does not exist shows in red with
  `no matching route`. Clicking a row jumps to the endpoint that served it.
- **`⌘K`** (or `Ctrl+K`): type `orders error` and ↵ — that flipped
  `POST /orders` without touching the mouse.
- **Click a path** to open the detail view: edit the body, the status or the
  delay and save — it is written back to `laqi/api.json`. There is also a
  ready-made `curl` with `X-Laqi-Response` to copy.
- **Hot-reload**: edit `laqi/api.json` by hand in your editor and watch the
  panel update on its own, with nothing restarting.

## 5. The same control, from a coding agent (MCP)

In the `demo` directory, create `.mcp.json` (Claude Code; Cursor uses the same
shape):

```json
{
  "mcpServers": {
    "laqi": {
      "command": "node",
      "args": ["<path-to-the-laqi-repo>/apps/cli/dist/index.mjs", "mcp"]
    }
  }
}
```

Open Claude Code in `demo` and ask it for things like:

> "make `/orders` return the error with two seconds of latency"
> "create a `GET /profile` endpoint returning an example user"
> "activate the everything-broken scenario"
> "import this OpenAPI spec as mocks"

The nine tools (`list_endpoints`, `set_response`, `set_scenario`,
`create_endpoint`, `import_openapi`, …) write the same files the panel does —
you can leave the panel open and watch the agent's changes appear live. It
works even with laqi stopped: the mocks are ready for when you start it.

## 6. Types and data from the panel

Back in the panel, click **`+ New endpoint`**, then the toggle next to the
path field to switch it from `blank` to **`from a model`**. Pick `POST`, path
`/todos`, and paste a real-world-ish interface into the box that appears:

```ts
export interface Todo {
  id: number
  title: string
  completed: boolean
  createdAt: string
}
```

Click **Create**. The endpoint is written to `laqi/api.json` immediately,
with a response body already filled with seeded data generated from that
shape — `title` reads like a real sentence, `createdAt` is a date, `id` is
sequential — and the panel drops you straight into the endpoint's detail
view.

From there:

- **Copy types** — pick `typescript-zod` from the language dropdown next to
  the button and click it: a Zod schema for `Todo` lands on your clipboard,
  derived from the body you are looking at right now, not from the interface
  you pasted (laqi never stores that).
- **Regenerate** — refills the body draft with a fresh set of random values
  from the same shape. Nothing is written yet; the save button switches to
  **`Save to file`**.
- Click **`Save to file`** to write the regenerated body back to
  `laqi/api.json`, the same path any other edit in the panel takes.

`generate_data` and `get_types` are the MCP versions of these two moves — the
same agent from the previous step can paste a model and hand you types
without opening the panel at all.

## 7. Public URL

Needs [`cloudflared`](https://github.com/cloudflare/cloudflared) on your PATH
(`brew install cloudflared` — no account, no login):

```bash
laqi --share
```

```
🌐 EXPOSED TO THE INTERNET  https://<something>.trycloudflare.com
   mocks only — the panel and the control plane stay on 127.0.0.1:8000

   token  3f9a…
   curl -H 'Authorization: Bearer 3f9a…' https://<something>.trycloudflare.com/
```

Three things worth checking yourself:

```bash
# 1. The mocks come through, with the token:
curl -H 'Authorization: Bearer <token>' https://<something>.trycloudflare.com/users
# 2. Without a token: 401.
curl https://<something>.trycloudflare.com/users
# 3. The panel does NOT exist on the public URL — 404, even with the token:
curl -H 'Authorization: Bearer <token>' https://<something>.trycloudflare.com/__laqi/api/status
```

That URL is what you give a physical phone running React Native, Expo Go on
mobile data, or a teammate on another network. You keep using the panel on
your own `localhost`, and flips show up on the public URL immediately.

## 8. A real frontend against the mock

Everything above was curl and the panel. To see laqi doing its actual job,
there is [`examples/todo-app`](https://github.com/csdev19/laqi/tree/main/examples/todo-app):
a TanStack Start app with a paginated todo list, CRUD, a profile page and a
login flow.

Two terminals, from `examples/todo-app`:

```bash
bun run mock   # laqi and its panel
bun run dev    # the frontend
```

Open the panel next to the app and flip responses while you use it. Nothing
restarts:

| Flip this | And the app… |
| --- | --- |
| `GET /todos` → `error` | shows its error state with a retry button |
| `GET /todos` → `empty` | shows the empty state |
| `GET /todos` → `one-page` | drops to three items and the pager disappears |
| `GET /todos` → `slow` | shows the loading state, held for 2.5s |
| `GET /profile` → `unauthorized` | signs you out, the way a real 401 would |
| scenario `backend-caido` | breaks every endpoint at once |

Those are exactly the states that are painful to reach against a real backend,
and here they are one click away.

## 9. Migrating a v1 project

If you have an old project with `mock.config.json` / `mock-data/`:

```bash
laqi migrate --dry-run   # prints the resulting laqi.json without writing
laqi migrate             # writes it
```

## If something does not work

- **`/__laqi` shows "not built yet"** → you ran from source without building
  the panel: `bun run build --filter=@laqi/editor` (the `dist/` binary does
  not have this problem).
- **A broken mock file** does not take the server down: the rest keeps being
  served, and the panel shows a red band with the file, line and cause.
- **`--share` asks for cloudflared** → the error message carries the install
  command for each platform.
- **The port is in use** → `laqi --port 8001`.
