---
title: "laqi v2 — Plan 6: Data generators"
---

# laqi v2 — Plan 6: Data generators

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop around the data model both ways — paste a JSON and get the type in 27 languages, paste a TS interface and get seeded mock data written as ordinary laqi responses.

**Architecture:** A new private workspace `packages/generate` holds a minimal `Shape` IR with four pure arrows around it: `inferShape` (JSON → Shape, own code), `parseTypes` (pasted TS → Shape, via the real TypeScript checker on an in-memory CompilerHost), `generate` (Shape → data, seeded faker with field-name heuristics), and `printTypes` (Shape → JSON Schema → quicktype, 27 languages). The control plane gains three **pure** routes that compute and return; writing results goes through the existing `POST/PUT /api/endpoints` — the write surface gains nothing. `packages/server` keeps its zero-`node:*` rule: generation runs behind `ControlPlaneRuntime` callbacks implemented in `apps/cli`.

**Tech Stack:** Existing stack plus three zero-transitive-dep additions to the published package: `typescript@^5.9.3` (23.6 MB), `@faker-js/faker@^10.6.0` (2.9 MB), `quicktype-core@^26.0.0` (4.2 MB + 25 transitive). All three load via dynamic `import()` on first use — laqi startup is unchanged.

**Spec:** `apps/documentation/src/content/docs/diseno/data-generators.md` — the plan argues from it; read both.

## Global Constraints

- **TDD.** No production code without a failing test first.
- **English everywhere** — code comments, test names, commit messages (ADR-0009).
- **`packages/server` imports no `node:*` module**, directly or transitively at value level. Generation lives behind `ControlPlaneRuntime` callbacks implemented in `apps/cli`.
- **Zero new write routes.** The three new control-plane routes are pure (compute → return). Anything that lands on disk goes through the existing endpoint CRUD.
- **`typescript`, `@faker-js/faker` and `quicktype-core` are loaded only via dynamic `import()`** inside the functions that need them — never a static top-level import. Startup must not pay for them.
- **Seeded generation must be byte-reproducible.** faker's date methods use `Date.now()` as reference — verified by spike — so whenever a seed is set, `setDefaultRefDate('2026-01-01T00:00:00.000Z')` is set with it.
- `apps/cli/src/package.test.ts` pins the published dependency list; it MUST be updated in the same task that adds the dependencies, or the suite goes red.
- Every task ends with the full suite green: `bun run test`, `bunx turbo run check-types --force`, `bun run lint`.

## Verified by spike (do not re-litigate)

- The TS checker **flattens** `extends`, `Pick<...> & {...}` and intersections; an import from an absent module degrades the property type to `any` (→ our `unknown` + warning), it does not crash.
- An in-memory `CompilerHost` that serves the pasted source for one virtual filename and delegates everything else to `ts.sys` resolves `Date` and lib types correctly (the exact host code is in Task 3).
- `Shape → JSON Schema → quicktype` emits idiomatic TS / TS-Zod / Swift / Python with named nested types and enums from literal unions. `rendererOptions: { 'just-types': 'true' }`. Without `additionalProperties: false` the TS output grows a `[property: string]: unknown` index signature — always set it.
- faker: same seed + two instances ⇒ identical output **only when** `setDefaultRefDate` is fixed; `defaultTargetLanguages` exposes all 27 languages with `name`/`displayName`.

---

### Task 1: `packages/generate` scaffold, the Shape IR, and `inferShape`

**Files:**
- Create: `packages/generate/package.json`, `packages/generate/tsconfig.json`
- Create: `packages/generate/src/shape.ts`, `packages/generate/src/infer.ts`, `packages/generate/src/index.ts`
- Test: `packages/generate/src/infer.test.ts`

**Interfaces:**
- Produces: `Shape`, `ShapeField`, `primitive(type)` helper (shape.ts); `inferShape(value: unknown): Shape` (infer.ts). Every later task consumes `Shape` exactly as defined here.

- [ ] **Step 1: Scaffold the package**

`packages/generate/package.json`:

```json
{
  "name": "@laqi/generate",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./package.json": "./package.json" },
  "dependencies": {
    "@faker-js/faker": "^10.6.0",
    "quicktype-core": "^26.0.0",
    "typescript": "^5.9.3"
  },
  "devDependencies": { "@types/node": "^26.2.0" },
  "scripts": { "check-types": "tsc --noEmit -p ." }
}
```

`packages/generate/tsconfig.json`:

```json
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src/**/*"]
}
```

Run `bun install` at the repo root.

- [ ] **Step 2: Write the Shape IR** (`src/shape.ts`) — types only, no test needed on its own:

```ts
/**
 * The internal hub every generator arrow speaks. Deliberately minimal: it
 * only has to describe API response shapes, not all of TypeScript.
 */
export type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'date'

export type ShapeField = { name: string; shape: Shape; optional: boolean }

export type Shape =
  | { kind: 'object'; fields: ShapeField[] }
  | { kind: 'array'; items: Shape }
  | { kind: 'record'; values: Shape }
  | { kind: 'literals'; values: (string | number | boolean)[] }
  | { kind: 'primitive'; type: PrimitiveType }
  | { kind: 'unknown' }

export const primitive = (type: PrimitiveType): Shape => ({ kind: 'primitive', type })
```

