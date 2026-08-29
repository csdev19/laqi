---
title: "ADR-0008 — Multi-file with `\"METHOD /path\"` keys, and names"
---

# ADR-0008 — Multi-file with `"METHOD /path"` keys, and names

**Status:** Accepted
**Date:** 2026-08-24
**Supersedes:** the filesystem-routing part of [ADR-0003](/decisions/0003-declarative-json/)

## Context

[ADR-0003](/decisions/0003-declarative-json/) defined two modes: a single
file with `"METHOD /path"` keys, or a folder with **filesystem routing**
(`laqi/users/[id].json`), chosen so that route collisions between files
would be impossible by construction — v1's defect D.

The control panel design assumed something else: a folder with **several
regular files**, all using `"METHOD /path"` keys (visible in the error band
— `mocks/orders.json:14:7` — and in flow F6, which appends to
`mocks/api.json`).

That reopens the collision: two files can define `"GET /users"`.

The design also uses `./mocks/` as the folder name, different from ADR-0003's
`laqi/`.

## Decision

**1. A single key format, across any number of files.**

```
laqi/
├── api.json          { "GET /users": {...}, "POST /users": {...} }
├── orders.json       { "GET /orders": {...} }
└── scenarios.json    named scenarios
```

No filesystem routing. The HTTP route always comes from the key, never from
the file's location. Files are purely organizational.

**2. The collision is resolved with validation, not structure.**

A duplicate route across files is a **load error** that shows up in the
panel's error band, naming both origins:

```
LOAD FAILED   duplicate route GET /users
              laqi/api.json:2  and  laqi/orders.json:14
```

Same as invalid JSON: loud, with file and line, and **not fatal** — the rest
of the mock keeps being served (see ADR-0003 and the semantics correction in
[three-writers](/concepts/three-writers/)).

**3. Names.**

| Path                  | What it is                    | Git            |
| --------------------- | ----------------------------- | -------------- |
| `laqi.json`           | Single-file mode, at the root | committed      |
| `laqi/`               | Folder mode                   | committed      |
| `laqi/scenarios.json` | Named scenarios               | committed      |
| `.laqi/state.json`    | Active state                  | **gitignored** |

The rule, in one line: **no dot means it's yours and gets committed; with a
dot the machine generates it and it's ignored.**

**4. Scenarios are written by hand and by MCP.**

Flow F4 of the design deliberately leaves scenario authoring out of the
panel (the panel only activates them). That decision is confirmed, and the
gap is covered from the other side: [ADR-0006](/decisions/0006-mcp-server/)
adds `create_scenario` and `update_scenario` to the MCP tools. The agent is
the one who best knows which endpoints a scenario touches, because it has
the context of the screen it's building.

## Why the design is deferred to on point 1

**The goal of ADR-0003 was that there be no _silent_ collisions.** The
structure was a means to that end, not the end itself. Validation achieves
the same thing, and at this point it's cheaper:

1. **The error band already exists** in the design, with file, line, cause
   in words and a code excerpt. A collision fits right in without inventing
   anything.
2. **One single key syntax** everywhere. Filesystem routing forced two
   mental models: keys with a method in single-file mode, methods as
   internal keys in folder mode.
3. **No deep folders.**
   `laqi/api/v1/users/[id]/orders/[orderId].json` versus one line
   `"GET /api/v1/users/:id/orders/:orderId"`.
4. **The editor and the MCP get simpler**: creating an endpoint is adding a
   key to a file, not deciding where to place it in a tree.
5. Each endpoint already carries its origin file in the control plane's
   contract, so the error can name both sides of the conflict.

## Why `laqi/` and not `mocks/`

`mocks/` clashes with conventions that already exist in real projects:
`__mocks__` is Jest's convention, and MSW setups commonly use `mocks/`.
Anyone installing laqi into a project with a pre-existing `mocks/` folder
would have a conflict on day one.

`laqi/` doesn't collide with anything, is short, and stays symmetric with
`laqi.json` from single-file mode. The cost — the name says which tool reads
it rather than what it contains — is smaller than the risk of stepping on
an existing folder.

**Consequence for the design:** the screens say `./mocks/` and
`mocks/api.json`. Those strings need to change to `./laqi/` and
`laqi/api.json` in the header, the error band, the fresh state, and flow F6.

## Alternatives considered

**Keep ADR-0003's filesystem routing.** The collision would be impossible
instead of merely detected, and the idiom is familiar (Next.js, Nuxt,
SvelteKit). Discarded for the five reasons above, and because it would have
forced readjusting an already-delivered, well-resolved design.

**Support both modes.** Filesystem routing if the file has no keys with a
method, `"METHOD /path"` keys if it does. Discarded: two mental models
coexisting, the web editor would have to understand both, the MCP would
have to pick one when creating, and it duplicates the test and
documentation surface. Flexibility nobody asked for.

**`mocks/` as in the design.** Discarded for the clash with Jest and MSW.

## Consequences

**In favour:**

- A single syntax across the whole product: files, editor, MCP and
  documentation.
- The delivered design gets implemented almost as-is (only path strings
  change).
- Organizing the mocks is free-form: one file, one per resource, or by
  feature.

**Against:**

- **The collision is possible, just loud.** It's paid for with a test that
  covers it and an error message naming both files. Without that message,
  this decision is worse than the previous one.
- The HTTP route can no longer be inferred by looking at the file tree; the
  files have to be opened. Mitigated with the `file` field per endpoint in
  the panel.
- The design's strings need to be updated.
