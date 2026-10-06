---
title: Examples, sandboxes and an agent-first CLI — design spec
---

# Examples, sandboxes and an agent-first CLI — design spec

**Status:** Draft. Decisions taken with Cristian on 2026-10-05. Open questions are at the end.
**Date:** 2026-10-05

This is the umbrella spec. It covers three pieces that only make sense together; two of them have
their own page:

| Piece | What it is                                                                                          | Spec                                        |
| ----- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1     | `bun run try`: a disposable sandbox, outside the repo, with a packed laqi installed in it           | [try-sandboxes](/design/try-sandboxes/)     |
| 2     | CLI verbs that mirror the MCP tools 1:1, so an agent without MCP can do everything from a shell     | [agent-first-cli](/design/agent-first-cli/) |
| 3     | Five examples, each exercising a different CLI surface, with a coverage matrix that is a smoke test | this page                                   |

## The problem

laqi has one example, [`examples/todo-app`](https://github.com/csdev19/laqi/tree/main/examples/todo-app):
TanStack Start, auth, a paginated list and CRUD, all through a Vite proxy. It covers one way of
calling laqi, and nothing in the repo lets us watch an agent build a screen with laqi from zero.

People reach laqi from three places, and each fails in its own way:

1. **A plain `fetch` from the browser.** Base URL, CORS, and the loading/empty/error states.
2. **A server-side fetch** (Next.js, Astro SSR). The server process is laqi's client: no proxy,
   `LAQI_URL` must reach Node, and caching can hide a flipped response.
3. **An agent building a screen.** "A customers table with create, edit and delete" should end with
   the agent creating the endpoints, data and types through laqi, with no human writing JSON.

The third is the bet ([agent-facing-docs](/design/agent-facing-docs/)). Today it only works over
MCP: `create_endpoint`, `generate_data` and `get_types` have no CLI equivalent. And there is no
cheap, repeatable way to hand an agent a fresh project and look at what it produced. Pieces 1 and 2
fix that; piece 3 is where it becomes visible.

## How the pieces fit

```
examples/<name>/            reference app (committed, workspace member)
examples/<name>/starter/    overlay: the few files that differ in the starter
examples/<name>/try.json    how to derive the starter, ports, what try:report checks

bun run try crud-table --from starter --name claude   → sandbox in $TMPDIR/laqi-tries/claude
bun run try crud-table --from starter --name codex    → a second one, its own ports
  → the agent works there, over MCP or over the CLI verbs (piece 2)
bun run try:report claude                              → what it built vs the reference
```

- The **reference** proves the example works and is what CI smoke-tests
  (`try --from reference`, build, a `curl` against laqi).
- The **starter** is what an agent or a person starts from. It is derived, not maintained.
- The **CLI verbs** make the CLI-only path real, so "MCP vs CLI-only" is a comparison we can run.

## Piece 3 — the examples

Every example is a workspace member named `@laqi/example-<name>`, has `mock` / `mock:dev` scripts
like `todo-app`, reads its ports from the environment (never hard-coded, so `try` can allocate
them), and has a README with three sections: **Run it**, **The thing worth trying** (the flip
table) and **Ask your agent** (copy-paste prompts).

```
examples/
  README.md      one line per example: "use this when…"
  fetch-basic/   Vite + vanilla TS, plain fetch
  next-ssr/      Next.js App Router, server components fetch laqi
  astro-ssr/     Astro SSR, mocks imported from OpenAPI
  crud-table/    React admin table, built by an agent from an empty laqi/
  todo-app/      (exists) TanStack Start, auth + CRUD through a Vite proxy
```

### `fetch-basic` — the smallest thing, and `laqi init`

- **CLI surface:** `laqi init --from example --script --open`, folder vs single file, `cors`, the
  `X-Laqi-Response` header.
- `index.html` plus one `main.ts`. It consumes **exactly what `laqi init --from example` writes**
  (`GET /todos` with `ok`, `empty` and `error`, plus the `offline` and `empty-state` scenarios), so
  the README's first command produces a working app with no hand-written JSON. The reference adds a
  `slow` response (`delay: 2000`) as its first edit.
- Two connection modes, side by side:
  - **direct:** `fetch(LAQI_URL + '/todos')`. `cors` defaults to `"*"`, so this works out of the
    box; the README shows tightening it to an allowlist in `laqi.config.json`, and why `--share`
    refuses `"*"` ([ADR-0007](/decisions/0007-public-url/)).
  - **proxied:** the Vite proxy, same-origin, as `todo-app` does.
- **Folder vs file:** the reference ships `laqi/`; the README shows the same mocks as one
  `laqi.json` (`laqi start --file laqi.json`) and when each fits better.
- A dev-only toggle sends `X-Laqi-Response: empty` on one request, to show the per-request layer
  beating the panel.
- **Acceptance:** `ok`, `empty`, `error` and `slow` each render their state, in both modes.

### `next-ssr` — the server is the client

- **CLI surface:** `--port`, `laqi init --port`, scenarios, `--share` and its bearer token.
- `app/todos/page.tsx` is a server component fetching `${process.env.LAQI_URL}/todos` with
  `cache: 'no-store'`. The README says why: with caching on, a flip looks broken.
- laqi runs on **8010** in the committed `mock` script (`laqi init --port 8010 --script`), so the
  example can run beside the root `bun dev`, which already holds 8000 (laqi) and 3000 (todo-app, and
  Next's default).
- A 500 renders `error.tsx`. A 404 on `GET /todos/:id` calls `notFound()`. `slow` shows
  `loading.tsx` (streaming). One server action POSTs to laqi, so there is a server-side write.
- **Scenarios** `offline` and `slow` flip every endpoint at once, from the panel or with
  `laqi scenario`.
- **`--share`:** a Vercel preview build hits a local laqi through the tunnel. The preview sets
  `LAQI_URL` to the tunnel URL and `LAQI_TOKEN` to the bearer token laqi prints; the fetch helper
  sends `Authorization: Bearer …`. The README states the risk of `--share --public` (anyone with the
  URL reads your mocks) and that the quick-tunnel URL changes on every run.
- **Acceptance:** flipping `GET /todos` to `error`, `empty` or `slow` and reloading shows the
  matching Next.js boundary; activating `offline` breaks both the list and the action.

### `astro-ssr` — the OpenAPI example

- **CLI surface:** `laqi init --from openapi --spec openapi.json`, and `laqi import` (piece 2).
- Astro with `output: 'server'` and the Node adapter; `src/pages/index.astro` fetches in the
  frontmatter.
- The committed `openapi.json` (JSON only today) is the source of truth, and `laqi/` is generated
  from it. The README shows editing the spec and re-importing with
  `laqi import openapi.json --overwrite`, and what `--allow-loss` means when the importer refuses.
- **Acceptance:** the same flip table as `next-ssr`, minus streaming; regenerating `laqi/` from the
  spec is a no-op diff.

### `crud-table` — built by an agent

- **CLI surface:** `laqi init --from empty`, `laqi mcp`, and every write verb of piece 2.
- Vite + React + TanStack Query + TanStack Table + Tailwind. **Customers:** client-side sort, search
  and pagination (laqi does not match on query strings), and create / edit / delete through a dialog
  with confirm-on-delete and **optimistic updates**. Mocks are static by ruling
  ([data-generators](/design/data-generators/)), and the README says so plainly.
- **Starter:** the app shell (layout, table component, dialog) with no `laqi/` and no `src/api/`. The
  agent's job is the API layer and the mocks.
- `AGENT-WALKTHROUGH.md` commits the prompts, their order, and what to check after each. Two paths,
  same end state:

  | Step                                     | MCP-only                                 | CLI-only                                                                 |
  | ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
  | Empty mocks                              | —                                        | `laqi init --from empty --yes`                                           |
  | `GET/POST /customers`, `…/:id` ×3        | `create_endpoint`                        | `laqi add "GET /customers" …`                                            |
  | `empty`, `not-found`, `validation-error` | `scaffold_responses`                     | `laqi scaffold "GET /customers"`                                         |
  | 50 seeded rows from `Customer`           | `generate_data` → `apply_generated_body` | `laqi generate --model … --count 50 --seed 1 --into "GET /customers#ok"` |
  | `src/api/types.ts`                       | `get_types`                              | `laqi types "GET /customers" --out src/api/types.ts`                     |
  | Check each state                         | `set_response`                           | `laqi set "GET /customers" error`                                        |

- **Acceptance:** either path, in a fresh `try --from starter` with any coding agent, produces mocks
  that `try:report` scores as equivalent to the reference; the app builds and every row of the flip
  table works. This is the first run of the "repeatable agent evaluation of MCP tool descriptions"
  item.

### `todo-app` — stays, maybe gains a migrate demo

- Keeps auth (`401` → sign out); it stays the only auth example.
- Possible addition: a small v1 fixture in `legacy/mock-data/` and a README section running
  `laqi migrate --dry-run`. See open question 5.

## Coverage matrix

`CI` = exercised by the example's smoke job (`try --from reference --cli local`, build, start laqi,
`curl`). `doc` = shown in the README and checked by hand. Every CLI flag and MCP tool has a row; a new
one without a row is a gap.

| Surface                                  | fetch-basic | next-ssr | astro-ssr | crud-table | todo-app |
| ---------------------------------------- | :---------: | :------: | :-------: | :--------: | :------: |
| `laqi` / `laqi start`                    |     CI      |    CI    |    CI     |     CI     |    CI    |
| `--port`                                 |             |    CI    |           |            |          |
| `--host`                                 |             |          |           |            |   doc    |
| `--dir` (folder)                         |     CI      |          |           |            |          |
| `--file` (single `laqi.json`)            |     CI      |          |           |            |          |
| `--share` + bearer token                 |             |   doc    |           |            |          |
| `--public`, `--share-port`               |             |   doc    |           |            |          |
| `init --from example`                    |     CI      |          |           |            |          |
| `init --from empty`                      |             |          |           |     CI     |          |
| `init --from openapi --spec`             |             |          |    CI     |            |          |
| `init --script`, `--open`                |     doc     |          |           |            |          |
| `init --port`                            |             |   doc    |           |            |          |
| `init --force`, `--yes`                  |             |          |           |    doc     |          |
| `migrate --dry-run`                      |             |          |           |            | doc (Q5) |
| `cors` in `laqi.config.json`             |     doc     |          |           |            |          |
| `X-Laqi-Response` header                 |     CI      |          |           |            |          |
| scenarios (`scenarios.json`)             |     doc     |    CI    |           |            |   doc    |
| panel flip (`/__laqi`)                   |     doc     |   doc    |    doc    |    doc     |   doc    |
| `laqi mcp`                               |             |          |           |    doc     |          |
| `list_endpoints` · `laqi endpoints`      |             |          |           |     CI     |          |
| `get_state` · `laqi state`               |             |    CI    |           |            |          |
| `set_response` · `laqi set`              |     CI      |    CI    |           |     CI     |          |
| `set_scenario` · `laqi scenario`         |             |    CI    |           |            |          |
| `reset_state` · `laqi reset`             |             |    CI    |           |            |          |
| `create_endpoint` · `laqi add`           |             |          |           |     CI     |          |
| `update_endpoint` · `laqi update`        |     doc     |          |           |    doc     |          |
| `delete_endpoint` · `laqi remove`        |             |          |           |    doc     |          |
| `scaffold_responses` · `laqi scaffold`   |             |          |           |     CI     |          |
| `import_openapi` · `laqi import`         |             |          |    CI     |            |          |
| `get_types` · `laqi types`               |             |          |           |     CI     |          |
| `generate_data` + `apply_generated_body` |             |          |           |     CI     |          |
| `regenerate_response`, `refresh_schema`  |             |          |           |    doc     |          |

The CLI-verb rows become `CI` once piece 2 lands; until then the crud-table smoke job runs the
reference's committed mocks.

## Cross-cutting

- `examples/README.md` gives each example one line: "use this when…".
- `bun dev` at the root keeps running `todo-app`; each example runs with
  `bun run dev --filter=@laqi/example-<name>`.
- Examples stay out of releases (`examples` is already in release-please `exclude-paths`).
- CI: one matrix job, one leg per example, running the smoke mode of
  [try-sandboxes](/design/try-sandboxes/). `verify` keeps `check-types` for every example; whether
  `build` stays in `verify` is decided by measuring Next (open question 3).
- laqi.dev gets an **Examples** docs page, and the root README's "Want to see it used?" points at
  `examples/README.md` instead of `todo-app` alone.

## Delivery order

Small, stackable PRs, one Linear ticket each:

| PR  | Scope                                                                                              | Depends on | Notes                                               |
| --- | -------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| a   | `try`, `try:list`, `try:clean`, plus `try.json` for `todo-app`                                     | —          | proves the sandbox on the example we already have   |
| b   | `fetch-basic`, `examples/README.md`, the CI smoke matrix                                           | a          |                                                     |
| c1  | Extract the shared operations; read-only verbs (`endpoints`, `state`, `types`, `generate` preview) | —          | **plan-first**: the extraction reshapes `@laqi/mcp` |
| c2  | Write verbs and the parity test                                                                    | c1         | `feat(cli)`, so it reaches npm                      |
| d   | `crud-table`, its starter, `AGENT-WALKTHROUGH.md`, `try:report`                                    | a, c2      | the first agent-evaluation run                      |
| e   | `next-ssr`                                                                                         | a          |                                                     |
| f   | `astro-ssr` (OpenAPI)                                                                              | a, c2      | uses `laqi import`                                  |
| g   | Examples page on laqi.dev, root README pointer                                                     | b–f        |                                                     |

(a) and (c1) can start in parallel.

## Open questions

1. **Next and Astro, or only Next?** Proposed: both, Next first. Astro is cheap once the contract is
   shared, and it carries the OpenAPI story.
2. **Tailwind in `crud-table`?** Proposed: yes. It is what agents generate by default, and the
   starter should not fight the agent.
3. **Next's cost in CI:** `build` in `verify`, or only in the smoke matrix? Proposed: measure on PR
   (e).
4. **Stateful collections:** should the CRUD friction (creates don't survive a reload) become an Idea
   ticket for opt-in stateful collections? Proposed: yes, as an Idea, without reopening the
   static-data ruling.
5. **A `laqi migrate` demo in `todo-app`?** For: the matrix has no other home for it. Against: v1 is
   legacy, `migrate.test.ts` already covers it, and a fixture adds noise to the example people read
   first. Proposed: leave it in tests and mark the row "tests only", unless Cristian wants it
   visible.
