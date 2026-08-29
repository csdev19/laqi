---
title: "Teaching an agent to use laqi"
---

# Teaching an agent to use laqi

**Status:** Draft — direction agreed, open questions below unresolved.

The goal, in the user's words: you tell your coding agent _"I want this on a
server so I can test my frontend"_, and it reaches for laqi — creating the
endpoint, choosing the method, deciding what data comes back — without being
walked through it.

## The thing to notice first

**laqi already has eleven MCP tools** (nine at the time this document was
first drafted; `get_types` and `generate_data` shipped later, in Plan 6), and
their descriptions are already the agent's documentation:

```
list_endpoints    get_state         set_response      set_scenario
reset_state       create_endpoint   update_endpoint   delete_endpoint
import_openapi    get_types         generate_data
```

`packages/mcp/src/server.ts` already explains, in prose an agent reads, that
an override beats the active scenario and that `set_response` with
`response=null` clears one.

So this is not "write documentation for agents". It is: **audit the
documentation that already exists at the place the agent actually looks**, and
add a readable reinforcement for the case where MCP is not configured.

Prose in a file is the weaker channel. A typed tool with a good description
arrives in the agent's context with its schema, gets validated on call, and
cannot be half-remembered. A README has to be found, opened, and believed.

## Two channels, ranked

### 1 · The MCP tools — primary

The work is an audit, not new code. For each of the eleven tools, three
questions:

- **Does the description say when to reach for it**, not just what it does?
  `create_endpoint` that says "creates an endpoint" teaches nothing;
  one that says "use this when the frontend needs a route the backend has not
  built yet" teaches the whole product.
- **Does it name its neighbours?** The precedence rule is already written
  once. Every tool it applies to should point at it.
- **Would following it blind produce a working result?** The honest test: hand
  an agent only these descriptions and ask it to mock a paginated list with an
  empty state and a 500. If it needs the README, the descriptions are short.

That last one is the acceptance criterion, and it is worth running as an
actual evaluation rather than a reading.

### 2 · `laqi/README.md` — reinforcement

Written by `laqi init` into the mocks folder, next to the files it describes.

**Inside `laqi/`, never the project root.** The user's constraint, and the
right one: laqi runs inside a project that belongs to someone else. A root
`README.md` collides with theirs; an `AGENTS.md` at the root is a shared file
that other tools also write to. The mocks folder is laqi's own territory, and
an agent that opens `laqi/api.json` is already looking at the directory.

Content, in priority order — this is a cheat sheet, not a manual:

1. **The file format**, by example. One endpoint with two responses,
   annotated. Most of what an agent needs is the shape of the key
   (`"GET /todos"`) and where `status`, `body` and `delay` go.
2. **How to add an endpoint** — the three-line version.
3. **The four resolution layers**, briefly, because getting this wrong
   produces confusing behaviour: default → scenario → override → the
   `X-Laqi-Response` header.
4. **What not to do**: do not reach for `X-Laqi-Response` for routine
   requests. It is the highest-precedence layer and an app that uses it
   overrides the panel flips the human is trying to make. `packages/editor`
   and the example already say this; the README should too.
5. Where the panel is, and that flipping a response needs no restart.

Short enough to read entirely. If it grows past a screen, the MCP descriptions
are carrying too little.

## Scope

Writes nothing outside `laqi/`. Same rule as
[laqi-init.md](./laqi-init.md), for the same reason.

## Open questions

1. **`README.md` or `AGENT.md` as the filename?** `README.md` is what a human
   opens by reflex and what GitHub renders when someone browses the folder.
   `AGENT.md` signals the audience but is a convention no tool agrees on yet,
   and a human browsing `laqi/` would wonder what it is.
   **Leaning `README.md`**, written so both audiences get what they need from
   the same file — the content above serves both, and one file cannot drift
   from the other.

2. **Does the README get regenerated?** If a user edits it and a later
   `laqi init --force` overwrites it, that is a small betrayal. Options: never
   rewrite once it exists; or keep it out of `--force`'s scope entirely.

3. **How is the MCP audit verified?** "Better descriptions" is not a
   testable claim. The evaluation above — an agent, the descriptions only, a
   concrete mocking task — is the closest thing to a test, but it needs a
   fixed prompt and a rubric to be repeatable rather than a vibe.

4. **Does this belong to `init` at all?** A project that adopted laqi before
   `init` existed never gets the README. A `laqi doc` subcommand that writes
   it on demand is one answer; another is that `init --force` is enough. Not
   urgent, but it decides whether the README is an `init` artifact or a
   first-class command.

## Out of scope

Rewriting the main `README.md` of this repository, or the documentation site.
This is about what lands in _someone else's_ project.
