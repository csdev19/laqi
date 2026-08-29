---
title: Design review against the decisions
---

# Design review against the decisions

**Date:** 2026-08-24
**Reviewed:** `DESIGN.md`, `SCREENS.md`, `INTERACTIONS.md`, `STATE-MODEL.md`,
flows F1–F9, and the seven prototype screenshots.

The design is solid and consistent with almost everything decided. What
follows is what **doesn't** close: a security hole, a contradiction with
ADR-0003, an internal inconsistency in the design itself, and several minor
gaps.

---

## What confirms the decisions

Worth recording, because it validates the ADRs with a second pair of eyes:

- **The state model matches exactly** what's in
  [state resolution](/concepts/state-resolution/): four layers, `state`
  beats `scenario`, and `header` **never mutates state** — it only shows up in
  the log, never changes a chip. That asymmetry was worked out by the design on
  its own, and it's correct.
- **The control plane it defines is the MCP surface.** `GET/PUT
/__laqi/api/state`, `GET/POST/PUT /__laqi/api/endpoints`, `GET
/__laqi/api/scenarios` map almost 1:1 onto the tools from
  [ADR-0006](/decisions/0006-mcp-server/). It confirms the thesis that it gets
  implemented once and exposed through three surfaces.
- **`"GET /users"` as the endpoint ID** is exactly the format from
  [ADR-0003](/decisions/0003-declarative-json/). The screenshots show
  `GET /users` and `POST /users` as separate rows: v1's `(get)` hack stays
  buried.
- **Sharing off by default, per session, with a masked token** matches
  [ADR-0007](/decisions/0007-public-url/).

And one thing the design resolved **better** than it was specified — see H3
below.

---

## Findings

| #   | Finding                                                        | Severity                |
| --- | -------------------------------------------------------------- | ----------------------- |
| H1  | The tunnel would expose the control plane                      | **Blocking — security** |
| H2  | Cross-file collision returns; contradicts ADR-0003             | **High — structural**   |
| H3  | Partial load vs. failing on startup (the design gets it right) | High — refines ADR-0003 |
| H4  | `X-Laqi-Resolved` is inconsistent and user-editable            | Medium                  |
| H5  | Semantic errors have no surface                                | Medium                  |
| H6  | Hot reload can't restart the server                            | Medium — implementation |
| H7  | `/__laqi` is a reserved prefix and it's not declared           | Medium                  |
| H8  | Endpoint `DELETE` is missing from the contract                 | Low                     |
| H9  | The detail view's `curl` doesn't account for shared mode       | Low                     |
| H10 | Folder name: `mocks/` vs `laqi/`                               | Low — decision          |
| H11 | Two webfonts inside a binary installed with `npx`              | Low                     |
| H12 | Prototype props with no permanent home                         | Low                     |
| H13 | Prototype inconsistencies (fresh state, empty log)             | Cosmetic                |

---

### H1 — The tunnel would expose the control plane · **blocking**

F7 stands up a public URL that points at the server. The design **never says
that `/__laqi` must stay outside the tunnel.** If the proxy passes everything
through:

- `PUT /__laqi/api/endpoints/:id` → anyone with the URL **rewrites your mock
  files on your disk**.
- `GET /__laqi/api/status` → leaks the project's local path.
- `POST /__laqi/api/share` → a third party controls the tunnel.
- The panel itself becomes browsable from the internet.

[ADR-0007](/decisions/0007-public-url/) already requires this ("the web editor
and the MCP are not exposed"), but the design doesn't encode it, and this is
exactly the kind of thing that gets implemented wrong by omission.

**Resolution:** the control plane mounts on a separate router that only
listens on the local interface. What goes out through the tunnel is
exclusively the mocks surface; `/__laqi/*` returns 404 through the relay —
404, not 403, so as not to confirm it exists. There must be a test that
verifies this.

Also: the panel should **say so** in the magenta band. A line like
`mocks only — the panel is not exposed` turns an invisible guarantee into
something the user sees.

---

### H2 — Cross-file collision returns · **high**

The design assumes a `mocks/` folder with **several files** (`api.json`,
`orders.json` — visible in the error band and in F6), and each file uses
`"METHOD /path"` keys.

That means `api.json` and `orders.json` can **both** define `"GET /users"`.
It's v1's defect D coming back in through the back door.

[ADR-0003](/decisions/0003-declarative-json/) had resolved this by having
folder mode use filesystem routing (`laqi/users/[id].json`), where the
collision is impossible by construction.

**Recommendation: adopt the design's model and resolve the collision with
validation, not structure.** Reasons:

1. One key format everywhere is simpler than two modes with different syntax.
2. **The error band already exists** and handles exactly this class of
   problem. A collision is a load error with a file and a line, same as a
   broken JSON.
3. Filesystem routing forces deep folders
   (`mocks/api/v1/users/[id]/orders/[orderId].json`) for deep APIs.
4. Every endpoint already carries its origin `file` in the contract, so the
   error message can name both conflicting files.
5. ADR-0003's actual goal was **no silent collisions**. Structure was a means;
   validation achieves the same thing and is more flexible.

This supersedes part of ADR-0003 → **an ADR-0008 is needed**. Pending your
approval before writing it.

---

### H3 — Partial load instead of failing on startup · the design gets it right

F8 says: a broken file shows the band and **"the rest of the mock keeps being
served"**, with the counter reading `26 (+1 file failed)`.

That's **better** than what I left written in
[three-writers](/concepts/three-writers/), which says "fails loudly on
startup" and can be read as _fail-fast_. Restarting the whole mock because one
file has an extra comma is hostile.

**Resolution:** the correct semantics are **loud but not fatal, per file**.
The loader is fault-tolerant at the file level; every file that fails
produces a visible error and pulls out only its own endpoints. The concept's
wording needs to be corrected.

---

### H4 — `X-Laqi-Resolved` is inconsistent and editable

Two problems in the same panel:

1. **Format.** `STATE-MODEL.md` says the value is `<name> (<layer>)` and F3
   says the log prints that string verbatim. But the detail screenshot shows
   `"x-laqi-resolved": "ok"` — without the layer. If the header doesn't carry
   the layer, the log can't print it verbatim, and the promise that the panel
   is verifiable against the network tab breaks.
2. **Editability.** It appears inside the `HEADERS` box, which is a field the
   user edits. `x-laqi-resolved` is **generated by laqi**: it can't live
   there. If the user edits it, it lies. If laqi overwrites it, the edit is
   silently lost.

**Resolution:** the header is always emitted as `<name> (<layer>)`, computed
at runtime, and the `HEADERS` box only contains headers declared by the user.
Headers generated by laqi are shown separately and read-only.

---

### H5 — Semantic errors have no surface

F8 covers JSON **parsing** errors. It doesn't cover files that parse fine but
are invalid:

- `default` points to a response that doesn't exist (v1's defect C, the one
  that hung the request)
