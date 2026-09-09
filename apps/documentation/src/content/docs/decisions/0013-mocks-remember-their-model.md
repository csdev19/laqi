---
title: ADR-0013 — Mock files retain a generation recipe
---

# ADR-0013 — Mock files retain a generation recipe

**Status:** Accepted — revised after [Storing models in mocks](/adversarial/storing-models-in-mocks/)
**Date:** 2026-09-06

## Context

Laqi can generate a response body from a pasted TypeScript model. JSON cannot
preserve all rules used to make that body: literal unions, optional properties,
and tuple arity disappear in a sample. Regenerating from the body alone is
therefore lossy.

The first version of this ADR stored the pasted TypeScript. The adversarial
analysis found that this puts a readable, stale type definition in a committed
mock file. A reviewer can reasonably mistake it for the API contract even
though Laqi neither owns nor validates that contract.

## Decision

A generated response stores a compact **generation recipe**, not the TypeScript
source it was generated from:

```json
"ok": {
  "status": 200,
  "body": { "id": "inv_9c1f2a", "status": "issued" },
  "generatedFrom": {
    "typeName": "Invoice",
    "recipe": ["o", [["id", 0, "s"], ["status", 0, ["l", ["draft", "issued"]]]]]
  }
}
```

`recipe` is tagged JSON for Laqi's internal `Shape`: `o` is an object, `s` a
string, `l` a literal union, and `0` means a required field. It is compact,
plain JSON, and deliberately not a language developers import or treat as a
contract. `typeName` is only a helpful provenance label.

`generatedFrom` is optional and is written only by generation flows. A
hand-written response has no recipe.

## Consequences

- Regeneration uses the recipe directly, retaining literal unions, optionals,
  and tuple arity without loading the TypeScript compiler again.
- The panel exports the recipe to TypeScript and every other language supported
  by the existing JSON Schema/quicktype bridge. It never displays the pasted
  TypeScript source as authoritative.
- The current body may intentionally diverge after a manual edit. The recipe
  remains historical generation metadata, not a claim about what the API now
  returns. If a recipe is malformed, Laqi warns and falls back to inferring the
  body.
- Everything stays local to the user's project. Laqi does not transmit or
  centralize models, schemas, or example data.

## Alternatives rejected

**Store the pasted TypeScript source.** It enables exact source display but
creates a readable copy that looks like a contract and can drift from the
body and the user's real definitions.

**Store nothing.** It keeps files smaller but makes regeneration silently
lose information JSON cannot express.

**Store only a type name.** It records provenance but cannot regenerate the
lost rules.

**Keep source in `.laqi/` state.** State outside git disappears for teammates
who clone the mock project; the useful local recipe should travel with the
mock it generated.

## Non-goals

- Validating a body against the recipe. Mocks sometimes need invalid data on
  purpose.
- Making Laqi the owner of the project's types or OpenAPI specification.
- Keeping a pasted model synchronized with project types. The durable future
  is a project-types or OpenAPI flow that points to the user's source of
  truth; the paste box remains a fast local convenience.

## What would reopen this

If repeated large recipes become a material share of a mock file, add recipe
deduplication. Do not reintroduce readable contract copies into mock files.
