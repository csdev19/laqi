---
title: Plan 14 — JSON Schema and adapters
---

# Plan 14 — JSON Schema and adapters

**Date:** 2026-09-07
**Status:** Planned — specification decisions revised after the twelve-point review on 2026-09-07.
**Scope:** Replace proprietary generation metadata with JSON Schema and introduce
explicit input/output adapters across the panel, local API, and MCP.

This document consolidates the product decisions and implementation direction.
It does not claim the implementation or its verification is complete. The current
working tree contains an earlier compact-recipe experiment; passing checks for
that experiment are not acceptance evidence for this plan.

## Product decisions

1. Laqi serves and generates mocks. The customer's repository or specification
   remains the authority for their API contract.
2. Schema processing and persistence happen locally, under the customer's control.
   No hosted schema registry, account, telemetry payload, or cloud conversion is
   required by this feature.
3. JSON Schema, from **json-schema.org**, becomes the common interchange and
   persistence format for generation rules. Target dialect: draft 2020-12.
4. Remove the compact tagged-array recipe, its codec, and persisted TypeScript
   source. There are no users requiring compatibility for this experimental
   feature: no dual formats, legacy branches, or migration subsystem.
5. Retain sufficient rules to regenerate faithfully. A generated JSON sample
   cannot recover enums, omitted optional fields, or tuple arity.
6. Use classical ports and adapters with explicit base contracts, dependency
   inversion, and narrow responsibilities. Adapters are Effect services inside
   generate, with Promise facades at the package boundary (ADR-0012).
7. Importing models and exporting code are separate capabilities.
8. The paste box remains a quick local convenience. Project references and schema
   imports are the durable integration direction.
9. A stored schema records imported rules; it does not certify the current body
   or the customer's real backend. Manual mock edits may intentionally violate it.
10. Runtime body validation is a non-goal. Do not invoke Standard Schema's
    `validate` method or gate serving/saving manual bodies on schema conformance.
    Independent validators are used in development tests only.

## Names and responsibilities

| Name                 | Meaning in this plan                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| JSON Schema          | The document format from json-schema.org describing data and constraints.                                     |
| Standard Schema      | The validation interface from standardschema.dev. It answers whether supplied data passes a validator.        |
| Standard JSON Schema | A separate interface from standardschema.dev for obtaining input/output JSON Schema from a compatible object. |
| Source               | A pasted type, schema document, OpenAPI response schema, or customer-owned runtime schema object.             |
| Schema snapshot      | Local JSON Schema retained for generation, with optional provenance.                                          |
| Adapter              | A boundary translating a specific source or export target.                                                    |
| Generation plan      | An internal, ephemeral representation of rules the generator can execute.                                     |
| Diagnostic           | A structured explanation of conversion loss, unsupported rules, or invalid input.                             |

Standard JSON Schema is a bridge to JSON Schema, not another storage format.
Standard Schema validation alone cannot provide generation rules. Support for one
interface does not imply support for the other.

## Architecture

```text
TypeScript text ───── TypeScriptAdapter ───────────┐
JSON Schema file ──── JsonSchemaAdapter ───────────┤
OpenAPI document ──── OpenApiAdapter ──────────────┼─ JSON Schema snapshot
Runtime schema ────── StandardJsonSchemaAdapter ──┘       │
                                                        ├─ local persistence
                                                        ├─ generation compiler → mocks
                                                        └─ export adapters → source code
```

Panel, HTTP handlers, and MCP invoke shared application use cases. They must not
each implement their own source selection, fallback, or schema interpretation.
Serving a saved body does not invoke adapters, compilers, or exporters.

### DDD and SOLID applied concretely

- The generation domain owns schema snapshots, diagnostics, supported generation
  semantics, and deterministic generation behavior.
- Application services orchestrate import, preview, regeneration, and export.
- Adapters isolate vendor APIs, TypeScript parsing, OpenAPI extraction, and code
  printers. File/module loading is a separate infrastructure responsibility.
