---
title: Prompt for designing the web editor
---

# Prompt for designing the web editor

This file contains a self-contained prompt to hand to Claude Design (or any
design tool) to get the design for `packages/editor`, laqi v2's web UI.

**It's in English on purpose:** the interface copy is in English (like the
README and `apps/documentation`), and a prompt in Spanish makes the tool
generate the UI text in Spanish. If you'd rather review it in Spanish, let me
know and I'll translate it.

Everything between `<<<` and `>>>` is what gets copied and pasted.

---

<<<

# Design brief — laqi control panel

## What you are designing

The web control panel for **laqi**, an open-source mock API server for frontend
developers. The panel is served by laqi's own CLI at `http://localhost:8000/__laqi`
— it is not a hosted product, there are no accounts, and there is exactly one
user: the developer who started the server on their own machine.

Design the full interface: layout, screens, states, and interaction patterns.

## Product context

Frontend and backend teams work in parallel. The backend is not ready, so the
frontend has no data and no error responses to build against. laqi solves this:
the developer writes JSON files describing fake endpoints, runs one command, and
gets a working API in seconds.

laqi's distinguishing feature is that **every endpoint declares several possible
responses at once** — a success, an empty state, a 500, a slow one — and the
developer switches which one is live. That is how you build and verify an error
screen without touching any code.

Today that switch means opening a JSON file and editing a field. **This panel is
what replaces that.** The core promise: flip any endpoint to any response in one
click, and see the app react immediately.

laqi can also expose the mock through a public URL (a tunnel), so a teammate or a
phone on mobile data can hit it. The panel manages that too.

## Who uses it, and when

A frontend developer with their editor and browser already open, building a
screen. The panel lives in a third tab or a second monitor. They come to it in
short, frequent bursts — flip a response, watch a request land, go back to code.
They are not "using an app"; they are reaching for a tool mid-task.

This means: **speed and density over onboarding and polish.** No welcome screens,
no wizards, no empty-state illustrations that take up the fold. Keyboard-first.
Information visible without clicking.

## The data model

### Endpoints

Each endpoint has an ID (`"GET /users"`), a set of named responses, and a
`default` naming the baseline response.

```json
{
  "GET /users": {
    "description": "List all users",
    "default": "ok",
    "responses": {
      "ok":           { "status": 200, "body": [{ "id": 1, "name": "Ada Lovelace" }, { "id": 2, "name": "Alan Turing" }] },
      "empty":        { "status": 200, "body": [] },
      "slow":         { "status": 200, "delay": 3000, "body": [{ "id": 1, "name": "Ada Lovelace" }] },
      "unauthorized": { "status": 401, "body": { "code": "UNAUTHORIZED", "message": "Session expired" } },
      "boom":         { "status": 500, "body": { "code": "INTERNAL", "message": "Something went wrong" } }
    }
  }
}
```

A response has: `status` (number), `body` (any JSON), and optional `delay`
(milliseconds) and `headers` (object).

A realistic project has 8–40 endpoints. Design for ~25 and make sure 100 does not
break the layout.

### Which response is live: three layers

This is the central concept of the product and the UI must make it legible.

```
1. Request header    X-Laqi-Response: boom          highest priority, per-request, changes no state
2. Active state      set by this panel               persists, this is what the panel writes
3. Default           declared in the file            the baseline
```

Every response laqi returns carries a header saying which layer decided:
`X-Laqi-Resolved: boom (state)`. The panel must show, for each endpoint, both
**which response is live** and **which layer put it there** — a developer looking
at the list needs to tell at a glance "I changed this one" from "this is just the
default".

### Scenarios

A named set of selections that moves several endpoints at once:

```json
{
  "checkout-broken": { "POST /orders": "boom",  "GET /cart": "empty" },
  "new-user":        { "GET /users/:id/orders": "empty", "GET /notifications": "empty" },
  "offline":         { "GET /users": "boom", "GET /cart": "boom", "POST /orders": "boom" }
}
```

Activating one is a single action. Only one scenario is active at a time, and a
per-endpoint override beats the scenario.

### Live request log

The panel receives every request the mock serves, in real time:

```
14:32:07   GET    /users          200   ok (default)       12ms
14:32:07   GET    /cart           200   empty (scenario)    8ms
14:32:09   POST   /orders         500   boom (state)        4ms
14:32:11   GET    /users/42       404   —  no such route
14:31:58   GET    /notifications  200   ok (header)         6ms
```

### Public URL (sharing)