- [ ] **Step 3: Write the failing tests** (`src/infer.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { inferShape } from './infer'
import { primitive } from './shape'

describe('inferShape', () => {
  it('infers primitives, telling integers from floats', () => {
    expect(inferShape('hi')).toEqual(primitive('string'))
    expect(inferShape(3)).toEqual(primitive('integer'))
    expect(inferShape(3.5)).toEqual(primitive('number'))
    expect(inferShape(true)).toEqual(primitive('boolean'))
    expect(inferShape(null)).toEqual(primitive('null'))
  })

  it('recognises ISO date strings as dates', () => {
    expect(inferShape('2026-08-27T10:00:00.000Z')).toEqual(primitive('date'))
    expect(inferShape('2026-08-27')).toEqual(primitive('date'))
    // Not a date: a plain string that merely contains digits.
    expect(inferShape('order-2026')).toEqual(primitive('string'))
  })

  it('infers objects with their fields in source order', () => {
    expect(inferShape({ id: 1, name: 'Ada' })).toEqual({
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'name', shape: primitive('string'), optional: false },
      ],
    })
  })

  it('merges array items: a field missing in some items becomes optional', () => {
    const shape = inferShape([{ id: 1, tag: 'a' }, { id: 2 }])
    expect(shape).toEqual({
      kind: 'array',
      items: {
        kind: 'object',
        fields: [
          { name: 'id', shape: primitive('integer'), optional: false },
          { name: 'tag', shape: primitive('string'), optional: true },
        ],
      },
    })
  })

  it('widens integer + float to number when merging', () => {
    const shape = inferShape([{ v: 1 }, { v: 2.5 }])
    expect(shape).toEqual({
      kind: 'array',
      items: { kind: 'object', fields: [{ name: 'v', shape: primitive('number'), optional: false }] },
    })
  })

  it('treats null-or-X as X when merging (null adds nothing to generate from)', () => {
    const shape = inferShape([{ v: null }, { v: 'x' }])
    expect(shape).toEqual({
      kind: 'array',
      items: { kind: 'object', fields: [{ name: 'v', shape: primitive('string'), optional: false }] },
    })
  })

  it('gives an empty array unknown items', () => {
    expect(inferShape([])).toEqual({ kind: 'array', items: { kind: 'unknown' } })
  })

  it('falls back to unknown when kinds genuinely conflict', () => {
    const shape = inferShape([{ v: 1 }, { v: { nested: true } }])
    expect(shape).toEqual({
      kind: 'array',
      items: { kind: 'object', fields: [{ name: 'v', shape: { kind: 'unknown' }, optional: false }] },
    })
  })
})
```

- [ ] **Step 4: Run to verify they fail** — `bunx vitest run packages/generate/src/infer.test.ts` → FAIL (`inferShape` not defined).

- [ ] **Step 5: Implement** (`src/infer.ts`):

```ts
import { primitive, type Shape, type ShapeField } from './shape'

/** Full-string ISO 8601: date, or date-time with optional ms and offset. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/

/**
 * JSON → Shape. Small on purpose: this powers "give me the type of this
 * response" and "regenerate from the shape the data already has".
 */
export function inferShape(value: unknown): Shape {
  if (value === null) return primitive('null')

  switch (typeof value) {
    case 'string':
      return ISO_DATE.test(value) ? primitive('date') : primitive('string')
    case 'number':
      return Number.isInteger(value) ? primitive('integer') : primitive('number')
    case 'boolean':
      return primitive('boolean')
    case 'object':
      break
    default:
      return { kind: 'unknown' }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', items: { kind: 'unknown' } }
    return { kind: 'array', items: value.map(inferShape).reduce(mergeShapes) }
  }

  const fields: ShapeField[] = Object.entries(value as Record<string, unknown>).map(
    ([name, field]) => ({ name, shape: inferShape(field), optional: false }),
  )
  return { kind: 'object', fields }
}

/**
 * The widening rules for array items. A field absent in some items becomes
 * optional; integer widens to number; null defers to the other side (there
 * is nothing to generate from a null); anything else that disagrees widens
 * to unknown rather than guessing.
 */
export function mergeShapes(a: Shape, b: Shape): Shape {
  if (a.kind === 'unknown') return b
  if (b.kind === 'unknown') return a
  if (a.kind === 'primitive' && a.type === 'null') return b
  if (b.kind === 'primitive' && b.type === 'null') return a

  if (a.kind === 'primitive' && b.kind === 'primitive') {
    if (a.type === b.type) return a
    const numeric = new Set(['integer', 'number'])
    if (numeric.has(a.type) && numeric.has(b.type)) return primitive('number')
    if ((a.type === 'date' && b.type === 'string') || (a.type === 'string' && b.type === 'date')) {
      return primitive('string')
    }
    return { kind: 'unknown' }
  }

  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', items: mergeShapes(a.items, b.items) }
  }

  if (a.kind === 'object' && b.kind === 'object') {
    const names = [...new Set([...a.fields.map((f) => f.name), ...b.fields.map((f) => f.name)])]
    const fields: ShapeField[] = names.map((name) => {
      const left = a.fields.find((f) => f.name === name)
      const right = b.fields.find((f) => f.name === name)
      if (left && right) {
        return { name, shape: mergeShapes(left.shape, right.shape), optional: left.optional || right.optional }
      }
      const only = (left ?? right)!
      return { name, shape: only.shape, optional: true }
    })
    return { kind: 'object', fields }
  }

  return { kind: 'unknown' }
}
```

`src/index.ts`:

```ts
export * from './shape'
export * from './infer'
```

- [ ] **Step 6: Run the tests** — all pass; `bunx turbo run check-types --force` green.
- [ ] **Step 7: Commit** — `feat(generate): package scaffold, the Shape IR, and inferShape`

---

### Task 2: `shapeToJsonSchema`

**Files:**
- Create: `packages/generate/src/json-schema.ts`
- Modify: `packages/generate/src/index.ts` (add `export * from './json-schema'`)
- Test: `packages/generate/src/json-schema.test.ts`

**Interfaces:**
- Consumes: `Shape` from Task 1.
- Produces: `shapeToJsonSchema(shape: Shape): Record<string, unknown>`.

- [ ] **Step 1: Failing tests** (`src/json-schema.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { shapeToJsonSchema } from './json-schema'
import { primitive, type Shape } from './shape'

describe('shapeToJsonSchema', () => {
  it('maps an object with optionals to properties + required + closed', () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'nick', shape: primitive('string'), optional: true },
      ],
    }
    expect(shapeToJsonSchema(shape)).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, nick: { type: 'string' } },
      required: ['id'],
      // Without this, quicktype's TS output grows an index signature.
      additionalProperties: false,
    })
  })

  it('maps arrays, records, literals, dates and unknown', () => {
    expect(shapeToJsonSchema({ kind: 'array', items: primitive('string') })).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
    expect(shapeToJsonSchema({ kind: 'record', values: primitive('number') })).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    })
    expect(shapeToJsonSchema({ kind: 'literals', values: ['a', 'b'] })).toEqual({ enum: ['a', 'b'] })
    expect(shapeToJsonSchema(primitive('date'))).toEqual({ type: 'string', format: 'date-time' })
    expect(shapeToJsonSchema(primitive('null'))).toEqual({ type: 'null' })
    expect(shapeToJsonSchema({ kind: 'unknown' })).toEqual({})
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, then implement (`src/json-schema.ts`):

```ts
import type { Shape } from './shape'

/**
 * Shape → JSON Schema. This is the whole bridge to quicktype: ~40 lines in
 * exchange for 27 output languages.
 */
export function shapeToJsonSchema(shape: Shape): Record<string, unknown> {
  switch (shape.kind) {
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(shape.fields.map((f) => [f.name, shapeToJsonSchema(f.shape)])),
        required: shape.fields.filter((f) => !f.optional).map((f) => f.name),
        additionalProperties: false,
      }
    case 'array':
      return { type: 'array', items: shapeToJsonSchema(shape.items) }
    case 'record':
      return { type: 'object', additionalProperties: shapeToJsonSchema(shape.values) }
    case 'literals':
      return { enum: shape.values }
    case 'primitive':
      return shape.type === 'date' ? { type: 'string', format: 'date-time' } : { type: shape.type }
    case 'unknown':
      return {}
  }
}
```

- [ ] **Step 3: Tests green, check-types green, commit** — `feat(generate): shapeToJsonSchema bridge`

---

### Task 3: `parseTypes` — pasted TS → Shape, via the real compiler

**Files:**
- Create: `packages/generate/src/parse-types.ts`
- Modify: `packages/generate/src/index.ts` (add export)
- Test: `packages/generate/src/parse-types.test.ts`

**Interfaces:**
- Consumes: `Shape`, `primitive` from Task 1.
- Produces: `parseTypes(source: string, typeName?: string): Promise<ParsedModel>` where `ParsedModel = { ok: true; shape: Shape; typeName: string; warnings: string[] } | { ok: false; error: string }`.

- [ ] **Step 1: Failing tests** (`src/parse-types.test.ts`) — including the dirty real-world fixture:

```ts
import { describe, expect, it } from 'vitest'
import { parseTypes } from './parse-types'
import { primitive, type Shape } from './shape'

/** The MGM-style fixture: extends, Pick & intersection, absent import. */
const DIRTY = `
import { Money } from '@mgm/currency'

interface Base { id: number; createdAt: Date }
type Tag = 'vip' | 'regular' | 'banned'

export interface User extends Base {
  name: string
  email?: string
  tags: Tag[]
  balance: Money
  metadata: Record<string, string>
  address: { street: string; zip?: string }
}

export type UserSummary = Pick<User, 'id' | 'name'> & { active: boolean }
`

function field(shape: Shape & { kind: 'object' }, name: string) {
  const found = shape.fields.find((f) => f.name === name)
  if (!found) throw new Error(`no field ${name} in ${shape.fields.map((f) => f.name).join(',')}`)
  return found
}

describe('parseTypes', () => {
  it('flattens extends into a plain object shape', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(result.shape.kind).toBe('object')
    const shape = result.shape as Shape & { kind: 'object' }
    expect(field(shape, 'id').shape).toEqual(primitive('number'))
    expect(field(shape, 'createdAt').shape).toEqual(primitive('date'))
  })

  it('keeps literal unions as literals, and arrays of them as arrays', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'tags').shape).toEqual({
      kind: 'array',
      items: { kind: 'literals', values: ['vip', 'regular', 'banned'] },
    })
  })

  it('marks optional properties and strips the undefined branch', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    const email = field(result.shape as never, 'email')
    expect(email.optional).toBe(true)
    expect(email.shape).toEqual(primitive('string'))
  })

  it('degrades an unresolvable import to unknown, with a warning naming the property', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'balance').shape).toEqual({ kind: 'unknown' })
    expect(result.warnings.some((w) => w.includes('balance'))).toBe(true)
  })

  it('maps Record<string, T> and nested object literals', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'metadata').shape).toEqual({
      kind: 'record',
      values: primitive('string'),
    })
    const address = field(result.shape as never, 'address').shape as Shape & { kind: 'object' }
    expect(field(address, 'zip').optional).toBe(true)
  })

  it('resolves Pick & intersection into a flat shape', async () => {
    const result = await parseTypes(DIRTY, 'UserSummary')
    if (!result.ok) throw new Error(result.error)
    const shape = result.shape as Shape & { kind: 'object' }
    expect(shape.fields.map((f) => f.name).sort()).toEqual(['active', 'id', 'name'])
  })

  it('defaults to the first exported type when no name is given', async () => {
    const result = await parseTypes(DIRTY)
    if (!result.ok) throw new Error(result.error)
    expect(result.typeName).toBe('User')
  })

  it('fails clearly on an unknown type name and on source with no types', async () => {
    const missing = await parseTypes(DIRTY, 'Nope')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('Nope')

    const empty = await parseTypes('const x = 1')
    expect(empty.ok).toBe(false)
  })

  it('survives a self-referencing type instead of recursing forever', async () => {
    const result = await parseTypes('export interface Node { id: number; next: Node }', 'Node')
    if (!result.ok) throw new Error(result.error)
    const next = (result.shape as Shape & { kind: 'object' }).fields.find((f) => f.name === 'next')!
    expect(next.shape).toEqual({ kind: 'unknown' })
    expect(result.warnings.some((w) => w.includes('circular'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, then implement (`src/parse-types.ts`) — the spike code, productionised:

```ts
import { primitive, type Shape, type ShapeField } from './shape'

export type ParsedModel =
  | { ok: true; shape: Shape; typeName: string; warnings: string[] }
  | { ok: false; error: string }

const VIRTUAL_FILE = '__laqi_pasted__.ts'
const MAX_DEPTH = 10

/**
 * Pasted TS source → Shape, using the real TypeScript checker.
 *
 * The real compiler and not a hand-rolled parser, on purpose: real-world
 * models arrive dirty — `extends`, `Pick<...> & {...}`, imports from
 * libraries that are not present here. The checker flattens all of that
 * (spike-verified), and an unresolvable import degrades the property to
 * `any`, which we surface as `unknown` plus a warning instead of failing.
 *
 * Dynamic import: the compiler is 23 MB and startup must not pay for it.
 */
export async function parseTypes(source: string, typeName?: string): Promise<ParsedModel> {
  const ts = (await import('typescript')).default

  const options: import('typescript').CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  }

  // An in-memory host: serves the pasted source for one virtual filename
  // and delegates lib resolution to the real filesystem, so `Date` and
  // friends resolve instead of collapsing to `any`.
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (name) => (name === VIRTUAL_FILE ? source : readFile(name))
  host.fileExists = (name) => name === VIRTUAL_FILE || fileExists(name)
  host.getSourceFile = (name, lang, onError, create) =>
    name === VIRTUAL_FILE
      ? ts.createSourceFile(VIRTUAL_FILE, source, lang, true)
      : getSourceFile(name, lang, onError, create)

  const program = ts.createProgram([VIRTUAL_FILE], options, host)
  const checker = program.getTypeChecker()
  const file = program.getSourceFile(VIRTUAL_FILE)
  if (!file) return { ok: false, error: 'could not parse the pasted source' }

  type Declaration = import('typescript').InterfaceDeclaration | import('typescript').TypeAliasDeclaration
  const declarations: Declaration[] = []
  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      declarations.push(statement)
    }
  }
  if (declarations.length === 0) {
    return { ok: false, error: 'no interface or type alias found in the pasted source' }
  }

  const isExported = (d: Declaration) =>
    d.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  const target = typeName
    ? declarations.find((d) => d.name.text === typeName)
    : (declarations.find(isExported) ?? declarations[0])
  if (!target) {
    const known = declarations.map((d) => d.name.text).join(', ')
    return { ok: false, error: `no type named ${JSON.stringify(typeName)} — found: ${known}` }
  }

  const warnings: string[] = []
  const seen = new Set<import('typescript').Type>()

  function toShape(type: import('typescript').Type, path: string, depth: number): Shape {
    if (depth > MAX_DEPTH) {
      warnings.push(`${path}: nesting deeper than ${MAX_DEPTH} levels — cut off as unknown`)
      return { kind: 'unknown' }
    }
    if (seen.has(type)) {
      warnings.push(`${path}: circular reference — generated as unknown`)
      return { kind: 'unknown' }
    }

    if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) {
      warnings.push(`${path}: unresolvable type (likely an import that is not present) — generated as unknown`)
      return { kind: 'unknown' }
    }
    if (type.flags & ts.TypeFlags.Null) return primitive('null')
    if (type.flags & ts.TypeFlags.BooleanLike) return primitive('boolean')

    // Literals and unions come BEFORE the broad string/number flags:
    // a string literal also carries StringLike.
    if (type.isStringLiteral()) return { kind: 'literals', values: [type.value] }
    if (type.isNumberLiteral()) return { kind: 'literals', values: [type.value] }
    if (type.isUnion()) {
      const members = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined))
      if (members.length === 1) return toShape(members[0]!, path, depth)
      const literals: (string | number)[] = []
      for (const member of members) {
        if (member.isStringLiteral() || member.isNumberLiteral()) literals.push(member.value)
      }
      if (literals.length === members.length) return { kind: 'literals', values: literals }
      warnings.push(`${path}: non-literal union — simplified to its first member`)
      return toShape(members[0]!, path, depth)
    }

    if (type.flags & ts.TypeFlags.StringLike) return primitive('string')
    if (type.flags & ts.TypeFlags.NumberLike) return primitive('number')
    if (type.symbol?.name === 'Date') return primitive('date')

    if (checker.isArrayType(type)) {
      const [items] = checker.getTypeArguments(type as import('typescript').TypeReference)
      return { kind: 'array', items: items ? toShape(items, `${path}[]`, depth + 1) : { kind: 'unknown' } }
    }

    if (type.getCallSignatures().length > 0) {
      warnings.push(`${path}: functions cannot be generated — unknown`)
      return { kind: 'unknown' }
    }

    const stringIndex = type.getStringIndexType()
    const properties = type.getProperties()
    if (stringIndex && properties.length === 0) {
      return { kind: 'record', values: toShape(stringIndex, `${path}{}`, depth + 1) }
    }

    if (properties.length > 0 || type.flags & ts.TypeFlags.Object) {
      seen.add(type)
      const fields: ShapeField[] = properties.map((prop) => {
        const propType = checker.getTypeOfSymbolAtLocation(prop, file!)
        const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0
        return { name: prop.name, shape: toShape(propType, `${path}.${prop.name}`, depth + 1), optional }
      })
      seen.delete(type)
      return { kind: 'object', fields }
    }

    warnings.push(`${path}: unsupported construct (${checker.typeToString(type)}) — unknown`)
    return { kind: 'unknown' }
  }

  const rootType = checker.getTypeAtLocation(target.name)
  const shape = toShape(rootType, target.name.text, 0)
  return { ok: true, shape, typeName: target.name.text, warnings }
}
```

- [ ] **Step 3: Tests green** (the checker order matters: literals before StringLike, union before both — the tests pin it). `check-types` green.
- [ ] **Step 4: Commit** — `feat(generate): parseTypes — pasted TS to Shape via the real compiler`

---

### Task 4: `generate` — Shape → data, seeded faker with field-name heuristics

**Files:**
- Create: `packages/generate/src/generate.ts`
- Modify: `packages/generate/src/index.ts` (add export)
- Test: `packages/generate/src/generate.test.ts`

**Interfaces:**
- Consumes: `Shape` from Task 1.
- Produces: `generate(shape: Shape, options?: { seed?: number; arrayLength?: number }): Promise<unknown>`.

- [ ] **Step 1: Failing tests**:

```ts
import { describe, expect, it } from 'vitest'
import { generate } from './generate'
import { primitive, type Shape } from './shape'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'name', shape: primitive('string'), optional: false },
    { name: 'email', shape: primitive('string'), optional: false },
    { name: 'createdAt', shape: primitive('date'), optional: false },
    { name: 'price', shape: primitive('number'), optional: false },
    { name: 'tag', shape: { kind: 'literals', values: ['vip', 'regular'] }, optional: false },
    { name: 'active', shape: primitive('boolean'), optional: false },
  ],
}

describe('generate', () => {
  it('is byte-reproducible under a seed — including dates', async () => {
    // faker's date methods reference Date.now(); without a fixed refDate the
    // same seed produced different output (spike-verified). The seed contract
    // is what makes this snapshot-testable at all.
    const a = await generate(user, { seed: 42 })
    const b = await generate(user, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('varies when the seed varies', async () => {
    expect(await generate(user, { seed: 1 })).not.toEqual(await generate(user, { seed: 2 }))
  })

  it('makes values that look like their field names', async () => {
    const value = (await generate(user, { seed: 42 })) as Record<string, unknown>
    expect(value.email).toMatch(/@/)
    expect(value.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof value.price).toBe('number')
    expect(['vip', 'regular']).toContain(value.tag)
    expect(typeof value.active).toBe('boolean')
  })

  it('gives arrays sequential ids and the requested length', async () => {
    const list = (await generate(
      { kind: 'array', items: user },
      { seed: 42, arrayLength: 4 },
    )) as Record<string, unknown>[]
    expect(list).toHaveLength(4)
    expect(list.map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it('defaults arrays to 3 items', async () => {
    expect((await generate({ kind: 'array', items: primitive('integer') }, { seed: 1 })) as unknown[]).toHaveLength(3)
  })

  it('always includes optional fields (generated data should show the full shape)', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [{ name: 'nick', shape: primitive('string'), optional: true }],
    }
    expect(Object.keys((await generate(shape, { seed: 1 })) as object)).toEqual(['nick'])
  })

  it('renders record, null and unknown sanely', async () => {
    const value = (await generate(
      {
        kind: 'object',
        fields: [
          { name: 'meta', shape: { kind: 'record', values: primitive('string') }, optional: false },
          { name: 'gone', shape: primitive('null'), optional: false },
          { name: 'mystery', shape: { kind: 'unknown' }, optional: false },
        ],
      },
      { seed: 1 },
    )) as Record<string, unknown>
    expect(Object.keys(value.meta as object).length).toBeGreaterThan(0)
    expect(value.gone).toBeNull()
    expect(value.mystery).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, then implement (`src/generate.ts`):

```ts
import type { Shape } from './shape'

/** Fixed reference date: with a seed, output must be byte-reproducible. */
const REF_DATE = '2026-01-01T00:00:00.000Z'
const DEFAULT_ARRAY_LENGTH = 3

type FakerInstance = import('@faker-js/faker').Faker

/**
 * Shape → data. faker (seeded) provides the values; a small field-name
 * dictionary makes them look real — `email` fields get emails, `createdAt`
 * gets an ISO date, `price` gets a decimal. `id` fields are sequential per
 * generate() call so lists look stable.
 */
export async function generate(
  shape: Shape,
  options: { seed?: number; arrayLength?: number } = {},
): Promise<unknown> {
  const { Faker, en } = await import('@faker-js/faker')
  const faker = new Faker({ locale: [en] })
  if (options.seed !== undefined) faker.seed(options.seed)
  faker.setDefaultRefDate(REF_DATE)

  const arrayLength = options.arrayLength ?? DEFAULT_ARRAY_LENGTH
  let nextId = 1

  function valueFor(shape: Shape, fieldName: string): unknown {
    switch (shape.kind) {
      case 'object':
        return Object.fromEntries(shape.fields.map((f) => [f.name, valueFor(f.shape, f.name)]))
      case 'array':
        return Array.from({ length: arrayLength }, () => valueFor(shape.items, fieldName))
      case 'record':
        return Object.fromEntries(
          Array.from({ length: 2 }, () => [faker.lorem.word(), valueFor(shape.values, '')]),
        )
      case 'literals':
        return faker.helpers.arrayElement(shape.values)
      case 'unknown':
        return null
      case 'primitive':
        return primitiveFor(shape.type, fieldName)
    }
  }

  function primitiveFor(type: string, fieldName: string): unknown {
    const name = fieldName.toLowerCase()

    if (type === 'null') return null
    if (type === 'boolean') return faker.datatype.boolean()
    if (type === 'date') return faker.date.recent({ days: 90 }).toISOString()

    if (type === 'integer' || type === 'number') {
      if (name === 'id' || name.endsWith('id')) return nextId++
      if (name.includes('price') || name.includes('total') || name.includes('amount') || name.includes('cost')) {
        return Number(faker.commerce.price())
      }
      if (name.includes('age')) return faker.number.int({ min: 18, max: 80 })
      if (name.includes('count') || name.includes('quantity') || name.includes('total')) {
        return faker.number.int({ min: 0, max: 100 })
      }
      return type === 'integer' ? faker.number.int({ min: 0, max: 1000 }) : faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })
    }

    // string
    if (name.includes('email')) return faker.internet.email()
    if (name === 'name' || name.endsWith('name')) return faker.person.fullName()
    if (name.includes('phone')) return faker.phone.number()
    if (name.includes('avatar') || name.includes('image') || name.includes('photo')) return faker.image.url()
    if (name.includes('url') || name.includes('link')) return faker.internet.url()
    if (name.includes('city')) return faker.location.city()
    if (name.includes('street') || name.includes('address')) return faker.location.streetAddress()
    if (name.includes('country')) return faker.location.country()
    if (name.includes('zip') || name.includes('postal')) return faker.location.zipCode()
    if (name.includes('uuid') || name.includes('guid')) return faker.string.uuid()
    if (name.includes('description') || name.includes('bio') || name.includes('summary')) return faker.lorem.sentence()
    if (name.includes('title')) return faker.lorem.words(3)
    if (name.includes('date') || name.endsWith('at')) return faker.date.recent({ days: 90 }).toISOString()
    return faker.lorem.words(2)
  }

  return valueFor(shape, '')
}
```

- [ ] **Step 3: Tests green, check-types green, commit** — `feat(generate): seeded data generation with field-name heuristics`

---

### Task 5: `printTypes` — quicktype behind the JSON Schema bridge

**Files:**
- Create: `packages/generate/src/print-types.ts`
- Modify: `packages/generate/src/index.ts` (add export)
- Test: `packages/generate/src/print-types.test.ts`

**Interfaces:**
- Consumes: `Shape`, `shapeToJsonSchema` from Tasks 1–2.
- Produces: `printTypes(shape: Shape, options: { typeName: string; lang?: string }): Promise<{ code: string; language: string }>` and `supportedLanguages(): Promise<{ name: string; displayName: string }[]>`.

- [ ] **Step 1: Failing tests**:

```ts
import { describe, expect, it } from 'vitest'
import { printTypes, supportedLanguages } from './print-types'
import { primitive, type Shape } from './shape'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'nick', shape: primitive('string'), optional: true },
    { name: 'tags', shape: { kind: 'array', items: { kind: 'literals', values: ['a', 'b'] } }, optional: false },
    {
      name: 'address',
      shape: { kind: 'object', fields: [{ name: 'street', shape: primitive('string'), optional: false }] },
      optional: false,
    },
  ],
}

