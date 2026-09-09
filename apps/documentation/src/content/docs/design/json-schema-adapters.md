---
title: JSON Schema and adapters — design spec
---

# JSON Schema and adapters — design spec

**Status:** phase 1 implemented; phases 2-6 not started. Derived from [Plan 14](/plans/2026-09-07-14-json-schema-adapters/) and its twelve-point review
**Date:** 2026-09-07, revised 2026-09-09 by what phase 1 measured
**Supersedes:** the section "One source of truth: the data. Models are never persisted" in [data-generators](/design/data-generators/), and the `generatedFrom` experiment of [ADR-0013](/decisions/0013-mocks-remember-their-model/) (PR #61) and the compact-recipe experiment that followed it

This document turns Plan 14 into contracts an implementer can build and a
reviewer can check. Where the plan states a decision, this spec states the exact
shape, the exact behavior, and the exact test. Where the plan leaves something to
implementation evidence, this spec says so and does not decide it.

Normative statements use **must** / **must not**. Code blocks marked
_illustrative_ show intent, not final declarations.

## What phase 1 changed here

Phase 1 pinned today's generation behaviour in `packages/generate/goldens/` and
declared the contracts in `packages/schema`. Four statements in the first draft did
not survive that, and are corrected in place:

| Was                                                         | Is                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| An optional property is present with probability 0.5        | Every property is generated, optional or not                                             |
| A record generates `arrayLength` keys                       | A record generates exactly two keys, whatever `arrayLength` says                         |
| One "Kind" column holding `loss`, `error` and `information` | Kind, severity and acknowledgeability are three columns; error-severity codes are `loss` |
| A stored document may be a boolean                          | A stored root document is always an object; a nested boolean is still a schema           |

The first two would each have broken the emitter invariant on its first fixture.

## What this specifies

1. What a mock response stores about the schema it is associated with, and about
   the generation that produced its body.
2. The JSON Schema vocabulary laqi can generate from, and what happens outside it.
3. One loss policy for every input.
4. The ports, adapters and use cases, as Effect services inside `@laqi/generate`.
5. How the panel, the local HTTP control plane and MCP reach those use cases,
   including the rules for executing project code.
6. Path bases, confinement and budgets.
7. The writer's JSON layout.
8. Export.
9. What is removed, and the tests that gate each phase.

## Non-goals

These are settled by Plan 14 and are out of scope here:

- **Runtime body validation.** laqi never checks a served or saved body against a
  schema, and never calls Standard Schema's `validate`. Independent validators run
  in tests only.
- **Automatic synchronization** between a stored schema and the project's real
  types or spec. Refresh is explicit.
- **Every JSON Schema keyword.** The supported vocabulary is a published matrix.
- **Remote `$ref` resolution.** No network during import, generation or export.
- **Zod, Valibot and ArkType code export.** Separate deliverables, after their
  emitted code is verified.
- **Deduplication and persistent caches.** They wait for phase-6 measurements.
- **A security sandbox for project code.** Loading a module executes it. The spec
  bounds who may trigger that and how; it does not contain what the code does.

## Vocabulary

| Term                | Meaning here                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Document            | A JSON Schema value: `true`, `false`, or an object of keywords. Dialect draft 2020-12.        |
| Snapshot            | A document plus its name, source descriptor and diagnostics. What a response stores.          |
| Source descriptor   | Where a document came from: a paste, a schema file, an OpenAPI document, or a project module. |
| Diagnostic          | A structured note about loss, an unsupported rule, invalid input, or information.             |
| Generation evidence | Seed, effective options and body hash recorded when laqi generated a body.                    |
| Generation plan     | Ephemeral, in-memory rules the generator executes. Never persisted, never exported.           |
| Input adapter       | A service that turns one source kind into a snapshot.                                         |
| Export adapter      | A service that turns a snapshot into source code for one target.                              |
| Use case            | An application service shared by every transport.                                             |

## Persisted metadata

### The response

`ResponseSchema` gains two optional fields. Both are written only by laqi's own
use cases. A hand-written response has neither.

```ts
// packages/schema/src/response.ts — normative field set, Zod declarations in phase 1
type MockResponse = {
  status: number
  body?: unknown
  delay?: number
  headers?: Record<string, string>
  description?: string
  /** The schema this response is associated with. Independent of how the body was obtained. */
  schema?: SchemaSnapshot
  /** Present only when laqi generated the current body from `schema`. */
  generation?: GenerationEvidence
}
```

`generatedFrom`, in both its `model` and `recipe` forms, **must not** exist in the
final schema. There is no compatibility branch: a document carrying it fails
validation like any unknown field would, with a message naming the field.

### `SchemaSnapshot`

```ts
type SchemaSnapshot = {
  /** Display name: the declaration, component or export the document came from. */
  name: string
  /** JSON Schema, draft 2020-12, exactly as the adapter produced it. */
  document: JsonSchema
  source: SourceDescriptor
  /** Every diagnostic the import produced. Empty for a clean import. */
  diagnostics: Diagnostic[]
}

type JsonSchema = boolean | { [keyword: string]: unknown }
```

Rules:

- `document.$schema` **must** be `https://json-schema.org/draft/2020-12/schema` on
  every stored document. An adapter that received another dialect normalizes and
  records a `dialect.normalized` diagnostic.
- A **stored root document is always an object.** `true` and `false` are legal
  JSON Schema values and appear nested — `items: false` is how a tuple closes — but
  the root is where the dialect is declared and a boolean has nowhere to declare
  it. A root `true` is stored as `{}`; a root `false` fails as `unsatisfiable` and
  is never stored.
- The document is stored **as produced**. laqi **must not** add
  `additionalProperties: false` to an imported document, and **must not** remove
  it when the source supplied it. The TypeScript adapter emits it, because closed
  objects are what a TypeScript interface means; that is the source's intent, not
  laqi's addition.
- Nothing else is stored beside the document: no `Shape`, no packed form, no
  original TypeScript, no runtime object.
- `name` is a label. It never selects behavior.

### `SourceDescriptor`

A discriminated union. `kind` describes where the **document** came from, never
where the body came from.

```ts
type SourceDescriptor =
  | { kind: 'typescript-paste' }
  | { kind: 'json-schema'; file?: string }
  | { kind: 'openapi'; file?: string; pointer: string }
  | { kind: 'project-module'; file: string; exportName: string; side: 'input' | 'output' }
```

- `file` is relative to `schemaSources.root` (see [Path bases](#path-bases-and-confinement)).
  A paste has no file. laqi **must not** invent one.
- `pointer` for OpenAPI is the JSON Pointer to the response schema inside the
  document, so a refresh can find it again.
- `side` records which Standard JSON Schema conversion was used. Response imports
  default to `output`.

### `Diagnostic`

```ts
type Diagnostic = {
  code: string
  severity: 'warning' | 'error'
  kind: 'loss' | 'information'
  /** JSON Pointer into the source where one exists; '' otherwise. */
  pointer: string
  message: string
}
```

`kind` and `severity` answer different questions, and a diagnostic carries both.
`kind` says what was lost: `loss` means the document does not say what the source
said, `information` means laqi did something worth reporting that changed no
meaning. `severity` says whether the import can proceed: `error` never can,
`warning` is blocked by the strict default and may be acknowledged when the code
allows it. A rejected import is `kind: 'loss'` — nothing of the source survived it
— which is what lets the loss policy read one field to decide whether to refuse.

Every diagnostic, of either kind, is persisted with the snapshot and replayed by
regeneration and export after a reload.

The table is the source of truth: `diagnostic(code, message)` reads kind and
severity from it, and a stored diagnostic whose kind or severity disagrees with its
code is refused on load. Codes are stable once shipped. Implemented in
`packages/schema/src/diagnostics.ts`.

| Code                        | Kind        | Severity | May be acknowledged | Raised when                                                                                |
| --------------------------- | ----------- | -------- | ------------------- | ------------------------------------------------------------------------------------------ |
| `loss.unresolved-type`      | loss        | warning  | yes                 | A TypeScript type resolved to `any`/`unknown`, usually an absent import                    |
| `loss.union-narrowed`       | loss        | warning  | yes                 | A mixed union was narrowed to one member                                                   |
| `loss.function`             | loss        | warning  | yes                 | A callable type has no data form                                                           |
| `loss.index-signature`      | loss        | warning  | yes                 | Named properties and a string index existed together; the index was dropped                |
| `loss.depth`                | loss        | warning  | no                  | Nesting exceeded the budget                                                                |
| `loss.circular`             | loss        | warning  | yes                 | A self-reference was cut                                                                   |
| `loss.approximated`         | loss        | warning  | yes                 | An acknowledged generation approximation was applied (see loss policy)                     |
| `export.tuple-approximated` | loss        | warning  | yes                 | An exporter rendered a tuple as a union-typed array                                        |
| `unsupported.keyword`       | loss        | error    | no                  | A keyword outside the supported vocabulary                                                 |
| `unsupported.combination`   | loss        | error    | no                  | An `anyOf`/`oneOf`/`allOf` case outside the supported set                                  |
| `invalid.document`          | loss        | error    | no                  | Not a JSON Schema, or fails the meta-schema                                                |
| `unsatisfiable`             | loss        | error    | no                  | No JSON value can satisfy the document (`false`, empty `enum`, `minItems` > `maxItems`, …) |
| `dialect.unknown`           | loss        | error    | no                  | `$schema` names a dialect laqi does not normalize                                          |
| `budget.exceeded`           | loss        | error    | no                  | Bytes, nodes, references or output values exceeded a limit                                 |
| `dialect.normalized`        | information | warning  | n/a                 | draft-07 or OpenAPI 3.0 forms were rewritten to 2020-12                                    |
| `side.selected`             | information | warning  | n/a                 | Which Standard JSON Schema side was used                                                   |

`loss.depth` is the one warning that cannot be acknowledged: the fix is to raise the
budget or trim the source, not to store a truncated document. So acknowledgeability
is its own column, not something read off `severity`.

### `GenerationEvidence`

```ts
type GenerationEvidence = {
  seed: number
  /** Every option that influenced the output, with the value actually used. */
  options: { arrayLength: number; [option: string]: unknown }
  /** SHA-256, lowercase hex, of the canonical JSON of the body laqi wrote. */
  bodyHash: string
}
```

- When the caller supplies no seed, laqi **must** allocate one and record it. A
  generated body always has a seed.
- `options` records effective values, not requested ones. `arrayLength` is always
  present. Any future input that changes output (a reference date, a locale)
  **must** be added here when it is introduced.
- `bodyHash` is over the body **as written**, computed in the same operation that
  writes it. Evidence and body are updated atomically.

### Canonical JSON

For hashing only. Never for storage.

1. Objects: keys sorted by UTF-16 code units, recursively.
2. Arrays: order preserved.
3. No whitespace.
4. Numbers, strings, booleans, `null` as `JSON.stringify` emits them.
5. An absent body hashes the empty string; a `null` body hashes the four bytes
   `null`. The two are distinct.

### Examples

A body generated from a pasted TypeScript interface:

```json
{
  "status": 200,
  "body": { "id": "inv_9c1f2a", "status": "issued" },
  "schema": {
    "name": "Invoice",
    "source": { "kind": "typescript-paste" },
    "diagnostics": [],
    "document": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "status": { "enum": ["draft", "issued", "paid"] }
      },
      "required": ["id", "status"],
      "additionalProperties": false
    }
  },
  "generation": {
    "seed": 813402,
    "options": { "arrayLength": 3 },
    "bodyHash": "9b74c9897bac770ffc029102a200c5de4a7a5fb8e5b7a07f1a6ea7d3d2c6c0e1"
  }
}
```

An OpenAPI response whose body came from the spec's `example`. There is a schema
association and **no** generation evidence, because nothing was generated:

```json
{
  "status": 200,
  "body": { "id": 7, "name": "Ada" },
  "schema": {
    "name": "User",
    "source": { "kind": "openapi", "file": "openapi.yaml", "pointer": "/components/schemas/User" },
    "diagnostics": [{ "code": "dialect.normalized", "severity": "warning", "kind": "information", "pointer": "", "message": "OpenAPI 3.0 `nullable` rewritten as a type union" }],
    "document": { "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "properties": { "id": { "type": "integer" }, "name": { "type": ["string", "null"] } } }
  }
}
```

A hand-written response, unchanged from today:

```json
{ "status": 404, "body": { "error": "not found" } }
```

## Supported vocabulary

### The phase-2 minimum: the emitter's output

**Invariant.** For every valid `Shape`, `compile(shapeToJsonSchema(shape))` **must**
succeed, and generating from the compiled plan with a given seed and effective
options **must** produce the same value as generating from the `Shape` directly.
This is the non-regression gate for phase 2, and phase 3 **must not** emit a
keyword outside it.

`shapeToJsonSchema` emits exactly these forms today, and each has a generation
meaning the compiler **must** honor:

| Emitted form                                                                    | From Shape        | Generation meaning                                                   |
| ------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `{ type: 'string' }`                                                            | primitive string  | faker string; field-name heuristics apply                            |
| `{ type: 'number' }`                                                            | primitive number  | faker number; field-name heuristics apply                            |
| `{ type: 'integer' }`                                                           | primitive integer | faker integer                                                        |
| `{ type: 'boolean' }`                                                           | primitive boolean | random boolean                                                       |
| `{ type: 'null' }`                                                              | primitive null    | `null`                                                               |
| `{ type: 'string', format: 'date-time' }`                                       | primitive date    | ISO 8601 date-time string; the date heuristics apply                 |
| `{}`                                                                            | unknown           | `null` (see the loss policy for whether it may be stored)            |
| `{ enum: [...] }`                                                               | literals          | one member of the enum, uniformly                                    |
| `{ type: 'object', properties, required, additionalProperties: false }`         | object            | every property in `properties`, required or not; no extra properties |
| `{ type: 'object', additionalProperties: <schema> }` with no `properties`       | record            | exactly two keys, each value from the schema                         |
| `{ type: 'array', items: <schema> }`                                            | array             | `arrayLength` items                                                  |
| `{ type: 'array', prefixItems: [...], items: false, minItems: n, maxItems: n }` | tuple             | exactly `n` items, each from its positional schema                   |

Both rows describe what phase 1 measured, not what the plan assumed. Today's
`generate()` emits **every** property of an object, optional or not — deliberately,
so a mock shows the full shape of what an endpoint can return — and emits **two**
keys for a record regardless of `arrayLength`. Earlier drafts of this spec said
"probability 0.5" and "`arrayLength` keys"; neither was true, and either would have
broken the invariant above on its first fixture.

Both are pinned in `packages/generate/goldens/`. Changing either is a deliberate
behaviour change to `generate()`, made in its own commit with the golden diff read,
and is out of scope for the compiler. The record's fixed two is the weaker of the
two: it ignores an option the caller set, and is the more likely of the pair to be
revisited.

### Additive support

Beyond the minimum, the compiler may accept the following. Each is either fully
honored or rejected with `unsupported.keyword`; nothing is partially honored.

| Family       | Accepted forms                                                                                                                         | Rejected with                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Scalars      | `const`; `type` as an array of primitive names (one is chosen uniformly)                                                               | non-primitive members                                                              |
| Enumerations | `enum` with `null` or mixed primitive members                                                                                          | object or array members                                                            |
| Numbers      | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`                                                             | contradictory bounds → `unsatisfiable`                                             |
| Strings      | `minLength`, `maxLength`; `format` in `date-time`, `date`, `email`, `uri`, `uuid`                                                      | `pattern`, other formats                                                           |
| Arrays       | `minItems`, `maxItems`, `uniqueItems`                                                                                                  | `contains`, `unevaluatedItems`                                                     |
| Objects      | `required` naming a property not in `properties` (generated as `{}`-typed, with a warning)                                             | `patternProperties`, `propertyNames`, `dependentRequired`, `unevaluatedProperties` |
| References   | `$ref` to `#/$defs/...` and `#/definitions/...` within the same document; cycles cut at `MAX_SHAPE_DEPTH` with `loss.circular`         | any `$ref` outside the document → `unsupported.keyword`; never fetched             |
| Combinations | `anyOf`/`oneOf` whose members are all scalars or all enums (one member chosen); `allOf` of objects with disjoint `properties` (merged) | overlapping `allOf`, object `oneOf`, `not`, `if`/`then`/`else`                     |
| Boolean      | `true` → `null`; `false` → `unsatisfiable`                                                                                             |                                                                                    |
| Annotations  | `title`, `description`, `examples`, `default`, `deprecated`, `$comment`, `$id`, `$defs`                                                | never affect generation, never rejected                                            |

Any keyword not in either table is an **assertion laqi does not understand** and
**must** be rejected with `unsupported.keyword`. Unknown vocabulary is never treated
as an annotation.

### Dialects

| `$schema`                                            | Treatment                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| absent                                               | assumed 2020-12; an `information` diagnostic says so                                                       |
| draft 2020-12                                        | accepted as is                                                                                             |
| draft-07                                             | `definitions` → `$defs`; `items: [...]` → `prefixItems`; `additionalItems` → `items`; `dialect.normalized` |
| OpenAPI 3.0 (no `$schema`; detected by the importer) | `nullable: true` → type union with `null`; `example` → `examples`; `dialect.normalized`                    |
| anything else                                        | `dialect.unknown`, import fails                                                                            |

The stored document always carries the 2020-12 `$schema` after normalization.

## One loss policy

**Strict is the default for every input.** An import whose diagnostics contain
any `kind: 'loss'` entry **must not** be saved and **must not** be used to
generate. The use case returns the diagnostics and writes nothing.

`allowLoss: true` on the request acknowledges **specified approximations only**:

| Loss                    | May be acknowledged | What is stored                                                                      |
| ----------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `loss.unresolved-type`  | yes                 | `{}` at that pointer, plus the diagnostic                                           |
| `loss.union-narrowed`   | yes                 | the narrowed member, plus the diagnostic naming the members dropped                 |
| `loss.function`         | yes                 | `{}` plus the diagnostic                                                            |
| `loss.index-signature`  | yes                 | the named properties, plus the diagnostic                                           |
| `loss.circular`         | yes                 | `{}` at the cut, plus the diagnostic                                                |
| `loss.depth`            | no                  | fails; raise the budget or trim the source                                          |
| any `severity: 'error'` | no                  | invalid documents, unsatisfiable schemas, unknown dialects and budgets never bypass |

Every acknowledged loss is persisted in `schema.diagnostics`. After a reload,
regeneration and export **must** return those diagnostics again, and the panel
**must** keep its approximation label. The acknowledgement is not stored as a
flag; the persisted diagnostics are the record.

**An explicit `{}` in the source is not loss.** A JSON Schema document that says
`"metadata": {}` means unconstrained JSON, and is stored without a diagnostic. A
TypeScript type that laqi could not resolve **is** loss, and reaches the document
as `{}` only under `allowLoss`, with `loss.unresolved-type` beside it. The
distinction lives in the diagnostics, never inferred from the document.

The TypeScript adapter **must** translate every warning `parseTypes` produces today
into a `loss` diagnostic with a pointer. Reusing the parser does not carry its
permissive save behavior forward.

## Ports, adapters and use cases

All of this lives in `@laqi/generate`, as Effect services, following
[ADR-0012](/decisions/0012-effect-first-in-generate/) and the existing pattern of
`TypeScriptCompiler`, `FakerFactory` and `Quicktype`: a `Context.Tag` per service,
a `Live` layer, composition in `GenerateServicesLive`, Promise facades only at the
package edge. There is no abstract adapter class, no vendor-only subclass, and no
constructor-injection container.

### Ports

```ts
// illustrative — exact declarations in phase 1
interface InputAdapter<TInput> {
  readonly id: string
  toSnapshot(input: TInput, options: { allowLoss: boolean }): Effect.Effect<SchemaSnapshot, ImportError>
}

interface ExportAdapter {
  readonly id: string
  readonly targets: readonly string[]
  export(snapshot: SchemaSnapshot, target: string): Effect.Effect<Exported, ExportError>
}

type Exported = { code: string; language: string; diagnostics: Diagnostic[] }
```

`ImportError` and `ExportError` are tagged errors carrying `diagnostics`. A
failed import returns its diagnostics through the error, so a transport can show
them without a second call.

### Input adapters

| Service                   | Input                                                          | Notes                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TypeScriptInput`         | `{ source: string; typeName?: string }`                        | Wraps `parseTypes`; picks the declaration as today; emits via `shapeToJsonSchema`                                                      |
| `JsonSchemaInput`         | `{ document: unknown; name?: string }`                         | Validates against the 2020-12 meta-schema; normalizes dialects; compiles to check support                                              |
| `OpenApiInput`            | `{ document: unknown; pointer: string }`                       | Extracts one response schema in its document context; normalizes 3.0                                                                   |
| `StandardJsonSchemaInput` | `{ object: unknown; side: 'input' \| 'output'; name: string }` | Checks for `~standard.jsonSchema`; calls the chosen side with `{ target: 'draft-2020-12' }`; a thrown conversion becomes `ImportError` |

`StandardJsonSchemaInput` discovers capability by the presence and shape of
`~standard.jsonSchema`, never by `vendor`. Zod, Valibot and ArkType are test
fixtures against this one service. A vendor-specific service is added only when a
vendor needs options, has different conversion semantics, or needs error context
the generic path cannot give, and that need is written down when it is added.

### Registration and requests

Transports build a discriminated `SourceRequest` and hand it to one use case:

```ts
type SourceRequest =
  | { kind: 'typescript-paste'; source: string; typeName?: string }
  | { kind: 'json-schema'; document: unknown; name?: string }
  | { kind: 'openapi'; document: unknown; pointer: string }
  | { kind: 'project-module'; file: string; exportName: string; side: 'input' | 'output' }
```

The composition root maps `kind` to a service. An unknown `kind` is
`ImportError{ code: 'adapter.unknown' }` with the list of known kinds. Runtime
objects never travel over HTTP or MCP; `project-module` carries a descriptor and the
object is produced locally, under the rules in [Executing project code](#executing-project-code).

### Use cases

Every transport calls these and nothing else. None of them decide policy that
another transport would decide differently.

| Use case             | Input                                                                   | Output                                      | Fails with                            |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| `importSchema`       | `SourceRequest`, `allowLoss`                                            | `SchemaSnapshot`                            | `ImportError` with diagnostics        |
| `previewBody`        | `SchemaSnapshot`, `{ seed?, arrayLength? }`                             | `{ body, evidence, diagnostics }`           | `GenerateError`                       |
| `regenerate`         | endpoint id, response name, `{ seed?, arrayLength? }`, `revision`       | as `previewBody`, using the stored snapshot | `NotFound`, `NoSchema`, `Conflict`    |
| `applyGeneratedBody` | endpoint id, response name, `{ body, evidence }`, `revision`, `confirm` | `{ revision }`                              | `Conflict` (see below)                |
| `refreshSchema`      | endpoint id, response name, `revision`, `allowLoss`                     | new snapshot; body untouched                | `ImportError`, `NoSource`, `Conflict` |
| `exportTypes`        | `SchemaSnapshot`, target                                                | `Exported`                                  | `ExportError`                         |
| `inferTypes`         | body, target                                                            | `Exported` labeled `origin: 'inference'`    | `ExportError`                         |

`regenerate` on a response with no `schema` **must** fail with `NoSchema`. It never
silently falls back to inference; the transport offers `inferTypes` and body
inference as visibly different actions.

### Conflict rules for the body

`applyGeneratedBody` **must** refuse, with `Conflict`, unless all of the following hold:

1. The `revision` the caller observed equals the response's current revision at
   write time. Revision is the file's content hash for that response, computed
   under the writer's lock.
2. Either `generation.bodyHash` is present and equals the canonical hash of the
   current body, or the caller passed `confirm: true`.

The second condition is how an edited body, an example-sourced body and a body
whose hash changed because the generator changed are all protected the same way:
they have no matching evidence, so replacing them needs a confirmation. A
transport that cannot ask (MCP) returns the conflict and requires a follow-up call
with `confirm: true` and the fresh revision. Evidence and body are written in one
atomic write. No previous body is stored to implement this.

`refreshSchema` updates `schema` only. It **must not** change `body` or
`generation`. When the source descriptor has no `file` (a paste), there is nothing
to refresh from and the use case fails with `NoSource`; the panel offers re-import
instead.

## Transports

### Local HTTP control plane

All routes stay on the local-only listener, behind the existing loopback, Origin
and Host checks and the write-request protections. Nothing here is reachable
through `--share`.

| Route                                                    | Body                                              | Returns                                               |
| -------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `POST /api/schema/import`                                | `{ source: SourceRequest, allowLoss?: boolean }`  | `{ snapshot }` or `422 { diagnostics }`               |
| `POST /api/schema/preview`                               | `{ snapshot, seed?, arrayLength? }`               | `{ body, evidence, diagnostics }`                     |
| `POST /api/endpoints/:id/responses/:name/regenerate`     | `{ seed?, arrayLength?, revision }`               | as preview, plus `revision`                           |
| `PUT /api/endpoints/:id/responses/:name/body`            | `{ body, evidence, revision, confirm?: boolean }` | `{ revision }` or `409 { reason, revision }`          |
| `POST /api/endpoints/:id/responses/:name/schema/refresh` | `{ revision, allowLoss?: boolean }`               | `{ snapshot, revision }`                              |
| `POST /api/schema/export`                                | `{ snapshot, target }`                            | `{ code, language, diagnostics, origin: 'schema' }`   |
| `GET /api/endpoints/:id/types?response=&lang=`           | as today                                          | `{ code, language, origin: 'schema' \| 'inference' }` |
| `GET /api/schema/capabilities`                           |                                                   | `{ inputs: [...], exports: { target: [...] } }`       |

The existing `POST /api/generate/data` keeps working during phase 3 and is removed
at the end of it; the panel moves to the routes above.

`GET .../types` returns the exported form of the stored snapshot when one exists,
and inference from the body otherwise. `origin` says which. A snapshot whose
document fails to compile at export time **must not** be reported as
`origin: 'schema'`; the route falls back to inference and says so in
`diagnostics`.

### Executing project code

Loading `project-module` executes the user's module and everything it imports.
laqi bounds who may trigger it, not what it does.

**From the panel, over local HTTP, in two steps:**

1. `POST /api/schema/module/prepare` with `{ file, exportName, side }`. laqi
   resolves the path (see [Path bases](#path-bases-and-confinement)), computes a
   digest of the resolved file, and returns `{ token, resolvedPath, exportName, side, digest }`.
   Nothing is executed.
2. The panel shows the resolved path and export and asks for confirmation.
   `POST /api/schema/module/confirm` with `{ token }` executes the load and runs
   `importSchema`.

The token is single-use, expires after 120 seconds, and is bound to the exact
`{ resolvedPath, exportName, side, digest }`. If the file's digest differs at
confirm time, the token is rejected and the panel must prepare again. A
caller-supplied `confirmed: true` field is not approval; only a valid token is.

**From MCP:** a `project-module` request executes only if `{ file, exportName }` is
listed in `mcp.modules` in `laqi.config.json`. MCP **must not** be able to write
that list, and **must not** be able to redeem a panel token. Without a match the
tool returns an actionable error naming the config key. Document-based sources
(`json-schema`, `openapi`, `typescript-paste`) need no permission.

**Never:** evaluate pasted code, load a module during an ordinary read, or load one
from a public listener.

Loading happens in a child process so that laqi's own process survives a module
that throws, hangs or exits. That child is a lifecycle boundary, not a sandbox; the
docs say so in those words.

### MCP

Existing tools keep their names. Changes:

| Tool                                 | Change                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `generate_data`                      | Accepts `source: SourceRequest` and `allowLoss`; returns `{ preview, snapshot, evidence, diagnostics }`           |
| `create_endpoint`, `update_endpoint` | Accept `schema` and `generation` on a response; validated like any field                                          |
| `regenerate_response`                | New. `{ id, response, seed?, arrayLength?, revision }` → preview + evidence; does not write                       |
| `apply_generated_body`               | New. Writes; returns `conflict` with the current revision when the rules above refuse; retry with `confirm: true` |
| `refresh_schema`                     | New. Schema only; never the body                                                                                  |
| `get_types`                          | Returns `origin` beside the code                                                                                  |

Tool descriptions state the strict default, the meaning of `allowLoss`, and that
`apply_generated_body` may return a conflict that needs an explicit follow-up.

### Panel

- The types panel shows the exported form of the stored snapshot with the label
  _from the stored schema_, or inference from the body with the label
  _inferred from the body_. When any `loss` diagnostic is present, a third label
  _approximation acknowledged_ appears with the diagnostics listed.
- **Regenerate** previews; **Apply** writes through `applyGeneratedBody` and shows
  the conflict reason inline when refused, with a confirm button that resends with
  `confirm: true`.
- **Refresh schema** exists only when `source.file` is set. It previews the new
  snapshot and its diagnostics before writing.
- The create row's model flow calls `importSchema` then `previewBody`; on strict
  failure it shows the diagnostics and an _accept approximation_ control that
  resends with `allowLoss: true`.
- The source picker for `project-module` shows the resolved `schemaSources.root`
  and the confirmation step above.

## Configuration

`laqi.config.json` gains:

```json
{
  "schemaSources": { "root": "." },
  "mcp": { "modules": [{ "file": "src/types/api.ts", "exportName": "Invoice", "side": "output" }] }
}
```

- `schemaSources.root` is relative to `Project.root`. Default `.`. Every
  `source.file` in a request or in persisted metadata is relative to it.
- `mcp.modules` is the only way MCP may execute project code. `side` defaults to
  `output`.

## Path bases and confinement

The writer already separates two things: `Project.root`, which resolves paths, and
its write bounds, which confine writes to `--dir`/`--file`. Schema sources reuse
the first and define their own second:

| Concept           | Value                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Resolution base   | `Project.root`, never `process.cwd()`                                                       |
| Source bounds     | `resolve(Project.root, schemaSources.root)`                                                 |
| Containment check | the writer's canonical realpath-with-missing-tail algorithm, with source bounds as the base |
| Write bounds      | unchanged: `--dir` / `--file`                                                               |

A source path that resolves outside the source bounds, through symlinks or `..`,
**must** be refused before anything is read. The mocks' write bounds are never used
for sources: `src/types` legitimately lives outside `laqi/`. Conversely, a source
path never grants a write anywhere.

Budgets, all enforced before work proceeds:

| Budget                | Limit                                |
| --------------------- | ------------------------------------ |
| Source bytes          | `MAX_SOURCE_LENGTH`, 200,000         |
| Document nesting      | `MAX_SHAPE_DEPTH`, 500               |
| Reference resolutions | 10,000 per import                    |
| Generated values      | `MAX_GENERATED_VALUES`, 100,000      |
| Module load wall time | 10 seconds, then the child is killed |

## Writer layout

The writer replaces `JSON.stringify(value, null, 2)` with a JSON-aware serializer.
This is phase-3 work and phase 3 owns its tests.

Rules:

1. Two-space indentation; object key order preserved; escaping identical to
   `JSON.stringify`; trailing newline; atomic write, as today.
2. An array whose elements are all scalars (`string`, `number`, `boolean`, `null`)
   is written on one line when the complete indented line is at most 100 columns.
3. An empty array or object is written inline.
4. Any other array, and any object with members, expands one member per line.
5. No regular-expression rewriting of serialized text.

Effect on this feature: `required` and `enum` lists, which are the bulk of a
document's lines, collapse to one line each. Phase 3 records the `flat` fixture's
bytes and lines before and after; phase 6 re-verifies the numbers.

## Export

- `Quicktype` is wrapped as an `ExportAdapter` that consumes the snapshot's
  document directly. The export path never goes JSON Schema → `Shape` → JSON Schema.
- The quicktype tuple degradation documented in `print-types.ts` is reported as
  `export.tuple-approximated` on every target where it applies. It never touches
  generation, which runs from the compiled plan.
- `GET /api/schema/capabilities` and the MCP tool descriptions list **implemented
  targets only**. Zod, Valibot and ArkType code targets are absent until each has
  a printer whose output was compiled and executed against its dependency version.
- Exported code is labeled as generated from a snapshot. It does not reproduce
  comments, helper declarations, refinements or transforms of the original source.

## OpenAPI

`import_openapi` and the OpenAPI adapter share one extraction. For each response:

1. If the spec supplies `example` or `examples`, the first value is the body,
   byte-for-value. `schema` is still associated when a schema exists. No
   `generation` record is written.
2. Otherwise the body is generated from the normalized schema through the common
   path, and `generation` is recorded.

`source.pointer` records the component or inline schema used, so `refreshSchema`
can re-extract it from the same document path.

## Removal

Phase 3 deletes, with no compatibility layer:

- `packages/generate/src/recipe.ts` and `recipe.test.ts`
- `GeneratedFromSchema`, both variants, and the `generatedFrom` field
- Every branch that reads `generatedFrom.model` or `generatedFrom.recipe`
- Fixtures under laqi's ownership that carry either form

Customer or working-tree files are never rewritten automatically. A file carrying
the old field fails validation with a message that names the field and this
replacement.

## Tests that gate the phases

Phase exits are the plan's. These are the tests that prove them, by area.

**Phase 1 — characterization.** Golden tests pin today's `generate()` output for
every `Shape` variant and the four example models at fixed seeds, including
optional-property presence and record key counts. These goldens are the oracle for
the phase-2 invariant.

**Phase 2 — compiler.**

- `compile(shapeToJsonSchema(shape))` succeeds for every `Shape` variant and every
  example model, and generation matches the phase-1 goldens value for value.
- Each additive keyword has a fixture that is honored, and each rejected form has a
  fixture that fails with the named code.
- Each dialect row has a normalization fixture, and the stored `$schema` is
  2020-12 after it.
- Every generated fixture satisfies an independent JSON Schema validator against
  its document. This validator is a dev dependency and never ships.
- `false`, empty `enum`, and contradictory bounds fail with `unsatisfiable`.
- Local `$ref` cycles are cut with `loss.circular`; a `$ref` to another document
  is rejected without a network request, asserted with a blocked fetch.
- The compiler and generator load without the TypeScript compiler or quicktype.

**Phase 3 — persistence and transports.**

- Strict import with a loss returns diagnostics and writes nothing, identically
  over HTTP and real MCP stdio.
- `allowLoss` stores the listed approximations with their diagnostics; a reload
  followed by regenerate and export returns the same diagnostics.
- An explicit `{}` imports with no diagnostic.
- `additionalProperties: false` supplied by a JSON Schema import survives to disk;
  an import without it does not gain it.
- Create → save → restart → regenerate preserves enums, optionals and tuple arity.
- `applyGeneratedBody`: untouched body applies; hand-edited body conflicts; OpenAPI
  example body conflicts; same seed with a changed generator output conflicts;
  stale revision conflicts even with `confirm: true`; `confirm: true` with a fresh
  revision applies; concurrent writes are serialized under the file lock.
- `refreshSchema` changes `schema` only; body bytes are identical before and after.
- The old `generatedFrom` field fails validation with the named message.
- Writer: parsed value equality for every fixture; `required` and `enum` on one
  line; a long scalar array expands; nested arrays expand; empty containers inline.

**Phase 4 — Standard JSON Schema and modules.**

- Real Zod, Valibot and ArkType fixtures at their pinned versions convert on both
  sides; an object without `~standard.jsonSchema` fails with a capability error; a
  converter that throws becomes `ImportError` with the vendor message.
- Panel flow: prepare returns a token; confirm with it executes once; a second
  confirm fails; confirm after 120 seconds fails; confirm after the file changed
  fails; `confirmed: true` in the body does nothing.
- MCP: an unlisted module is refused with the config key named; a listed one
  executes; MCP cannot alter `mcp.modules`.
- Path bases: launched from another directory, with an external `--dir`, in file
  mode, with `..` traversal, with a symlink escape, and with a valid source under
  `src/types` outside `laqi/`.
- Only the requested integration's package is loaded, asserted through module
  loading spies.

**Phase 5 — OpenAPI and export.**

- An example-sourced response has `schema` and no `generation`; a schema-only
  response has both.
- Capability lists equal the set of targets with passing printer tests.
- Every target that degrades tuples reports `export.tuple-approximated`.
- Export never writes to the mock file.

**Phase 6 — measurement.** Cold import, warm regeneration, export, peak memory,
minified and pretty-printed file size for all fixtures, recorded in the plan.
Packaged CLI, plain Node, MCP and the browser flow are exercised end to end.

## Left to implementation evidence

The plan is explicit that these need evidence, not approval:

- The exact additive keyword set at first release, beyond the fixed minimum.
- Whether `Shape` remains the compiled plan or the compiler generates from the
  document directly.
- Module-loader packaging and the child-process mechanism.
- The reference and wall-time budgets above, which are starting values.
- Exporter engines for library-specific code targets.

## References

- [Plan 14 — JSON Schema and adapters](/plans/2026-09-07-14-json-schema-adapters/)
- [ADR-0012 — Effect boundary](/decisions/0012-effect-first-in-generate/)
- [ADR-0013 — to be revised to this spec](/decisions/0013-mocks-remember-their-model/)
- [Storing models in mocks — adversarial analysis](/adversarial/storing-models-in-mocks/)
- [Data generators — the superseded design](/design/data-generators/)
- [JSON Schema draft 2020-12](https://json-schema.org/draft/2020-12)
- [Standard JSON Schema](https://standardschema.dev/json-schema)