- Persistence uses the existing project writer; adapters do not write mock files.
- Consumers depend on contracts, not Zod/Valibot/ArkType implementation details.
- Adding an adapter requires registration and contract tests, not changes to the
  generator or a growing vendor switch in every transport.
- Input adapters do not implement meaningless export methods, and exporters do
  not pretend to support parsing. No universal class with throwing stubs.
- Use value objects and services where useful; this feature does not require an
  artificial aggregate hierarchy, event bus, or repository per schema field.

### Base contracts and dependency injection

Use narrow interfaces as ports and Effect Context tags/Live layers as their
implementations, matching TypeScriptCompiler, FakerFactory, and Quicktype today.
No empty abstract Adapter, vendor-only subclasses, constructor-injection
container, or internal Promise orchestration. The sketch uses domain error types
whose exact declarations are implemented in phase 1.

```ts
type JsonSchema = boolean | { [keyword: string]: unknown }

type Diagnostic = {
  code: string
  severity: 'warning' | 'error'
  kind: 'loss' | 'information'
  pointer: string // JSON Pointer into the source where available
  message: string
}

type SchemaSnapshot = {
  name: string
  document: JsonSchema
  source: { kind: string; file?: string; exportName?: string }
  diagnostics: Diagnostic[]
}

interface InputAdapter<TInput> {
  readonly id: string
  toJsonSchema(input: TInput): Effect.Effect<SchemaSnapshot, ImportError>
}

interface ExportAdapter {
  readonly id: string
  export(snapshot: SchemaSnapshot): Effect.Effect<{
    code: string
    language: string
    diagnostics: Diagnostic[]
  }, ExportError>
}
```

Dependencies are provided through existing Effect layers; failure uses the typed
error channel. Promise facades run the shared runtime only at the package edge.
Runtime validation of schema documents and control requests is still required;
this is distinct from validating mock response bodies.

### Library-specific adapters

Implement one StandardJsonSchemaAdapter service, tested with real compatible
Zod, Valibot, and ArkType objects. Add a vendor-specific service only when options,
conversion semantics, or error context actually require it. A vendor name alone
does not justify a wrapper. Discover conversion capability rather than using a
vendor allowlist for interoperability. Do not inspect undocumented internals.

Use explicit registration at the composition root. Heterogeneous sources should
use a discriminated source request and typed registration; avoid unsafe casts in
the domain. Unknown adapters produce an actionable error.

### Input and output semantics

Standard JSON Schema exposes both input and output conversion. A source request
must identify which side is wanted. Response schema imports default to output;
request-related integrations may need input. Record the choice in provenance.
Conversion may fail for transformations or custom refinements; report that failure
instead of asserting equivalence.

## Persistence proposal

Replace `generatedFrom` with optional response metadata named `schema`. It stores
the imported schema association independently of how the body was obtained:

```json
{
  "status": 200,
  "body": { "id": "inv_example", "status": "issued" },
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
      "required": ["id", "status"]
    }
  }
}
```

Provenance may additionally contain a relative file path, export name, source
kind, and input/output selection. A paste has no file path: do not invent one.
Referenced definitions belong to the user. `source.kind` describes the schema
origin, not the body origin. OpenAPI examples retain their body byte-for-value
semantics and may carry associated schema metadata; they are never labeled as
generated. A separate optional `generation` record exists only for generated
bodies, as specified below. Schema-less manual responses remain valid.

### Refresh, generation evidence, and conflict handling

Persist `generation: { seed, options, bodyHash }` on successful generation.
Allocate a concrete seed when none was supplied; record all effective options
(including array length and any future clock/reference-date input). `bodyHash` is
SHA-256 of canonical JSON: object keys sorted recursively, array order preserved,
whitespace ignored; absent body is distinct from null.

Seed alone is insufficient: changing a schema, generator implementation, or faker
version can change the output without any manual edit. Compare the current body's
hash with the saved generation hash to detect divergence. Do not use regeneration
as the edit detector. Seeds support reproducibility within a fixed implementation,
not a guarantee across dependency upgrades.

