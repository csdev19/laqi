---
title: Data generators — design spec
---

# Data generators — design spec

**Status:** approved design, pre-implementation
**Date:** 2026-08-27

## The problem

When frontend and backend argue, or the endpoint does not exist yet, the
discussion always lands on a data model — a type. laqi should close the loop
around that moment, in both directions:

1. **I have a JSON** (a response I sniffed, a sample from the discussion) →
   give me the type for my code.
2. **I have a data model** (the interface from the discussion) → give me mock
   data shaped like it, served by laqi.

## Decisions, and why

### Generated data is static, always

Generation writes ordinary JSON into the mock files. It is then visible,
editable, committable — a response like any other. Regenerating **overwrites**
the response body; there is no versioning of dummy data. Per-request dynamic
generation (faker at serve time) is explicitly out: it would break the canned-
response model (ADR-0003) and belongs, if ever, to the still-unassigned
templating plan (v1 defect E).

### One source of truth: the data. Models are never persisted

The paste-a-model panel is a **one-shot converter**. The pasted model is used
and discarded. This was decided against the alternative (saving the model per
endpoint) because a saved model becomes a second source of truth: the mock
JSON is hand-editable — that is the soul of the product — so data and saved
model inevitably drift, and then a validation subsystem is needed to say which
one lies. Instead:

- **Types are derived from the current data, on demand.** Direction 1 runs on
  the live response body, so types are always fresh and can never be stale.
- **Regenerate does not need the original model.** The shape is inferred from
  the existing response body and the values re-randomised against it.

### The internal hub: a minimal `Shape` IR with four arrows

```
        inferShape(json)              parseTypes(ts source)
  JSON ────────────────► Shape ◄──────────────────── pasted TS interface
                           │
     shapeToJsonSchema     │         generate(shape, {seed, arrayLength})
          (~40 lines)      │────────────────────► mock data (faker-backed)
                           ▼
                    quicktype(lang)
                           ▼
     TS · Zod · Effect · Swift · Kotlin · Dart · Python · Go · Rust · … (27)
```

`Shape` is a small union: object / array / string / number / boolean / null /
literal-union / record / date / unknown. Everything else is a pure function
around it. New workspace `packages/generate` (private, bundled like the rest).

### Parsing pasted TS: the real compiler, not a hand-rolled subset

Real-world models are dirty — `extends`, `Pick<...> & {...}`, unions of
literals, `Record`, and imports from libraries that are not present. Verified
by spike: the TypeScript checker **flattens all of it** (a `Pick<User, 'id' |
'name'> & { active: boolean }` comes back as a plain object shape), and an
unresolvable import degrades to `unknown` rather than crashing. Unresolved
identifiers are reported as warnings naming the identifier; unsupported
constructs (functions, unresolvable generics) are clear errors naming the
construct.

A hand-rolled parser was rejected as reinventing the wheel and dying on
exactly the dirty types that matter.

### Values: faker, seeded, with field-name heuristics

`@faker-js/faker` (zero dependencies, 2.9 MB) generates the values. A small
mapping from field names to faker domains (`name`, `email`, `createdAt`,
`price`, `url`, `city`, …) makes the data look real; literal unions pick among
their literals; `id` fields are sequential integers for stability. A `seed`
parameter makes output reproducible — same seed, same data — which is also
what makes the generator snapshot-testable. Default array length: 3,
overridable per request.

A hand-rolled dictionary was rejected because "regenerate" would then produce the
same values forever — variety on regeneration is the point of faker.

### Type output: quicktype as the printer, via a JSON Schema bridge

`Shape → JSON Schema` is a ~40-line mapping; `quicktype-core` then prints
**27 languages** including TypeScript, TypeScript Zod, TypeScript Effect,
Swift, Kotlin, Dart, Python, Go and Rust — with named nested types and enums
extracted from literal unions (verified by spike). This is what makes laqi
useful to mobile and backend developers, not only TS ones.

quicktype touches **only the printing arrow**. If it ever becomes a problem,
that arrow is swappable without touching parsing or generation.

The ramp-up for a non-JS developer was verified before committing to this: in
a pure Java project (a `pom.xml`, zero JS), `npx laqi` serves mocks and the
panel with **nothing added to the project** — no `package.json`, no
`node_modules`; npx installs into npm's global cache. The only machine
prerequisite is Node, and `laqi mcp` works from any project regardless of
language.

### Dependencies and weight

|                    | today     | with this feature                                                  |
| ------------------ | --------- | ------------------------------------------------------------------ |
| installed packages | 6         | ~34 (`typescript`, `@faker-js/faker`, `quicktype-core` + its 25)   |
| disk               | ~10 MB    | ~54 MB                                                             |
| laqi startup       | unchanged | **unchanged** — all three load via dynamic `import()` on first use |

Accepted as disk weight in a dev tool, lazily loaded, never reaching any app
bundle.

## Surfaces

### Control plane (local-only, as ever) — pure routes, no new write paths

```
GET  /__laqi/api/endpoints/:id/types?response=ok&lang=typescript-zod
     → { code: string, language: string }        (derived from live data)

POST /__laqi/api/generate/data
     body: { model: string, typeName?: string, arrayLength?: number, seed?: number }
         | { from: { endpointId: string, response: string }, arrayLength?, seed? }
     → { preview: json, warnings: string[] }
```

Generation routes **compute and return**. Writing the result goes through the
existing, thrice-hardened `POST/PUT /api/endpoints` — the write surface gains
nothing.

### Panel

- **Endpoint detail**: a "Copy types" control with a language dropdown in the
  meta column; a "Regenerate" action per response (preview → confirm → the
  existing PUT).
- **Create from model**: the "+ New endpoint" row gains a "from a model" mode —
  paste the interface, pick method/path, preview the generated data, create.

### MCP

Two pure tools: `get_types({ endpointId, response?, lang? })` and
`generate_data({ model | from, arrayLength?, seed? })`. They return; the agent
writes with the tools it already has.

## Testing

- Fixture suite for `parseTypes` including the dirty real-world type
  (`extends` + `Pick` + intersection + unresolvable import).
- Seeded snapshot tests for `generate` (fixed seed → byte-stable output).
- Round-trip property: `inferShape(generate(shape))` is compatible with
  `shape`.
- Control-plane route tests; panel tests in jsdom; one MCP case over real
  stdio.
- A smoke test per quicktype target language (it compiles/emits, not full
  output assertions); deep assertions for `typescript` and `typescript-zod`.

## Out of scope

- **Dynamic per-request generation** — the templating plan, still unassigned.
- **Desktop app** — explicitly not the MVP.
- **OpenAPI → types** — `import_openapi` already covers OpenAPI → data; the
  types direction can derive from data later for free.
- **Writing files outside laqi's mock directory** (e.g. into the frontend's
  `src/types`) — forbidden by the containment rule (ADR-0006). Types are
  copied from the panel or fetched from the API.