describe('printTypes', () => {
  it('emits a TypeScript interface with named nested types, no index signature', async () => {
    const { code } = await printTypes(user, { typeName: 'User' })
    expect(code).toContain('export interface User')
    expect(code).toContain('nick?')
    expect(code).toContain('Address')
    expect(code).not.toContain('[property: string]')
  })

  it('emits Zod schemas when asked', async () => {
    const { code, language } = await printTypes(user, { typeName: 'User', lang: 'typescript-zod' })
    expect(language).toBe('typescript-zod')
    expect(code).toContain('z.object')
    expect(code).toContain('z.enum')
  })

  it('rejects an unknown language naming the real ones', async () => {
    await expect(printTypes(user, { typeName: 'User', lang: 'cobol' })).rejects.toThrow(/cobol/)
  })

  it('smoke-emits every advertised language', async () => {
    // Deep assertions only for TS and Zod; the rest must at least emit
    // non-empty code without throwing.
    for (const { name } of await supportedLanguages()) {
      const { code } = await printTypes(user, { typeName: 'User', lang: name })
      expect(code.length, name).toBeGreaterThan(20)
    }
  }, 120_000)
})

describe('supportedLanguages', () => {
  it('advertises the well-known ones', async () => {
    const names = (await supportedLanguages()).map((l) => l.name)
    for (const expected of ['typescript', 'typescript-zod', 'swift', 'kotlin', 'dart', 'python', 'go']) {
      expect(names).toContain(expected)
    }
  })
})
```

- [ ] **Step 2: Run to verify FAIL**, then implement (`src/print-types.ts`):

```ts
import { shapeToJsonSchema } from './json-schema'
import type { Shape } from './shape'

