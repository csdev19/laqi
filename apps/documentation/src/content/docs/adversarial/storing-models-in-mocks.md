---
title: Storing models in mocks — how close laqi gets to being a source of truth
---

# Storing models in mocks — how close laqi gets to being a source of truth

**Status:** resolved — led to the revision of [ADR-0013](/decisions/0013-mocks-remember-their-model/)
**Date:** 2026-09-06
**Trigger:** "it would end up being a source of truth for laqi, when it should only deliver mock APIs"

## The question

[ADR-0013](/decisions/0013-mocks-remember-their-model/) decided that a response
generated from a pasted TypeScript model stores that model beside the body it
produced. It was written to answer two complaints from the panel: an endpoint that
cannot say where its body came from, and a `regenerate` that guesses the shape back
out of a single sample and gets it wrong.

The objection is not to either fix. It is to what the fix makes laqi hold. A mock
file that carries type definitions is a mock file people will read to learn what the
API returns — and laqi has verified nothing. It serves what it was told to serve.

This document is the case ADR-0013 has to survive: what the storage actually costs,
which of laqi's surfaces already invite the same misreading, and whether the two
needs can be met without laqi ever holding a definition that exists nowhere else.

## What is actually stored today

On the unmerged branch, a generated response gains:

```json
"ok": {
  "status": 200,
  "body": { "id": "inv_9c1f2a", "status": "issued" },
  "generatedFrom": {
    "typeName": "Invoice",
    "model": "export interface Invoice {\n  readonly id: string\n  ...\n}\n"
  }
}
```

Written only by the generator, never by hand, and optional — every response that
predates it, and every hand-written one, has none.

## What it costs, measured

### Weight

| Example model | Source | Source, JSON-escaped | Shape as JSON | Generated body |
| ------------- | -----: | -------------------: | ------------: | -------------: |
| `simple`      |    131 |                 ~140 |           443 |            134 |
| `medium`      |    647 |                 ~680 |         2,340 |          1,700 |
| `complex`     |  1,996 |               ~2,100 |         6,145 |          3,914 |
| `flat`        |  1,223 |                1,286 |         4,288 |          2,743 |

Bytes. The example project's mock file is 10,279 bytes across 8 endpoints. If each
endpoint's default response carried the `flat` model, the file doubles:

| Scenario                        | File size | Change |
| ------------------------------- | --------: | -----: |
| Today                           |    10,279 |      — |
| Each default carries the source |    20,567 |  +100% |
| Each default carries a Shape    |    51,495 |  +401% |

The ceiling is worse than the average: `MAX_SOURCE_LENGTH` is 200,000 characters, so
one response may legally hold 200 KB of TypeScript inside a file a person is
expected to read and review.

### Regeneration is no longer cheap

Regenerating from a stored model re-runs the TypeScript compiler on it.

| Path                                         | Cost                         |
| -------------------------------------------- | ---------------------------- |
| Stored source, first regenerate in a process | 258 ms parse + 1 ms generate |
| Stored source, compiler already loaded       | 125 ms parse + 1 ms generate |
| Stored Shape                                 | 1 ms, no compiler            |
| Body, today's fallback                       | 1 ms, no compiler            |

The 23 MB compiler is dynamically imported precisely so startup does not pay for it.
ADR-0013 makes every regenerate pay for it instead, to re-derive something laqi
already computed once and threw away.

### Drift

The stored model is a copy taken at paste time. Edit the body by hand and the model
still describes what the body used to be. The ADR names this and labels the panel
accordingly — "the model this body was **generated from**", never "the type of this
response" — but the label is the only thing holding the two apart.

## What the storage buys, measured

The fallback it replaces is lossy in exactly the ways laqi's parser exists to
handle. Walking the 57 shape nodes of the `flat` model against a shape inferred back
from its own generated body:

| What the model declares | Count | What survives a round trip through JSON |
| ----------------------- | ----: | --------------------------------------- |
| Literal unions          |     7 | `string` or `number`                    |
| Tuples                  |     1 | a variable-length array                 |
| Optional fields         |     4 | present or absent, never optional       |

Concretely: `coordinates: [number, number]` regenerated as three numbers, and
`status: 'draft' \| 'issued' \| 'paid' \| 'void'` regenerated as an arbitrary
sentence. Both were reported from the panel before the cause was known.

That is the honest case for keeping something. The question is what.

## The door was already open

Storing the model is not the first thing that invites reading laqi as the contract,
and arguably not the loudest.

**Copy types**, in the panel and documented on the data-generators page, derives
types from any response body and offers them in 25 languages, TypeScript with Zod
and Effect Schema validators included. Its purpose is to put laqi's idea of a shape
into the developer's codebase. It shipped long before this.

**`import_openapi`** runs the other way: the spec is the truth and laqi consumes it.
That is the direction that keeps laqi derivative.

So laqi already hands out types on request. What ADR-0013 adds is not the first
claim about shape — it is the first **durable** one, sitting in a file that is
committed, reviewed and read by people who were not there when it was pasted.

## The test that decides it