Refreshing a schema updates only its snapshot/diagnostics after preview approval;
it never changes the body implicitly. A separate apply-generated-body action shows
a preview and requires confirmation when hashes differ or generation evidence is
absent (including OpenAPI examples). MCP returns a conflict requiring an explicit
follow-up overwrite request. Compare the previously observed response revision
again at write time to avoid overwriting concurrent edits. Update generation
evidence atomically with the new body. No old body or proprietary schema copy is
stored to implement this protection.

Store one schema representation. Do not persist `Shape`, packed recipes, runtime
objects, compiler state, or the original TypeScript alongside it. The schema
dialect is a standard identifier, not a proprietary v1/v2 compatibility mechanism.

There is no published mock-file schema.json today. A nested document's `$schema`
declares its JSON Schema dialect and does not identify the enclosing mock format.
If a mock-file schema is published later, its response `schema.document` property
must reference the JSON Schema meta-schema (including boolean schema support);
do not invent a current outer-schema compatibility conflict.

Existing responses with no generation metadata continue working. Experimental
source/recipe metadata is replaced outright in owned fixtures. Do not rewrite
unrelated customer or working-tree files automatically.

## Generation compiler and supported rules

**Non-regression invariant:** compiling `shapeToJsonSchema(shape)` must succeed
for every valid Shape supported today and preserve generation with identical seed
and effective options. The minimum vocabulary is exactly the emitter's output;
broader support is additive. Include date-time strings, prefixItems/closed tuples,
length bounds, `{}` for intentional unknown, schema-valued additionalProperties
for records, closed objects, enums, primitives, required fields, and nested arrays.
Contract tests cover every Shape variant and all four example models. Phase 2
cannot close without this invariant; phase 3 cannot emit unsupported keywords.

Implement the missing JSON Schema → executable generation rules direction in
`@laqi/generate`. Initially reuse the existing `Shape` and generator only where
they preserve semantics. Extend the internal plan where necessary; do not squeeze
new constraints into the current minimal Shape by silently dropping them.

`Shape` is optional implementation machinery, never another public schema format.
Remove it later only if generating directly from JSON Schema demonstrably reduces
complexity without duplicating normalization across branches.

| Rule family     | Required treatment                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Objects         | Required vs optional properties, nesting, additional properties.                                                             |
| Scalars         | String, number, integer, boolean, null; finite JSON values.                                                                  |
| Enumerations    | Preserve `enum` and `const`, including supported null/mixed cases.                                                           |
| Arrays          | Homogeneous items, min/max length, fixed tuples via `prefixItems` and closed items.                                          |
| References      | Resolve local document references with cycle detection and work limits.                                                      |
| Combinations    | Define supported `anyOf`, `oneOf`, `allOf` cases; reject unsupported intersections/exclusivity rather than pick arbitrarily. |
| Constraints     | Implement numeric bounds and supported string/format rules or report unsupported generation explicitly.                      |
| Boolean schemas | `true` permits any JSON; `false` cannot generate a conforming value.                                                         |
| Dialects        | Normalize supported older/OpenAPI forms; refuse unknown dialect assumptions.                                                 |

The supported subset is a published capability matrix, not a claim to implement
every JSON Schema keyword. OpenAPI 3.0 requires normalization; do not treat every
OpenAPI document as draft 2020-12. Local `$defs` and OpenAPI component references
have different source paths and must resolve in their document context.

### One loss policy across inputs

Strict is the default for every input. Conversion loss, including an unresolved
TypeScript import currently mapped to unknown, blocks save/generation. Translate
existing parser warnings to structured loss diagnostics; do not retain permissive
save behavior merely because the parser is reused.

An explicit `allowLoss: true` acknowledges supported approximations. Persist their
diagnostics in `schema.diagnostics`, including affected paths and approximation.
After reload, regeneration/export returns these diagnostics and the UI retains its
approximation label. Implement acknowledgement in phase 3 for panel, HTTP and MCP.
Without acknowledgement, return diagnostics without writing. Invalid documents,
unsatisfiable schemas, conversion exceptions and resource budgets cannot be bypassed.
Each permitted approximation is specified and tested; this is not a blanket waiver.