/**
 * Shape → source code in any of quicktype's target languages, through the
 * JSON Schema bridge. quicktype touches ONLY this printing arrow: parsing
 * and data generation never depend on it, so it stays swappable.
 */
export async function printTypes(
  shape: Shape,
  options: { typeName: string; lang?: string },
): Promise<{ code: string; language: string }> {
  const { quicktype, InputData, JSONSchemaInput, FetchingJSONSchemaStore, defaultTargetLanguages } =
    await import('quicktype-core')

  const lang = options.lang ?? 'typescript'
  const known = defaultTargetLanguages.some(
    (l) => l.name === lang || l.names.includes(lang),
  )
  if (!known) {
    const names = defaultTargetLanguages.map((l) => l.name).join(', ')
    throw new Error(`unknown language ${JSON.stringify(lang)} — supported: ${names}`)
  }

  const input = new JSONSchemaInput(new FetchingJSONSchemaStore())
  await input.addSource({ name: options.typeName, schema: JSON.stringify(shapeToJsonSchema(shape)) })
  const inputData = new InputData()
  inputData.addInput(input)

  const result = await quicktype({
    inputData,
    lang,
    rendererOptions: { 'just-types': 'true' },
  })
  return { code: result.lines.join('\n'), language: lang }
}

export async function supportedLanguages(): Promise<{ name: string; displayName: string }[]> {
  const { defaultTargetLanguages } = await import('quicktype-core')
  return defaultTargetLanguages.map((l) => ({ name: l.name, displayName: l.displayName }))
}
```

Note for the implementer: if `l.names` does not exist on the installed version's language objects, match on `l.name` and `l.displayName` instead — assert against the real package, and keep the unknown-language error listing `name`s.

- [ ] **Step 3: Tests green (the smoke loop is slow — that is what the 120s timeout is for), check-types green, commit** — `feat(generate): printTypes via quicktype, 27 languages`

---

### Task 6: control-plane routes — types, languages, generate/data

**Files:**
- Modify: `packages/server/src/control-plane-app.ts` (extend `ControlPlaneRuntime`; add three GET/POST routes **before the catch-all**, at the marked insertion point)
- Test: `packages/server/src/control-plane-app.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from `@laqi/generate` — `packages/server` stays free of `node:*`; it only *types* the callbacks.
- Produces: three additions to `ControlPlaneRuntime` that Task 7 implements in `apps/cli`:

```ts
export type GenerateRequest =
  | { model: string; typeName?: string; arrayLength?: number; seed?: number }
  | { from: { endpointId: string; response: string }; arrayLength?: number; seed?: number }

// added to ControlPlaneRuntime:
getLanguages: () => Promise<{ name: string; displayName: string }[]>
getTypes: (
  id: string,
  options: { response?: string; lang?: string },
) => Promise<{ ok: true; code: string; language: string } | { ok: false; error: string; code: WriteFailure }>
generateData: (
  input: GenerateRequest,
) => Promise<{ ok: true; preview: unknown; warnings: string[] } | { ok: false; error: string; code: WriteFailure }>
```

(`WriteFailure` and the `STATUS` map from `invalid`/`conflict`/`not-found` to 400/409/404 already exist in this file — reuse them.)

- [ ] **Step 1: Failing tests** — extend the existing `makeRuntime` helper with stub implementations, then:

```ts
describe('generation routes', () => {
  it('GET /api/generate/languages returns the list', async () => {
    const app = createControlPlaneApp(
      makeRuntime({ getLanguages: async () => [{ name: 'typescript', displayName: 'TypeScript' }] }),
    )
    const res = await app.request('/api/generate/languages')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ name: 'typescript', displayName: 'TypeScript' }])
  })

  it('GET /api/endpoints/:id/types passes response and lang through, URL-decoded', async () => {
    const getTypes = vi.fn(async () => ({ ok: true as const, code: 'export interface X {}', language: 'typescript' }))
    const app = createControlPlaneApp(makeRuntime({ getTypes }))
    const res = await app.request(`/api/endpoints/${encodeURIComponent('GET /users')}/types?response=ok&lang=typescript-zod`)
    expect(res.status).toBe(200)
    expect(getTypes).toHaveBeenCalledWith('GET /users', { response: 'ok', lang: 'typescript-zod' })
  })

  it('maps a not-found types failure to 404', async () => {
    const app = createControlPlaneApp(
      makeRuntime({ getTypes: async () => ({ ok: false as const, error: 'no endpoint', code: 'not-found' as const }) }),
    )
    expect((await app.request('/api/endpoints/GET%20%2Fnope/types')).status).toBe(404)
  })

  it('POST /api/generate/data forwards the body and returns the preview', async () => {
    const generateData = vi.fn(async () => ({ ok: true as const, preview: [{ id: 1 }], warnings: ['w'] }))
    const app = createControlPlaneApp(makeRuntime({ generateData }))
    const res = await app.request('/api/generate/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'export interface X { id: number }', seed: 7 }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ preview: [{ id: 1 }], warnings: ['w'] })
    expect(generateData).toHaveBeenCalledWith({ model: 'export interface X { id: number }', seed: 7 })
  })

  it('rejects a body that is neither model nor from as 400, without calling the runtime', async () => {
    const generateData = vi.fn()
    const app = createControlPlaneApp(makeRuntime({ generateData }))
    const res = await app.request('/api/generate/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nothing: true }),
    })
    expect(res.status).toBe(400)
    expect(generateData).not.toHaveBeenCalled()
  })

  it('maps an invalid model failure to 400', async () => {
    const app = createControlPlaneApp(
      makeRuntime({ generateData: async () => ({ ok: false as const, error: 'no type found', code: 'invalid' as const }) }),
    )
    const res = await app.request('/api/generate/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'const x = 1' }),
    })
    expect(res.status).toBe(400)
  })
})
```

The stub defaults added to `makeRuntime`: `getLanguages: async () => []`, `getTypes: async () => ({ ok: false, error: 'stub', code: 'not-found' })`, `generateData: async () => ({ ok: false, error: 'stub', code: 'invalid' })`.

- [ ] **Step 2: Run to verify FAIL**, then implement. Route handlers, inserted **before the catch-all** at the marked insertion point:

```ts
app.get('/api/generate/languages', async (c) => c.json(await runtime.getLanguages()))

app.get('/api/endpoints/:id/types', async (c) => {
  const id = c.req.param('id') // Hono already decoded it — no extra decode.
  const result = await runtime.getTypes(id, {
    response: c.req.query('response'),
    lang: c.req.query('lang'),
  })
  if (!result.ok) {
    return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code])
  }
  return c.json({ code: result.code, language: result.language })
})

app.post('/api/generate/data', async (c) => {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return c.json({ error: 'laqi-control-plane', message: 'body is not valid JSON' }, 400)
  }
  const body = raw as Record<string, unknown>
  const hasModel = typeof body.model === 'string'
  const hasFrom =
    typeof body.from === 'object' &&
    body.from !== null &&
    typeof (body.from as Record<string, unknown>).endpointId === 'string' &&
    typeof (body.from as Record<string, unknown>).response === 'string'
  if (!hasModel && !hasFrom) {
    return c.json(
      { error: 'laqi-control-plane', message: 'body needs either "model" (TS source) or "from" ({endpointId, response})' },
      400,
    )
  }
  const result = await runtime.generateData(raw as GenerateRequest)
  if (!result.ok) {
    return c.json({ error: 'laqi-control-plane', message: result.error }, STATUS[result.code])
  }
  return c.json({ preview: result.preview, warnings: result.warnings })
})
```

Naming collision note: `getTypes` returns `{ code: string }` where `code` is *source code*; its failure variant uses `code: WriteFailure` for the *reason*. Keep the success payload key `code` (it is what the panel copies) — the two never coexist in one object.

- [ ] **Step 3: Tests green. Verify `packages/server` still has no `node:*`: `grep -rn "node:" packages/server/src --include="*.ts" | grep -v test` → empty. Commit** — `feat(server): pure generation routes on the control plane`

---