Off by default. When on, the panel shows the public URL, an auth token that must
be sent as `Authorization: Bearer <token>`, and a way to copy both and turn it
off. When it is on, the interface must make it unmistakable that something is
exposed to the internet — this is the one place where a loud visual state is
warranted.

## What the interface must do

Ordered by how often it happens. Let the frequency drive the layout.

**1. Switch an endpoint's live response.** The primary action, done dozens of
times an hour. Must be reachable in one click from the main view, without opening
a detail panel or a modal. Consider that the developer often knows the endpoint
by name and would rather type than hunt — a command palette that jumps to an
endpoint and switches its response is worth designing.

**2. Scan the current state.** "What is live right now, and what did I change?"
Reading the endpoint list should answer this without any clicking. Endpoints in a
non-default state should be visually distinct from untouched ones.

**3. Watch requests arrive.** Live, streaming, alongside the endpoint list rather
than behind a tab — the developer wants to trigger an action in their app and see
it land. Each entry links back to the endpoint that served it. Show clearly when
a request hit no route at all (a very common source of confusion).

**4. Activate a scenario.** Less frequent than a single flip, but it is the demo
move: one action puts the whole API into a known state. Must be visible without
navigating away, and the active scenario must be obvious at all times.

**5. Edit an endpoint's definition.** Add, rename or remove responses; edit
status, delay, headers, and the JSON body. Real JSON editing with syntax
highlighting and validation. This is deeper work — it can live in a detail view,
but getting there and back must be cheap.

**6. Create an endpoint.** Method, path, and at least one response.

**7. Turn sharing on/off** and copy the public URL and token.

**8. See server status.** Which file or folder is being watched, how many
endpoints are loaded, the local address, and any load errors. A file with invalid
JSON must surface a clear, prominent error naming the file — a broken mock file
is the single most common failure and the panel is where it should be explained.

## Technical constraints

- **React + Vite**, compiled to static assets and embedded in the laqi CLI
  binary. Keep the bundle modest — this ships inside an `npx` install.
- **Desktop-first.** Typical width 1280–1920. It must not break at 1024 or on a
  tablet, but phone layouts are not a goal.
- **Dark mode is the default**, light mode supported. Developers run this next to
  a dark editor.
- Data arrives over HTTP plus a live stream for the request log. Assume latency
  is effectively zero — it is the same machine.
- No authentication, no accounts, no user settings to speak of.

## Visual direction

It is a developer tool, and it should read as one. The right neighbourhood:
Prisma Studio, Drizzle Studio, TanStack devtools, Bruno, the Vite and Astro dev
overlays. Dense information, restrained chrome, monospace for anything that is
code — paths, methods, JSON, tokens, timings.

Colour should carry meaning, not decoration: HTTP methods and status classes are
the two dimensions a developer scans for, and they should be distinguishable
peripherally. Keep the rest of the palette quiet so those read.

A note on identity, to inform accent colour and tone but not to be literal: laqi
is a Quechua contraction — _llulla_ (false) + _chasqui_ (the Inca relay
messenger) — "false messenger". The v1 CLI printed a lightning bolt. There is
room for a small, restrained nod to Andean origin in the accent palette. Do not
put llamas or textile patterns in a developer tool.

## Explicitly not wanted

- Onboarding flows, tours, tooltips-on-first-run
- Marketing copy, hero sections, feature explanations in the UI
- Modals for anything frequent — they break the flip-and-check rhythm
- Login, accounts, avatars, team features, notification bells
- Illustrated empty states that push real content below the fold
- Settings pages for things that belong in the config file

## Deliverable

The main view first and in most detail — it is where nearly all the time is
spent. Then the endpoint detail/edit view, the scenarios surface, and the sharing
panel.

Include these states: many endpoints with a mix of default and overridden;
a scenario active; sharing on; a mock file failing to parse; the request log
both busy and empty; and a fresh project with zero endpoints.

> > >

---

## Notes for adjusting the prompt

Things you can change depending on what you want to explore:

- **The number of endpoints.** It says "design for ~25, don't break at 100".
  If your projects are smaller, lower it — it changes the layout quite a bit.
- **The palette.** The identity paragraph is deliberately vague so as not to
  box in the proposal. If you already have a color, make it explicit.
- **The request log.** I asked for it next to the list, not in a tab. It's a
  strong layout decision; if you want to see the alternative, remove it and
  let the tool decide.
- **The command palette.** I suggested it for keyboard flipping. If it feels
  like too much for v1, take it out of point 1.
