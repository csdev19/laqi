---
title: ADR-0003 — Declarative JSON as the primary format
---

# ADR-0003 — Declarative JSON as the primary format

**Status:** Accepted — partially superseded by [ADR-0008](/decisions/0008-multifile-and-names/)
**Date:** 2026-08-24

> **Note:** the folder mode with _filesystem routing_ described below was
> replaced by [ADR-0008](/decisions/0008-multifile-and-names/): any number of
> files, all with `"METHOD /path"` keys, with route collisions resolved by
> validation instead of structure. The names also change (`laqi/`,
> `laqi.json`). Everything else in this ADR still stands.

## Context

The format for mock files had to be decided. v1 used JSON, but with a schema
that caused three of its worst defects: the method encoded in the endpoint
key (which led to the `(get)files/:id` hack), the flat merge of files
(silent collisions), and a redundant `selectorCode` inside an array.

The open question was whether to stay on JSON or move to TypeScript, which
gives types, autocompletion and logic.

## Decision

**Declarative JSON as the primary format**, with a new schema. TypeScript
remains an optional escape hatch for the small percentage of cases that need
real logic.

## Why

The full argument is in [the three writers](/concepts/three-writers/).
Summarized:

In v1 files had a single writer: the human. In v2 there are three — the
human, the web editor, and the AI via MCP — and that imposes a hard
constraint: **the format has to be round-trippable by a machine.** The web
editor must be able to open a file, change a field and write it back without
destroying what it didn't touch.

That rules out TypeScript as the source of truth:

- Rewriting a `.ts` file from a UI requires an AST codemod, and the result
  degrades with each pass.
- The AI would have to generate **code** instead of **data** — more surface
  to hallucinate and no cheap way to validate it.
- Loading `.ts` means **executing arbitrary code** and bundling a transpiler
  inside the CLI.

## The new schema

**Single-file mode** — `laqi.json` at the root. The thirty-second case:

```json
{
  "$schema": "https://laqi.dev/schema.json",
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok":    { "status": 200, "body": [{ "id": "{{uuid}}", "name": "{{name}}" }] },
      "empty": { "status": 200, "body": [] },
      "boom":  { "status": 500, "delay": 2000, "body": { "code": "INTERNAL" } }
    }
  },
  "POST /users": {
    "default": "created",
    "responses": { "created": { "status": 201, "body": {} } }
  }
}
```

**Folder mode** — `laqi/` with filesystem routing, once it grows.
`laqi/users/[id].json`:

```json
{
  "GET":    { "default": "ok", "responses": { "ok": { "status": 200, "body": {} } } },
  "DELETE": { "default": "ok", "responses": { "ok": { "status": 204 } } }
}
```

Both compile down to the same internal route table. You start with one file
and `laqi split` turns it into a folder once it gets in the way. **Supporting
both modes is deliberate**: "one file or one folder, one command and it's
alive" is what made v1 good, and it isn't lost.

## What each change fixes

| Change                                 | v1 defect it removes                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The key is `"GET /users/:id"`          | The method stops competing with the path → goodbye to the `(get)files/:id` hack                                                                |
| Filesystem routing in folder mode      | Collision between files **impossible by construction** (defect D)                                                                              |
| `responses` is an object, not an array | `selectorCode` dies (it was redundant with its own key); O(1) lookup; unique name guaranteed                                                   |
| `status` is a number                   | Compatible with Hono and Express 5 (defect I)                                                                                                  |
| `delay` and `headers` as first-class   | Simulate slow networks and timeouts — critical for React Native                                                                                |
| `{{uuid}}`, `{{name}}`                 | Actually implements the `(generate:uid)` that was left half-done (defect E)                                                                    |
| Zod validation on load                 | A missing selector, invalid method or `null` input fail **at startup**, with a clear message, instead of hanging the request (defects B, C, G) |
| Published `$schema`                    | Autocompletion and validation in VSCode, for free                                                                                              |

## Alternatives considered

**TypeScript as the source of truth.** Discarded per the three-writers
argument. Kept as an optional escape hatch: a `.ts` file next to the JSON
can export a handler for the case that needs real logic. The web editor and
the MCP don't touch it, they only show it as "handled by code".

**YAML.** More readable and supports comments, but round-tripping while
preserving comments is fragile and the three writers would treat it
differently. The gain in readability doesn't make up for it.

**Keeping v1's schema as is.** Discarded: it is the direct source of three
verified defects.

## Consequences

**In favour:**

- A format the three writers share without friction.
- Cheap to validate, with errors at startup instead of at runtime.
- No transpiler and no arbitrary code execution in the CLI.

**Against:**

- JSON doesn't support comments. Mitigated with an optional `description`
  field per endpoint and per response.
- More verbose than TS for complex cases. That's what the escape hatch is
  for.
- Breaks compatibility with v1. Mitigated with `laqi migrate`.