### Task 7: wire the runtime callbacks in `apps/cli`

**Files:**
- Modify: `apps/cli/src/serve.ts` (implement the three callbacks in `controlPlaneRuntime`)
- Modify: `apps/cli/package.json` (dependencies — see step 1)
- Modify: `apps/cli/src/package.test.ts` (the pinned dependency list)
- Test: `apps/cli/src/serve.test.ts` (extend)

**Interfaces:**
- Consumes: `inferShape`, `parseTypes`, `generate`, `printTypes`, `supportedLanguages` from `@laqi/generate`; `GenerateRequest` from `@laqi/server`.

- [ ] **Step 1: Dependencies.** Add to `apps/cli/package.json` `dependencies`: `"@laqi/generate": "workspace:*"` under devDependencies (bundled workspace, same as the other `@laqi/*`), and `"typescript": "^5.9.3"`, `"@faker-js/faker": "^10.6.0"`, `"quicktype-core": "^26.0.0"` under `dependencies` (external, lazy-loaded). Update `package.test.ts`: the pinned runtime list becomes `['@faker-js/faker', '@hono/node-server', 'chokidar', 'hono', 'quicktype-core', 'typescript', 'zod']`, and add `@laqi/generate` to the workspace-dev expectation. Run the test file — it goes green again.

- [ ] **Step 2: Failing integration tests** (extend `serve.test.ts`):