- invalid HTTP method (defect G in v1)
- duplicate route across files (H2)
- `status` out of range, negative `delay`
- a route under the reserved `/__laqi` prefix (H7)

**Resolution:** the same band, with the same anatomy (file, line, cause in
words, excerpt). The design already has the component; it just needs to be
fed Zod errors in addition to `JSON.parse` errors.

---

### H6 — Hot reload can't restart the server

In v1, every file change killed the server and it went back to listening
(defect H). With the panel open, that now **cuts the SSE and leaves the UI
blank** on every save.

F5 calls for "diff, don't remount" for the UI. The same has to hold on the
server side: **the route table is swapped hot**, the process and the socket
stay alive, and the change goes out as an `endpoints-changed` event. Never a
new `listen()`.

This is a hard constraint on `packages/core` and `packages/server`.

---

### H7 — `/__laqi` is a reserved prefix

The panel, its API, and the SSE all live under `/__laqi`. That means **the
user can't mock anything under that route.** It's not declared anywhere.

**Resolution:** document it, and have the validator reject with a clear
message any endpoint that starts with `/__laqi`. Note that this is exactly
the kind of thing that breaks for someone mocking a real backend that uses
`__` as a prefix.

---

### H8 — Deleting endpoints is missing

The contract has `POST` and `PUT` for endpoints, and the detail view allows
`Delete` on a **response**. There's no way to delete an **endpoint**.

**Resolution:** add `DELETE /__laqi/api/endpoints/:id` to the contract, and
decide whether the panel exposes it (probably in the detail view, next to the
route) or whether it's deleted only by editing the file.

---

### H9 — The detail view's `curl` ignores shared mode

F7 gets it right: `Copy curl` from the band includes
`Authorization: Bearer <token>`. But the per-response `curl` in F5 is always
`curl -H 'X-Laqi-Response: ok' localhost:8000/users`.

With the tunnel active, that command is useless for testing from another
device — which is exactly when you need it.

**Resolution:** when sharing is active, the detail view's `curl` uses the
public URL and the bearer token. Or it shows both variants.

---

### H10 — `mocks/` vs `laqi/`

The design uses `./mocks/` and `mocks/api.json`. [ADR-0003](/decisions/0003-declarative-json/) said
`laqi.json` or `laqi/`.

**Recommendation: keep `mocks/`.** It tells someone opening the repo for the
first time what's inside; `laqi/` only says which tool reads it. The single
file can still be `laqi.json` at the root, or `mocks.json` for symmetry — one
needs to be chosen, and ADR-0008 should record it.

---

### H11 — Two webfonts inside an `npx`

`Source Serif 4` + `JetBrains Mono` bundled into a binary that installs via
`npx` is real weight, and ADR-0005 asks that the bundle stay modest.

**Resolution:** subset to the glyphs actually used (the panel doesn't need
the full character set), `woff2` format, and a decent system fallback stack
so first paint doesn't depend on the font. No pulling them from Google Fonts
at runtime: the panel has to work without internet.

---

### H12 — Prototype props with no home

`density` and `showDescriptions` are real preferences; `accent` and `logRate`
are prototype-only.

The design says settings belong in the config file, not in a screen.
Consistent. **Resolution:** `density` and `showDescriptions` go into
`laqi.config.json`; `accent` and `logRate` are dropped. And the
`PROTOTYPE STATES` bar doesn't exist in `packages/editor` — `SCREENS.md`
itself already says so.

---

### H13 — Prototype inconsistencies

Cosmetic, but worth not copying:

- **Fresh project** shows the five scenarios with 0 endpoints loaded. A
  scenario references endpoints; with zero endpoints the strip should be
  empty or absent.
- **Empty log** shows `Resume` (i.e., paused) while saying "Waiting for
  requests…". If it's paused, it isn't waiting.
- The log shows `2221ms` for the `slow` response, which is declared with
  `delay: 3000`.

---

## Open questions

1. **H2** — do we adopt multi-file with `"METHOD /path"` keys + collision
   detection, and write ADR-0008? This is the only one that blocks starting.
2. **H10** — `mocks/` as the folder name? And is the single file called
   `laqi.json` or `mocks.json`?
3. **H8** — delete endpoints from the panel, or only by editing the file?
4. **Scenario authoring** — F4 explicitly leaves it out of the panel ("they
   live in the config file"). A reasonable decision, but then it needs to be
   defined where authoring does happen: only by hand, or also through MCP and
   the CLI? Leaning toward the MCP having a `create_scenario`, since the
   agent is best positioned to know which endpoints a scenario touches.