An explicit source `{}` is unconstrained JSON, not evidence of loss. An unresolved
type converted to `{}` is loss and carries a persisted diagnostic. Never attempt
to infer this distinction from the document alone. Preserve unsupported imported
constraints even if an explicitly acknowledged generation approximation ignores
them; do not save a silently weakened document.

### Preserve source meaning

Do not add `additionalProperties: false` when absent in an imported schema.
Preserve it when supplied. Removing all keywords the generator does not actively
use would weaken exports and erase source intent. Closed objects require no extra
generation work when generating only declared fields. The existing TypeScript
emitter produces false; accepting that belongs to the invariant above.
Schema-valued additionalProperties is also required to generate records.

The compiler consumes a generation projection; persistence and export retain
source constraints and annotations, with diagnostics for dialect conversions.
Whether metadata is authoritative depends on its documented provenance, not on
whether it contains a validation keyword. Unknown assertion vocabularies must not
silently be treated as harmless annotations.

## Local execution and privacy

JSON Schema and proprietary recipes both contain customer information. Encoding
is not anonymization. No conversion or generation requires sending it to Laqi.
Do not include source contents, examples, or schemas in telemetry or error logs.

The first usable entry accepts JSON Schema documents through local transports.
A subsequent local code entry imports an explicitly selected project module/export
and passes the resulting object to an adapter. Loading that module executes user
code and its imports; a separate process gives lifecycle control but is not a
security sandbox. Permit the local HTTP control plane to load a selected module
after panel confirmation of its resolved path, export and input/output side. Use
a prepare/confirm flow: short-lived single-use server token bound to that selection
and module digest; changes require reconfirmation. Retain loopback, Origin/Host
and write-request protections. A caller-supplied `confirmed: true` is not approval.
Never evaluate pasted code.

MCP may execute only module/export pairs explicitly allowlisted in user-edited
configuration. MCP cannot modify this allowlist or redeem panel approval tokens.
Without permission it returns an actionable error; document inputs still work.
Normal reads never execute project modules.

### Path bases and confinement

The writer has two separate concepts: Project.root resolves paths; bounds confines
writes to configured --dir/--file. They are not one directory. Use that same
explicit Project.root, never ambient process.cwd(), to resolve configuration.
Define `schemaSources.root` relative to Project.root, default `.`. Source request
paths and persisted source paths are relative to schemaSources.root; the source
picker displays that resolved base. An external project requires an explicit
schemaSources.root selection.

Reuse the writer's canonical realpath/symlink containment algorithm with the
schema source tree as its bounds. Do not reuse mocks-only bounds: legitimate
src/types files live outside laqi/. --dir/--file continue to control writes and
do not authorize executing code from arbitrary neighboring directories.
Test different launch/root directories, external --dir, file mode, traversal,
symlink escapes, and valid source files outside the mocks directory.
Entry-file confinement does not sandbox transitive imports or their side effects.
Bound depth, references, node count, input bytes and generated output; no automatic
remote `$ref` fetches.

Public mock serving must expose only response data. Schema metadata, source paths,
conversion APIs, and module loading remain on local control surfaces. Existing
explicit sharing behavior remains subject to its established access boundaries.

## Export architecture

Exporters consume JSON Schema directly where the underlying engine supports it.
Avoid JSON Schema → lossy Shape → JSON Schema on this path.

Wrap the existing quicktype integration behind `ExportAdapter`. Preserve its
working language targets and report actual per-target limitations, including the
tuple degradation already documented in `print-types.ts`.

Zod, Valibot, and ArkType code export are separate deliverables from importing
their runtime objects. Standard JSON Schema does not promise a reverse converter.
Before advertising a target, select or implement its printer and compile/execute
the emitted code against its supported dependency version. Capability lists must
show implemented targets, not the aspirational adapter list.

Exported source is generated assistance based on a snapshot. It is not guaranteed
to reproduce comments, helper declarations, refinements, or transformations from
the original source.

## Existing code and proposed ownership