A criterion that can actually be applied, rather than a feeling about scope:

> laqi may remember **how a mock was made**. It may not assert **what an API
> returns**. The difference is verification, and laqi has verified nothing.

Applied to what could be stored:

| What is stored                             | Reads as                     | Verdict |
| ------------------------------------------ | ---------------------------- | ------- |
| The TypeScript source, as pasted           | a type definition            | fails   |
| A Shape, laqi's internal generation recipe | a recipe                     | passes  |
| A path to a type in the user's own repo    | a pointer at the real source | passes  |
| Nothing                                    | —                            | passes  |

The source fails not because it is importable — it is a JSON string with escaped
newlines, nobody imports that — but because of what a reader does with it. A
teammate opening `laqi/api.json` in review finds a complete interface and reasonably
concludes it is the contract. A `Shape` is unmistakably a tool's working note.

## The options

**A — Store the source.** ADR-0013 as written. Shows exactly what was pasted,
comments and unused declarations included. Doubles the example file, costs 125–258 ms
per regenerate, and is the only option that puts a readable type definition in a
committed file.

**B — Store the Shape.** Lossless regeneration at 1 ms with no compiler, and the
panel can still print it back as an interface for display, in any of the 25
languages. Measured cost: 3.3× the source in bytes, and the file grows 401% in the
scenario above. What is displayed is what laqi actually used, not what was pasted —
more honest for provenance, worse for "show me my file back".

**C — Store a reference.** `{ "file": "src/types/invoice.ts", "typeName": "Invoice" }`.
No copy, no drift, and it strengthens the real source of truth by pointing at it.
Requires an origin, which the panel's paste box does not have, and couples the mock
file to the project's layout. Natural fit for a future "generate from my project's
types" flow, and for `import_openapi`.

**D — Store nothing.** Where the project was before this session. Both reported
problems return, one of them silently.

**E — Off by default, opt-in per project.** Adds a mode to a tool that has avoided
them, and hands the lossy regenerate to everyone who never finds the flag.

## Where this lands

The two needs pull apart under measurement, and that is the useful finding.

**Regeneration fidelity does not need the source.** It needs the Shape, which laqi
computes anyway and currently discards. Storing it is strictly better on
correctness, 125–258× faster, and passes the test above.

**Provenance does not need the source either.** "Generated from `Invoice`" plus a
Shape that can be printed back is enough to answer "where did this come from" and
"what is it". What the source uniquely provides is the developer's own file,
verbatim — which is the part that reads as a contract.

So the split that survives the objection is **B for what laqi keeps, C for where
models should come from**: store the recipe, never the definition, and make the
long-term path one where the definition lives in the user's repository or spec and
laqi points at it.

The compact encoding is now implemented: tagged JSON arrays such as
`["o", [["status", 0, ["l", ["draft", "issued"]]]]]`. Across the four example
models it serializes 9–14% smaller than the original TypeScript source (`flat`:
1,135 bytes versus 1,223). It is a recipe for Laqi, not a definition reviewers
can mistake for a contract.

Reverting costs nothing today. Both PRs are open and unmerged.

## The open question

**Should laqi ever hold a type definition that exists nowhere else?**

Yes means the pasted-model flow is a first-class way to author a contract, and the
storage question is only about format. No means the paste box is a convenience whose
output laqi may remember as a recipe but never as a definition, and the real flow to
build is C — point at a type in the repository, or import a spec — with the paste box
kept for the thirty-second case.

The answer is no. Laqi retains local generation recipes; the contract lives in
the user's repository or specification, and a future project-types/OpenAPI
flow should point at that source.

## Ledger

Not analysed yet, and deliberately not guessed at:

- **Recipe deduplication.** The compact encoding is implemented, but repeated
  large recipes are not deduplicated yet.
- **What MCP agents do with this.** `create_endpoint` validates against the same
  schema, so an agent can write `generatedFrom` today. Whether agents should be
  allowed to, and what they would put there, has not been thought through.
- **The `Copy types` surface.** Named above as the older invitation to the same
  misreading, but not analysed. If the answer to the open question is "no", that
  button's framing deserves its own look.
- **Backend integration and expected messages.** The stated future in which laqi can
  compare a mock against a real response. That is the point at which holding a
  contract becomes legitimate, because it would finally be checked. Nothing here
  should block it, and B's recipe is a plausible seed for it — unverified.

## Method

Measurements taken 2026-09-06 against commit `7955a85` on
`feat/mocks-remember-their-model`. Byte counts are `Buffer.byteLength` over the
example models in `packages/generate/src/examples.ts`, their parsed Shapes, and
bodies generated with `seed: 7`. File-growth scenarios multiply the JSON-escaped
size by the 8 endpoints in `examples/todo-app/laqi/api.json` and add it to that
file's current size; no such file was actually written. Timings are
`performance.now()` around `parseTypes` and `generate` in one Bun process, cold
meaning the first call in that process. The fidelity table walks the parsed Shape of
the `flat` model against `inferShape` of its own generated body and counts nodes
where the kind changed.
