---
title: Examples — design spec
---

# Examples — design spec

**Status:** Draft. Open questions are listed at the end.
**Date:** 2026-10-05

## The problem

laqi has one example, [`examples/todo-app`](https://github.com/csdev19/laqi/tree/main/examples/todo-app).
It is a TanStack Start app with auth, a paginated list and CRUD. That is a lot to take in at once, and
it covers only one way of calling laqi: a browser, through a Vite proxy.

People reach laqi from three different places, and each one fails in its own way:

1. **A plain `fetch` from the browser.** The questions are the base URL, CORS and the states:
   loading, error, empty.
2. **A server-side fetch** (Next.js server components, Astro SSR). Here the _server process_ is
   laqi's client. There is no proxy, `LAQI_URL` has to reach the Node process, and caching can hide a
   flipped response.
3. **An agent building a screen.** "I want a table of customers with create, edit and delete" should
   end with the agent creating the endpoints, the data and the types through laqi on its own, with
   no human writing JSON.

The third one is the use case laqi is betting on: see [agent-facing-docs](/design/agent-facing-docs/).
The examples are where that bet becomes visible and testable.

## Goals

- One small example per integration shape. Each one teaches one idea, and its README fits on one
  screen.
- Every example shows the **flip loop**: run the app, open `/__laqi`, flip a response, and watch the
  app's state change with no restart.
- Every example has an **"Ask your agent"** section with copy-paste prompts that reproduce or extend
  its mocks through laqi's MCP tools or CLI.
- At least one example (the CRUD table) is **built by an agent from an empty `laqi/` folder**, and
  the transcript of the prompts is committed so it is reproducible.

## Non-goals

- Stateful mocks. Generated data stays static ([data-generators](/design/data-generators/), "Generated
  data is static, always"). CRUD examples keep using optimistic client updates, as `todo-app` does
  today, and say so plainly.
- Query-string matching. Responses are keyed by method and path. Tables sort, filter and paginate on
  the client, over a seeded list.
- E2E browser tests per example. `check-types` and `build` are enough for now (see the open questions).

## The set

```
examples/
  README.md        index: which example answers which question
  todo-app/        (exists) TanStack Start, auth + CRUD through a Vite proxy
  fetch-basic/     new: Vite vanilla TS, one page, plain fetch
  next-ssr/        new: Next.js App Router, server components fetch laqi
  astro-ssr/       new: Astro (output: 'server'), frontmatter fetch
  crud-table/      new: React admin table with full CRUD, built by an agent
```

Each example is a workspace member (`examples/*` is already listed), has `mock` and `mock:dev`
scripts like `todo-app`, its own `laqi/` folder created with `laqi init`, and a README with these
sections: **Run it**, **The thing worth trying** (the flip table) and **Ask your agent**.

### `fetch-basic` — the smallest possible thing

- Vite + vanilla TypeScript with no framework: `index.html` plus one `main.ts`.
- `GET /users` renders a list. Responses: `ok`, `empty`, `error` (500), `slow` (delay).
- It shows both connection modes, side by side in the README:
  - **direct**: `fetch('http://127.0.0.1:8000/users')` with `cors` enabled in `laqi.config.json`;
  - **proxied**: the Vite proxy, same-origin, as in `todo-app`.
- Acceptance: the flip table covers all four responses, and the page shows each state.

### `next-ssr` — the server is the client

- Next.js App Router. `app/users/page.tsx` is a server component that fetches
  `${process.env.LAQI_URL}/users` with `cache: 'no-store'`. The README explains why: with caching on,
  a flip in the panel looks broken.
- A 500 from laqi renders `error.tsx`. A 404 on `GET /users/:id` calls `notFound()`. A `slow`
  response shows `loading.tsx` (streaming).
- One mutation (create user) goes through a server action that POSTs to laqi, so the example has a
  server-side write as well.
- Acceptance: flipping `GET /users` to `error`, `empty` or `slow` and reloading shows the
  corresponding Next.js boundary. `LAQI_URL` defaults to `http://127.0.0.1:8000`.

### `astro-ssr` — the same idea, the smaller framework

- Astro with `output: 'server'` and the Node adapter. `src/pages/index.astro` fetches in the
  frontmatter.
- The same `GET /users` contract as `next-ssr`, with error and empty states rendered in the page.
- Acceptance: the same flip table as `next-ssr`, minus the streaming row.

### `crud-table` — built by an agent

- A clean React app (Vite + TanStack Query + TanStack Table) showing **customers**: a table with
  columns, client-side sort, search and pagination, and **create / edit / delete** through a dialog,
  with confirm-on-delete and optimistic updates.
- **How it is built is the point.** It starts from `laqi init --yes` with an empty scaffold. Then an
  agent, given only the prompts in `AGENT-WALKTHROUGH.md`, uses laqi's MCP tools to:
  1. `create_endpoint` for `GET/POST /customers` and `GET/PATCH/DELETE /customers/:id`, with `ok`,
     `empty`, `error`, `slow`, `validation-error` (422) and `not-found` (404) responses where they
     apply;
  2. `generate_data` from a pasted `Customer` model, producing 50 seeded rows that stay static;
  3. `get_types` to write `src/api/types.ts`, so the frontend's types come from laqi.
- `AGENT-WALKTHROUGH.md` commits the exact prompts, the order, and what to check after each step.
  The CLI-only path (no MCP) is documented as the fallback, with the laqi commands that replace each
  tool call.
- Acceptance: following the walkthrough in a fresh clone, with any MCP-capable coding agent,
  reproduces equivalent mocks. The app runs against them, and every row of the flip table works.
  This doubles as the first run of the "repeatable agent evaluation of MCP tool descriptions" item.

### Cross-cutting

- `examples/README.md` gives each example one line: "use this when…".
- laqi.dev gets an **Examples** docs page linking to all of them, and the root README's "Want to see
  it used?" points to the index instead of to `todo-app` alone.
- `bun dev` at the root keeps running `todo-app`. Each example runs with
  `bun run dev --filter=@laqi/example-<name>`.
- Examples stay out of releases: `examples` is already in release-please `exclude-paths`.
- `verify` covers `check-types` and `build` for every example. If Next's build makes `verify`
  noticeably slower, Next gets its own job in CI instead (see the open questions).

## Suggested order (one PR each, stackable)

1. `fetch-basic` + `examples/README.md`
2. `next-ssr`
3. `astro-ssr`
4. `crud-table` + `AGENT-WALKTHROUGH.md`. **plan-first**: the walkthrough is new ground.
5. The docs page on laqi.dev and the root README pointer.

## Open questions

1. **Next and Astro, or only Next?** Next is what most agent-built frontends use. Astro is cheap to
   add once the contract is shared. Proposed: both, Next first.
2. **UI for `crud-table`**: plain CSS like `todo-app`, or Tailwind? Proposed: Tailwind, to match
   what agents generate by default.
3. **Next's cost in CI**: keep it in `verify`, or give it a separate job? Proposed: decide on the
   first PR by measuring it.
4. **Should the CRUD friction (creates don't persist on reload) become an Idea ticket** for opt-in
   stateful collections? Proposed: yes, as an Idea, without reopening the static-data ruling here.