```ts
describe('generation through a live server', () => {
  it('derives types from the live response body', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [{ id: 1, name: 'Ada' }] } } },
    })
    handle = await startServer({ root, config })

    const res = await get(`/__laqi/api/endpoints/${encodeURIComponent('GET /users')}/types?response=ok`)
    expect(res.status).toBe(200)
    const { code, language } = (await res.json()) as { code: string; language: string }
    expect(language).toBe('typescript')
    expect(code).toContain('id')
    expect(code).toContain('name')
  }, 30_000)

  it('404s types for an endpoint or response that does not exist', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })
    expect((await get('/__laqi/api/endpoints/GET%20%2Fnope/types')).status).toBe(404)
    expect((await get('/__laqi/api/endpoints/GET%20%2Fx/types?response=ghost')).status).toBe(404)
  })

  it('generates a preview from a pasted model, and the same seed repeats it', async () => {
    writeMocks({ 'GET /x': { default: 'ok', responses: { ok: { status: 200 } } } })
    handle = await startServer({ root, config })

    const body = JSON.stringify({
      model: 'export interface Todo { id: number; title: string; done: boolean }',
      seed: 42,
    })
    const once = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    expect(once.status).toBe(200)
    const first = (await once.json()) as { preview: Record<string, unknown>; warnings: string[] }
    expect(typeof first.preview.id).toBe('number')
    expect(typeof first.preview.title).toBe('string')

    const twice = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    expect(((await twice.json()) as { preview: unknown }).preview).toEqual(first.preview)
  }, 30_000)

  it('regenerates from live data via from:, without any model', async () => {
    writeMocks({
      'GET /users': { default: 'ok', responses: { ok: { status: 200, body: [{ id: 1, name: 'Ada' }] } } },
    })
    handle = await startServer({ root, config })

    const res = await fetch(`http://127.0.0.1:${handle.port}/__laqi/api/generate/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: { endpointId: 'GET /users', response: 'ok' }, seed: 7, arrayLength: 2 }),
    })
    expect(res.status).toBe(200)
    const { preview } = (await res.json()) as { preview: Record<string, unknown>[] }
    expect(preview).toHaveLength(2)
    expect(typeof preview[0]!.id).toBe('number')
    expect(typeof preview[0]!.name).toBe('string')
  }, 30_000)
})
```

- [ ] **Step 3: Run to verify FAIL**, then implement in `serve.ts`'s `controlPlaneRuntime`:

```ts
      getLanguages: async () => {
        const { supportedLanguages } = await import('@laqi/generate')
        return supportedLanguages()
      },
      getTypes: async (id, options) => {
        const endpoint = runtime.table.byId.get(id)
        if (!endpoint) return { ok: false, error: `no endpoint with id ${JSON.stringify(id)}`, code: 'not-found' }

        const responseName = options.response ?? endpoint.default
        const response = endpoint.responses[responseName]
        if (!response) {
          return {
            ok: false,
            error: `${JSON.stringify(responseName)} is not declared on ${id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
            code: 'not-found',
          }
        }

        const { inferShape, printTypes } = await import('@laqi/generate')
        try {
          // Types are a VIEW of the live data — never persisted, never stale.
          const shape = inferShape(response.body ?? null)
          const printed = await printTypes(shape, { typeName: typeNameFor(id), lang: options.lang })
          return { ok: true, ...printed }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error), code: 'invalid' }
        }
      },
      generateData: async (input) => {
        const { generate, inferShape, parseTypes } = await import('@laqi/generate')
        const generateOptions = { seed: input.seed, arrayLength: input.arrayLength }

        if ('model' in input) {
          const parsed = await parseTypes(input.model, input.typeName)
          if (!parsed.ok) return { ok: false, error: parsed.error, code: 'invalid' }
          const preview = await generate(parsed.shape, generateOptions)
          return { ok: true, preview, warnings: parsed.warnings }
        }

        const endpoint = runtime.table.byId.get(input.from.endpointId)
        if (!endpoint) {
          return { ok: false, error: `no endpoint with id ${JSON.stringify(input.from.endpointId)}`, code: 'not-found' }
        }
        const response = endpoint.responses[input.from.response]
        if (!response) {
          return {
            ok: false,
            error: `${JSON.stringify(input.from.response)} is not declared on ${input.from.endpointId}`,
            code: 'not-found',
          }
        }
        // Regenerate re-infers from the data the response already has: the
        // original pasted model is never needed again, so it is never stored.
        const preview = await generate(inferShape(response.body ?? null), generateOptions)
        return { ok: true, preview, warnings: [] }
      },
```

Plus one module-level helper in `serve.ts`:

```ts
/** "GET /users/:id" → "Users" — a PascalCase type name from the path. */
export function typeNameFor(id: string): string {
  const path = id.split(' ')[1] ?? ''
  const words = path.split('/').filter((part) => part && !part.startsWith(':'))
  const name = words
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ' '))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('')
  return name || 'Response'
}
```

with two unit tests in `serve.test.ts`: `typeNameFor('GET /users/:id')` → `'Users'`, `typeNameFor('GET /api/order-items')` → `'ApiOrderItems'`, `typeNameFor('GET /')` → `'Response'`.

- [ ] **Step 4: Full suite green (`bun run test`, check-types, lint). Commit** — `feat(cli): wire generation into the control plane runtime`

---

### Task 8: MCP tools — `get_types` and `generate_data`

**Files:**
- Modify: `packages/mcp/src/server.ts` (two `registerTool` calls; add `@laqi/generate` to `packages/mcp/package.json` dependencies as `workspace:*`)
- Test: `packages/mcp/src/stdio.test.ts` (extend)

**Interfaces:**
- Consumes: `Project` (already there), `inferShape`, `parseTypes`, `generate`, `printTypes` from `@laqi/generate`.
- Produces: MCP tools `get_types({ endpointId, response?, lang? })`, `generate_data({ model?, typeName?, from?, arrayLength?, seed? })`. Both **pure** — the agent writes with the tools it already has.

- [ ] **Step 1: Failing stdio tests** (extend the existing harness — it spawns the real CLI):

```ts
  it('get_types derives a TypeScript interface from the live data', async () => {
    const result = await call('get_types', { endpointId: 'GET /users' })
    expect(result.isError).toBe(false)
    expect(result.text).toContain('interface')
  }, 30_000)

  it('generate_data returns a preview and never writes anything', async () => {
    const before = readFileSync(join(root, 'laqi', 'api.json'), 'utf8')
    const result = await call('generate_data', {
      model: 'export interface Todo { id: number; title: string }',
      seed: 42,
    })
    expect(result.isError).toBe(false)
    const { preview } = result.json() as { preview: Record<string, unknown> }
    expect(typeof preview.id).toBe('number')
    // Pure tool: the mock file is byte-identical afterwards.
    expect(readFileSync(join(root, 'laqi', 'api.json'), 'utf8')).toBe(before)
  }, 30_000)

  it('generate_data with from: regenerates from an existing response', async () => {
    const result = await call('generate_data', {
      from: { endpointId: 'GET /users', response: 'ok' }, seed: 7,
    })
    expect(result.isError).toBe(false)
  }, 30_000)
```

- [ ] **Step 2: Run to verify FAIL**, then implement in `server.ts` (following the existing `registerTool` pattern — errors as `isError` text, JSON results via the `text` helper):

```ts
  server.registerTool(
    'get_types',
    {
      title: 'Get the types of an endpoint',
      description:
        'Derive a data model from the live response body of an endpoint, in any supported language (default "typescript"; try "typescript-zod", "swift", "kotlin", "python", …). Types are derived from the data on demand, so they are never stale.',
      inputSchema: {
        endpointId: z.string().describe('Endpoint id, e.g. "GET /users/:id"'),
        response: z.string().optional().describe('Response name; defaults to the endpoint default'),
        lang: z.string().optional().describe('Target language name'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ endpointId, response, lang }) => {
      const listed = project.listEndpoints()
      if (!listed.ok) return { isError: true, content: [{ type: 'text' as const, text: listed.error }] }
      const endpoint = listed.value.endpoints.find((e) => e.id === endpointId)
      if (!endpoint) {
        return { isError: true, content: [{ type: 'text' as const, text: `no endpoint with id ${JSON.stringify(endpointId)}` }] }
      }
      // EndpointView carries names+statuses only; read the body via the raw
      // loaded endpoint. Add a Project.getResponseBody(id, name) accessor:
      const body = project.getResponseBody(endpointId, response)
      if (!body.ok) return { isError: true, content: [{ type: 'text' as const, text: body.error }] }

      const { inferShape, printTypes } = await import('@laqi/generate')
      const printed = await printTypes(inferShape(body.value ?? null), {
        typeName: endpointId.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).slice(1).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('') || 'Response',
        lang,
      })
      return { content: [{ type: 'text' as const, text: printed.code }] }
    },
  )

  server.registerTool(
    'generate_data',
    {
      title: 'Generate mock data',
      description:
        'Generate realistic mock data from a pasted TypeScript model, or regenerate from the shape of an existing response (from). Returns a preview; write it with create_endpoint or update_endpoint. Same seed, same output.',
      inputSchema: {
        model: z.string().optional().describe('TypeScript source containing the interface/type'),
        typeName: z.string().optional(),
        from: z.object({ endpointId: z.string(), response: z.string() }).optional(),
        arrayLength: z.number().int().min(1).max(50).optional(),
        seed: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ model, typeName, from, arrayLength, seed }) => {
      const { generate, inferShape, parseTypes } = await import('@laqi/generate')
      const options = { arrayLength, seed }

      if (model !== undefined) {
        const parsed = await parseTypes(model, typeName)
        if (!parsed.ok) return { isError: true, content: [{ type: 'text' as const, text: parsed.error }] }
        const preview = await generate(parsed.shape, options)
        return text({ preview, warnings: parsed.warnings })
      }
      if (from !== undefined) {
        const body = project.getResponseBody(from.endpointId, from.response)
        if (!body.ok) return { isError: true, content: [{ type: 'text' as const, text: body.error }] }
        const preview = await generate(inferShape(body.value ?? null), options)
        return text({ preview, warnings: [] })
      }
      return { isError: true, content: [{ type: 'text' as const, text: 'pass either "model" or "from"' }] }
    },
  )
```

And the accessor in `packages/core/src/project.ts` (with two unit tests in `project.test.ts` — found body returned, unknown id/response refused with the known-ids hint):

```ts
  /** The raw body of one response — what the generators derive shapes from. */
  getResponseBody(id: string, responseName?: string): ProjectResult<unknown> {
    const endpoint = this.load().byId.get(id)
    if (endpoint === undefined) return fail(this.unknownEndpoint(id), 'not-found')

    const name = responseName ?? endpoint.default
    const response = endpoint.responses[name]
    if (response === undefined) {
      return fail(
        `${JSON.stringify(name)} is not declared on ${id}. Available: ${Object.keys(endpoint.responses).join(', ')}`,
        'not-found',
      )
    }
    return ok(response.body)
  }
```

- [ ] **Step 3: Update the stdio tool-list test** (it asserts the exact sorted tool names — add `generate_data` and `get_types`). Full suite green. Commit — `feat(mcp): get_types and generate_data, both pure`

---

### Task 9: panel — Copy types with a language dropdown, and Regenerate

**Files:**
- Modify: `packages/editor/src/api.ts` (three client methods)
- Modify: `packages/editor/src/components/EndpointDetail.tsx` (a Types block in the meta column; a Regenerate button in the editor toolbar)
- Test: `packages/editor/src/components/EndpointDetail.test.tsx` (extend), `packages/editor/src/api.test.ts` (extend)

**Interfaces:**
- Consumes: the routes from Task 6.
- Produces: `api.getLanguages()`, `api.getTypes(id, {response?, lang?})`, `api.generateData(input)`.

- [ ] **Step 1: Failing api-client tests** (same mock-fetch harness the file already uses):

```ts
  it('fetches types with response and lang in the query', async () => {
    const calls = mockFetch(() => json({ code: 'interface X {}', language: 'typescript-zod' }))
    await api.getTypes('GET /users', { response: 'ok', lang: 'typescript-zod' })
    expect(calls[0]?.url).toBe('/__laqi/api/endpoints/GET%20%2Fusers/types?response=ok&lang=typescript-zod')
  })

  it('omits absent query params from the types URL', async () => {
    const calls = mockFetch(() => json({ code: '', language: 'typescript' }))
    await api.getTypes('GET /users', {})
    expect(calls[0]?.url).toBe('/__laqi/api/endpoints/GET%20%2Fusers/types')
  })

  it('POSTs generate/data with the body verbatim', async () => {
    const calls = mockFetch(() => json({ preview: [], warnings: [] }))
    await api.generateData({ from: { endpointId: 'GET /users', response: 'ok' }, seed: 7 })
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      from: { endpointId: 'GET /users', response: 'ok' }, seed: 7,
    })
  })
```

Client implementation in `api.ts`:

```ts
  getLanguages: () => request<{ name: string; displayName: string }[]>('/api/generate/languages'),

  getTypes: (id: string, options: { response?: string; lang?: string }) => {
    const query = new URLSearchParams()
    if (options.response) query.set('response', options.response)
    if (options.lang) query.set('lang', options.lang)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return request<{ code: string; language: string }>(
      `/api/endpoints/${encodeURIComponent(id)}/types${suffix}`,
    )
  },

  generateData: (input: GenerateDataInput) =>
    request<{ preview: unknown; warnings: string[] }>('/api/generate/data', {
      method: 'POST',
      body: input,
    }),
```

with `export type GenerateDataInput = { model: string; typeName?: string; arrayLength?: number; seed?: number } | { from: { endpointId: string; response: string }; arrayLength?: number; seed?: number }`.

- [ ] **Step 2: Failing component tests** (jsdom, mocking `../lib`-style `./api` as `App.test.tsx` already does — here mock `../api` inside `EndpointDetail.test.tsx` with `vi.mock`):

```ts
  it('copies the types for the selected language', async () => {
    // api.getLanguages mocked → [{name:'typescript',…},{name:'typescript-zod',…}]
    // api.getTypes mocked → { code: 'export interface Users { id: number }', language: 'typescript' }
    renderDetail(endpoint())
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    fireEvent.click(await screen.findByRole('button', { name: /copy types/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('interface')))
  })

  it('regenerate fills the body draft with the preview and lets Save do the writing', async () => {
    // api.generateData mocked → { preview: { id: 99, name: 'Fresh' }, warnings: [] }
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await waitFor(() => expect(body().value).toContain('"Fresh"'))
    // No write happened: regenerate only edits the draft. Saving is the
    // existing Save button — zero new write paths, verbatim from the spec.
    expect(screen.getByRole('button', { name: 'Save to file' }).hasAttribute('disabled')).toBe(false)
  })
```

- [ ] **Step 3: Implement.** In the meta column of `EndpointDetail`, after the curl block:

```tsx
              <div className="meta-field">
                <span className="micro">types</span>
                <div className="detail-actions">
                  <select
                    className="meta-input"
                    aria-label="types language"
                    value={typesLang}
                    onChange={(event) => setTypesLang(event.target.value)}
                  >
                    {languages.map((language) => (
                      <option key={language.name} value={language.name}>
                        {language.displayName}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void api
                        .getTypes(endpoint.id, { response: selected, lang: typesLang })
                        .then(({ code }) => navigator.clipboard?.writeText(code))
                    }}
                  >
                    Copy types
                  </button>
                </div>
              </div>
```

State: `const [typesLang, setTypesLang] = useState('typescript')`, `const [languages, setLanguages] = useState<{ name: string; displayName: string }[]>([{ name: 'typescript', displayName: 'TypeScript' }])`, loaded once in an effect (`api.getLanguages().then(setLanguages).catch(() => {})` — a panel without the languages list still works with the TS default). Regenerate button in the editor toolbar, next to Set live:

```tsx
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void api
                    .generateData({ from: { endpointId: endpoint.id, response: selected } })
                    .then(({ preview }) =>
                      setDraft((previous) => ({
                        ...previous,
                        bodies: { ...previous.bodies, [selected]: JSON.stringify(preview, null, 2) },
                      })),
                    )
                    .catch(() => {})
                }}
              >
                Regenerate
              </button>
```

- [ ] **Step 4: Full suite green, lint green. Commit** — `feat(editor): copy types in 27 languages, regenerate into the draft`

---

### Task 10: panel — create an endpoint from a pasted model

**Files:**
- Modify: `packages/editor/src/components/CreateEndpointRow.tsx` (a "from a model" mode with a paste area)
- Modify: `packages/editor/src/App.tsx` (`create` accepts an optional generated body)
- Test: `packages/editor/src/App.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.generateData` from Task 9.
- Produces: `CreateInput` gains `body?: unknown` — when present, `App.create` uses it as the first response body instead of `{}`.

- [ ] **Step 1: Failing tests** (in `App.test.tsx`, where the create flow tests already live — the api mock gains `generateData`):

```ts
  it('creates an endpoint from a pasted model, with the generated preview as the body', async () => {
    generateData.mockResolvedValue({ preview: [{ id: 1, title: 'Generated' }], warnings: [] })
    createEndpoint.mockResolvedValue({ id: 'GET /todos' })
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: '+ New endpoint' }))
    fireEvent.click(screen.getByRole('button', { name: /from a model/i }))
    fireEvent.change(screen.getByLabelText('model'), {
      target: { value: 'export interface Todo { id: number; title: string }' },
    })
    fireEvent.change(screen.getByLabelText('path'), { target: { value: '/todos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(createEndpoint).toHaveBeenCalledWith({
        method: 'GET',
        path: '/todos',
        default: 'ok',
        responses: { ok: { status: 200, body: [{ id: 1, title: 'Generated' }] } },
      }),
    )
  })

  it('shows the generation error inline and does not create', async () => {
    generateData.mockRejectedValue(new Error('no interface or type alias found'))
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: '+ New endpoint' }))
    fireEvent.click(screen.getByRole('button', { name: /from a model/i }))
    fireEvent.change(screen.getByLabelText('model'), { target: { value: 'const x = 1' } })
    fireEvent.change(screen.getByLabelText('path'), { target: { value: '/todos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/no interface or type alias/)).toBeTruthy()
    expect(createEndpoint).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Implement.** `CreateEndpointRow` gains `mode: 'blank' | 'model'` state, a toggle button (`from a model` / `blank`), and when in model mode a `<textarea aria-label="model" className="create-input" rows={6}>` spanning the row (`flex-basis: 100%`). Its submit handler in model mode calls a new prop `onCreateFromModel({ method, path, model })`; `App` implements it:

```ts
  const createFromModel = useCallback(
    async (input: { method: string; path: string; model: string }) => {
      setCreateError(null)
      try {
        const { preview } = await api.generateData({ model: input.model })
        await create({ method: input.method, path: input.path, responseName: 'ok', status: 200, body: preview })
      } catch (error) {
        setCreateError(error instanceof ApiError ? error.message : String(error))
      }
    },
    [create],
  )
```

and `create` passes `body: input.body ?? {}` into the existing `api.createEndpoint` call. (Refactor `create` to accept the extended `CreateInput` — the existing blank-mode tests must keep passing unchanged.)

- [ ] **Step 3: Full suite green, lint green. Commit** — `feat(editor): create an endpoint from a pasted model`

---

### Task 11: packaging, lazy-load guarantee, and docs

**Files:**
- Modify: `apps/cli/src/package.test.ts` (lazy-load guard test)
- Modify: `README.md` (a "Generate types and data" section)
- Modify: `apps/documentation/src/content/docs/probar-v2.md` (a walkthrough step between MCP and public URL)
- Modify: `apps/documentation/src/content/docs/planes/index.md` (Plan 6 row)
- Test: `apps/cli/src/package.test.ts`

- [ ] **Step 1: The lazy-load guard.** A failing test first:

```ts
describe('lazy loading', () => {
  it('never imports the generation stack statically in the bundle', () => {
    // typescript is 23 MB and quicktype drags 25 packages; they must load
    // via dynamic import() on first use, or every `laqi` startup pays for
    // them. A static `import ... from` in the bundle means someone broke it.
    const dist = join(ROOT, 'apps', 'cli', 'dist')
    for (const file of readdirSync(dist).filter((name) => name.endsWith('.mjs'))) {
      const source = readFileSync(join(dist, file), 'utf8')
      for (const dependency of ['typescript', 'quicktype-core', '@faker-js/faker']) {
        expect(source, `${file} imports ${dependency} statically`).not.toMatch(
          new RegExp(`from\\s*["']${dependency}["']`),
        )
      }
    }
  })
})
```

Run `bun run build --filter=laqi` first so `dist/` exists; if the test fails, hunt the static import and make it dynamic. (Guard the test with `existsSync(dist)` + a skip message so a fresh clone without a build stays green — the same trap Task PR #9 fixed.)

- [ ] **Step 2: README.** After the MCP section, add:

```markdown
## Generate types and data

The panel closes the loop around the data model in both directions:

- **Data → types.** Every endpoint detail has a *Copy types* button with a
  language dropdown — TypeScript, Zod, Swift, Kotlin, Dart, Python, Go and
  twenty more. Types are derived from the live response body on demand, so
  they can never go stale.
- **Model → data.** Paste a TypeScript interface (a dirty real-world one is
  fine — `extends`, `Pick`, imports from libraries that are not present) and
  laqi generates realistic seeded data from it: `email` fields get emails,
  `createdAt` gets dates, ids are sequential. *Regenerate* on any response
  re-randomises the values from the shape the data already has.

The same two operations are MCP tools (`get_types`, `generate_data`), so an
agent can do the whole thing: paste the model from the backend discussion,
mount the mock, hand you the types.

Nothing is ever persisted except ordinary mock JSON — generated data lands in
your `laqi/` files through the same write path as the editor, and models are
never stored (types come from the data, not from a saved schema).
```

- [ ] **Step 3: Walkthrough.** In `probar-v2.md`, insert a step after the MCP section: paste the `Todo` interface in the create row, see generated data land, flip to the detail, *Copy types* as `typescript-zod`, *Regenerate*, save. Follow the document's existing voice and exact-commands style; write it against the behaviour the tests above pin.

- [ ] **Step 4: Plans index.** Add the Plan 6 row (status: whatever is true when this task runs) matching the table format the file has at that time.

- [ ] **Step 5: Full verification** — `bun run test`, `bunx turbo run check-types --force`, `bun run lint`, `bun run build`, and the tarball check: `cd apps/cli && npm pack --dry-run` still lists exactly `dist/*`, `README.md`, `LICENSE.md`, `package.json`. Commit — `feat: packaging guard, README and walkthrough for the generators`

---

## Execution notes

- Tasks 1–5 are pure `packages/generate` work with no cross-task file overlap after Task 1; Tasks 6–7 touch server+cli; 8 touches mcp+core; 9–10 touch the editor; 11 is packaging+docs. Execute in order — later tasks import earlier ones.
- The quicktype smoke loop (Task 5) and the live-server generation tests (Task 7) are the slow ones; they carry explicit timeouts.
- After the final task: full-branch review, then `superpowers:finishing-a-development-branch`.