| Area                                        | Change                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/generate/src/recipe.ts` and tests | Remove proprietary codec.                                                                                                          |
| `packages/generate/src/json-schema.ts`      | Keep useful outbound conversion; introduce supported inbound compilation and diagnostics.                                          |
| `packages/generate/src/parse-types.ts`      | Reuse TypeScript parsing behind input adapter; propagate existing loss warnings.                                                   |
| `packages/generate/src/generate.ts`         | Consume compiled generation rules; retain seed and budget behavior.                                                                |
| `packages/generate/src/print-types.ts`      | Wrap as exporter accepting JSON Schema; retain lazy dependencies.                                                                  |
| `packages/schema/src/response.ts`           | Define response schema association, durable diagnostics and optional generation evidence; remove generatedFrom and legacy formats. |
| `packages/core/src/project.ts`              | Continue metadata-aware response access and existing persistence.                                                                  |
| `packages/mcp/src/openapi.ts`               | Extract schemas through shared adapters; replace divergent placeholder generation where appropriate. Preserve explicit examples.   |
| CLI, server, MCP                            | Delegate generation/export decisions to shared use cases.                                                                          |
| Editor                                      | Consume returned metadata and diagnostics; show actual export origin and offer explicit refresh.                                   |
| Documentation                               | Align ADR-0013, adversarial analysis, panel docs, capabilities, and examples with final behavior.                                  |

Prefer modules inside existing packages initially. Follow
[ADR-0012](/decisions/0012-effect-first-in-generate/): internal Effect services/layers
remain in `@laqi/generate`, with ordinary asynchronous boundaries for consumers.
Adapters use those services/layers directly, with Promise facades only at the
package boundary. Heavy libraries remain lazily loaded.

## Delivery sequence

### 1. Characterization and contracts

Capture existing enum/optional/tuple/seed behavior and current export limitations.
Finalize input/output ports, diagnostics, metadata, and the supported keyword
matrix. Check selected library capabilities against installed versions. Audit
the prior experimental changes instead of assuming their checks prove correctness.

**Exit:** shared contract fixtures and explicit support policy are reviewable.

Close Effect ports, loss policy, authorization, path bases, origin semantics and
generation evidence here rather than leaving them to individual adapters.

### 2. JSON Schema generation path

Implement JsonSchemaAdapter, reference handling, validation, normalization, and
generation compilation. Use fixtures for bounds, tuples, enums, optional fields,
invalid/unsatisfiable schemas, and unsupported features.

**Exit:** schema → deterministic mock works without TypeScript or export libraries
loading; supported fixtures satisfy an independent JSON Schema validator.
The complete emitter invariant passes, including Date, unknown, tuples and records.
This validation is test-only and does not introduce runtime body validation.

### 3. Replace persistence and integrate transports

Remove packed/source metadata. Wire TypeScript input, regeneration, project writes,
HTTP, editor, and MCP to the same use cases. Expose JSON Schema input. Persist the
schema returned by generation rather than reconstructing it from the body.

This phase owns writer formatting: a JSON-aware serializer keeps scalar-only
arrays inline when the complete indented line fits 100 columns. Empty arrays stay
inline; nested/mixed and longer arrays expand. Preserve object order, escaping,
final newline and atomic writes. No regex rewriting of serialized strings.
Test parsed-value equality and actual enum/required layouts. Measure flat fixture
bytes/lines here; phase 6 verifies the change, not an unassigned future task.
Persist diagnostics and generation seed/options/bodyHash; implement acknowledgement,
refresh and revision conflict behavior. Do not rewrite unrelated working files.

**Exit:** create → save → restart → regenerate preserves rules; manual invalid
bodies remain servable; provenance/fallback labels are accurate on every surface.

### 4. Standard interface and project-library inputs

Implement StandardJsonSchemaAdapter as an Effect service with real library fixtures and shared
contract tests. Deliver the explicit local module/export selection workflow,
input/output semantics, and lifecycle/error handling. No runtime objects over JSON
transports; those transports carry document data or controlled source descriptors.

**Exit:** real Zod, Valibot, and ArkType fixtures supported by selected versions
produce usable JSON Schema or precise capability errors; no vendor parsing leaks
into generation. Load only the requested integration.

### 5. OpenAPI convergence and exports

Route supported OpenAPI schemas through common generation. Preserve explicit
examples and response metadata. Adapt existing exporters to JSON Schema; add
library-schema output targets individually after their emitted code is verified.

**Exit:** input and output capability matrices match working integrations; lossy
exports report limitations; export does not mutate mocks.

### 6. Measurement, documentation, and release preparation

Measure cold input conversion, warm regeneration, export, peak memory, and both
minified and actual pretty-printed mock-file size on all existing model fixtures.
Compare with the old experiment without treating earlier timings as guarantees.
Verify packaged CLI, plain Node execution, MCP, and browser flow. Update decisions
and user docs; remove obsolete tests/comments and describe the experimental format
replacement in release notes. Publishing is a separate release operation.

**Exit:** acceptance checks pass and the final diff is ready for review.

#### Measured results

Produced by `bun packages/generate/scripts/measure.ts` on an Apple Silicon
laptop, Bun 1.4.2 / Node v26.3.0, darwin/arm64. Absolute milliseconds are
about this machine; the comparison between columns is the finding.

| fixture | strict  | cold import | warm import (TS) | warm import (JSON Schema) | generate | export | document (min) | document (pretty) |   body |
| ------- | :-----: | ----------: | ---------------: | ------------------------: | -------: | -----: | -------------: | ----------------: | -----: |
| simple  |  clean  |      352 ms |           119 ms |                      0 ms |     0 ms |   2 ms |          340 B |             472 B |  113 B |
| medium  |  clean  |      357 ms |           116 ms |                      0 ms |     0 ms |   3 ms |         1565 B |            2740 B | 1294 B |
| complex | refused |      357 ms |           115 ms |                      0 ms |     1 ms |   6 ms |         4209 B |            8182 B | 2427 B |
| flat    |  clean  |      365 ms |           113 ms |                      0 ms |     0 ms |   3 ms |         2869 B |            5386 B | 1946 B |

Peak RSS 782 MB. 27 export targets. Cold is measured in a fresh child
process; measured as "the first call in this process" it came out equal to
warm, because the TypeScript compiler was already loaded and the number was
measuring nothing.

What the numbers say:

- **The whole import cost is `tsc`.** The same document re-imported as JSON
  Schema takes 0 ms against 115 ms from TypeScript source. laqi's own
  normalization, compilation and reference resolution do not register.
  Any future work on import latency belongs in how the compiler is invoked,
  not in the schema pipeline.
- **Generation is free at these sizes** — under a millisecond for every
  fixture. The `MAX_GENERATED_VALUES` budget exists for amplification
  (`string[][][]` at length 100), not for ordinary models.
- **Cold start is ~3× warm**, and it is paid once per process. This is the
  number a developer feels on their first paste.
- **Pretty-printing roughly doubles the document**, 340 B → 472 B at the
  small end and 4209 B → 8182 B at the large end, with `required` and `enum`
  on one line each. That is the writer's layout cost, and it buys a file a
  person can read and diff.
- **Peak RSS is dominated by what is loaded, not by what is generated.**
  quicktype's 27 target languages and the TypeScript compiler are the
  residents; the documents and bodies are kilobytes.
- **One of the four fixtures is refused by the strict default.** `complex`
  has a mixed union that narrows, so it needs an acknowledged approximation.
  A quarter of the hand-written fixtures tripping the policy is worth knowing
  before calling strict-by-default comfortable.

## Acceptance and testing

- The full shapeToJsonSchema output vocabulary compiles without rejection and
  preserves existing seeded generation, including Date, records and tuples.
- Strict/allowLoss behavior is identical across adapters. Loss diagnostics survive
  persistence and restart; intentional unconstrained schemas are distinguished.
- Explicit additionalProperties constraints survive import/export; absent false
  is not injected into imported documents.
- Refresh tests cover untouched, edited, example-sourced and concurrently changed
  bodies, plus changed schema/generator output despite the same seed.
- Module execution tests cover panel approval expiry/replay/module changes, MCP
  denial and allowlisted execution, and the separately defined path bases.
- Writer tests preserve JSON values and keep short scalar arrays inline.

- All input adapters satisfy the same success/failure and diagnostic contract.
- JSON Schema round trips retain supported generation semantics, including after
  disk reload. Tests assert behavior, not only serialized tag equality.
- HTTP and real MCP tests cover enums, optionals, tuples, and malformed metadata.
- Body-derived inference is labeled as inference; schema-derived export is labeled
  as generation metadata. Invalid snapshots never receive a success provenance label.
- Library conversion exceptions and unsupported dialects return actionable errors.
- Local and cyclic references obey deterministic budgets; no unintended network
  requests occur during schema resolution or export.
- Generated code is checked per advertised target; approximation is disclosed.
- Serving bodies remains independent of conversion dependencies and metadata.
- Existing responses without metadata continue to work; the experimental packed
  format and source compatibility branches are absent from the final code.
- Run repository formatting, lint, types, appropriate tests, and packaged runtime
  checks. Sandbox failures are recorded separately from product failures.

## Explicit limits and remaining implementation choices

The direction is settled. The following require evidence during implementation,
not renewed product approval: additive generation support beyond the fixed emitter minimum, exporter
engines for library-specific code, module-loader packaging, node/output budgets,
and whether the internal Shape still earns its place.

Do not promise constant-time generation, complete schema-language equivalence,
automatic source synchronization, or support for every target because it shares
the word schema. Deduplication and persistent caches wait for measurements.

## Review resolution ledger (2026-09-07)

| Finding                       | Binding resolution                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Emitter rejected by reader | Full existing emitter vocabulary is the phase-2 minimum; round-trip behavior tests gate phase 3.                                                                       |
| 2. Inconsistent/silent loss   | One strict default; explicit allowLoss for specified approximations; persisted schema.diagnostics replayed on reload.                                                  |
| 3. additionalProperties false | Reject stripping source intent. Preserve supplied false, never inject it into imports; generation projection is separate from persisted/exported document.             |
| 4. Undetectable edits         | Save seed/effective options plus canonical bodyHash; refresh schema separately, compare hashes and response revision before body replacement.                          |
| 5. Panel/MCP execution        | Explicit panel prepare/confirm over local HTTP; MCP execution only through user-edited module/export allowlist.                                                        |
| 6. Ambiguous root             | Share writer's explicit Project.root for configuration resolution and canonical containment algorithm; use explicit schemaSources.root bounds, not mocks write bounds. |
| 7. OpenAPI example provenance | Response schema association independent of body origin; generation evidence only for generated bodies.                                                                 |
| 8. Empty inheritance          | Interface ports and a generic StandardJsonSchemaAdapter; vendor services only for substantive behavior.                                                                |
| 9. Competing DI style         | Effect Context/Layer inside generate, Promise facade at its edge, no parallel constructor container.                                                                   |
| 10. Formatting ownership      | Phase 3 owns JSON-aware writer formatting and file-size/layout tests.                                                                                                  |
| 11. Validation non-goal       | No runtime response validation or Standard Schema validate calls; independent validation in tests only.                                                                |
| 12. Future outer schema       | No published outer schema assumed; any future one references the meta-schema at response schema.document.                                                              |

## Source references

- [JSON Schema use cases](https://json-schema.org/overview/use-cases)
- [JSON Schema draft 2020-12](https://json-schema.org/draft/2020-12)
- [Standard Schema validation interface](https://standardschema.dev/schema)
- [Standard JSON Schema conversion interface](https://standardschema.dev/json-schema)
- [ADR-0013: current experiment, to be revised during implementation](/decisions/0013-mocks-remember-their-model/)
- [Adversarial analysis of stored models](/adversarial/storing-models-in-mocks/)
- [ADR-0012: Effect boundary](/decisions/0012-effect-first-in-generate/)
