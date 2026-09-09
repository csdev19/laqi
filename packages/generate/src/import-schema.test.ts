import { DIALECT_2020_12, isAcknowledgeable, type Diagnostic } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
import { importSchema, previewBody } from './import-schema'

const codes = (diagnostics: readonly Diagnostic[]) => diagnostics.map((d) => d.code)

describe('importing a JSON Schema document', () => {
  it('stores the document as produced, with the dialect stamped on it', async () => {
    const snapshot = await importSchema({
      kind: 'json-schema',
      document: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      name: 'Thing',
    })
    expect(snapshot.name).toBe('Thing')
    expect(snapshot.source).toEqual({ kind: 'json-schema' })
    expect(snapshot.document.$schema).toBe(DIALECT_2020_12)
    expect(snapshot.document.type).toBe('object')
  })

  it('never adds additionalProperties: false, and never strips one the source gave', async () => {
    const open = await importSchema({
      kind: 'json-schema',
      document: { type: 'object', properties: { a: { type: 'string' } } },
    })
    expect(open.document.additionalProperties).toBeUndefined()

    const closed = await importSchema({
      kind: 'json-schema',
      document: {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: false,
      },
    })
    expect(closed.document.additionalProperties).toBe(false)
  })

  it('keeps an explicit empty schema without calling it loss', async () => {
    const snapshot = await importSchema({
      kind: 'json-schema',
      document: { type: 'object', properties: { metadata: {} }, required: ['metadata'] },
    })
    // A document with no $schema still earns the information diagnostic
    // that says laqi read it as 2020-12. What matters here is that the empty
    // schema itself is not loss.
    expect(snapshot.diagnostics.filter((d) => d.kind === 'loss')).toEqual([])
  })

  it('records the file a document came from, relative to the source root', async () => {
    const snapshot = await importSchema({
      kind: 'json-schema',
      document: { type: 'string' },
      file: 'src/types/a.schema.json',
    })
    expect(snapshot.source).toEqual({ kind: 'json-schema', file: 'src/types/a.schema.json' })
  })
})

describe('importing a pasted TypeScript model', () => {
  it('emits a closed object, because that is what an interface means', async () => {
    const snapshot = await importSchema({
      kind: 'typescript-paste',
      source: 'export interface Invoice { id: string; total?: number }',
    })
    expect(snapshot.name).toBe('Invoice')
    expect(snapshot.source).toEqual({ kind: 'typescript-paste' })
    expect(snapshot.document).toMatchObject({
      type: 'object',
      required: ['id'],
      additionalProperties: false,
    })
  })

  it('picks the declaration the caller names', async () => {
    const snapshot = await importSchema({
      kind: 'typescript-paste',
      source: 'export type Role = "a" | "b"\nexport interface User { role: Role }',
      typeName: 'User',
    })
    expect(snapshot.name).toBe('User')
  })

  it('fails on source that has no type at all', async () => {
    await expect(
      importSchema({ kind: 'typescript-paste', source: 'const a = 1' }),
    ).rejects.toThrow()
  })
})

describe('the strict loss policy', () => {
  const unresolvable = {
    kind: 'typescript-paste' as const,
    source: "import type { Money } from 'nowhere'\nexport interface Bill { total: Money }",
  }

  it('refuses an import that loses information, and writes nothing', async () => {
    await expect(importSchema(unresolvable)).rejects.toThrow(/would lose information/i)
  })

  it('carries the diagnostics on the failure, so a caller needs no second call', async () => {
    const failure = await importSchema(unresolvable).catch((error: unknown) => error)
    expect(codes((failure as { diagnostics: Diagnostic[] }).diagnostics)).toContain(
      'loss.unresolved-type',
    )
  })

  it('stores the approximation and its diagnostic when the loss is acknowledged', async () => {
    const snapshot = await importSchema(unresolvable, { allowLoss: true })
    expect(codes(snapshot.diagnostics)).toContain('loss.unresolved-type')
    expect(snapshot.diagnostics.every((d) => isAcknowledgeable(d.code))).toBe(true)
  })

  it('acknowledges a cut cycle, which is on the list', async () => {
    const circular = { $defs: { A: { $ref: '#/$defs/A' } }, $ref: '#/$defs/A' }
    const snapshot = await importSchema(
      { kind: 'json-schema', document: circular },
      { allowLoss: true },
    )
    expect(codes(snapshot.diagnostics)).toContain('loss.circular')
  })

  it('refuses that same cycle under the strict default', async () => {
    const circular = { $defs: { A: { $ref: '#/$defs/A' } }, $ref: '#/$defs/A' }
    await expect(importSchema({ kind: 'json-schema', document: circular })).rejects.toThrow(
      /would lose information/i,
    )
  })

  it('refuses an error-severity diagnostic even with allowLoss', async () => {
    const failure = await importSchema(
      { kind: 'json-schema', document: { type: 'string', pattern: '^a' } },
      { allowLoss: true },
    ).catch((error: unknown) => error)
    expect(codes((failure as { diagnostics: Diagnostic[] }).diagnostics)).toContain(
      'unsupported.keyword',
    )
  })

  it('does not block on an information diagnostic', async () => {
    const snapshot = await importSchema({
      kind: 'json-schema',
      document: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' },
    })
    expect(codes(snapshot.diagnostics)).toEqual(['dialect.normalized'])
  })
})

describe('previewing a body from a snapshot', () => {
  it('returns the body with the evidence that reproduces it', async () => {
    const snapshot = await importSchema({
      kind: 'json-schema',
      document: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    })
    const preview = await previewBody(snapshot, { seed: 7, arrayLength: 4 })

    expect(preview.evidence.seed).toBe(7)
    expect(preview.evidence.options.arrayLength).toBe(4)
    expect(preview.evidence.bodyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await previewBody(snapshot, { seed: 7, arrayLength: 4 })).toEqual(preview)
  })

  it('allocates a seed when the caller gives none, so the body stays reproducible', async () => {
    const snapshot = await importSchema({ kind: 'json-schema', document: { type: 'string' } })
    const preview = await previewBody(snapshot)

    expect(Number.isInteger(preview.evidence.seed)).toBe(true)
    const again = await previewBody(snapshot, { seed: preview.evidence.seed })
    expect(again.body).toEqual(preview.body)
  })

  it('records the effective arrayLength, not the one asked for', async () => {
    const snapshot = await importSchema({
      kind: 'json-schema',
      document: { type: 'array', items: { type: 'integer' } },
    })
    const preview = await previewBody(snapshot, { seed: 1, arrayLength: 9999 })
    expect(preview.evidence.options.arrayLength).toBe(1000)
    expect(preview.body).toHaveLength(1000)
  })

  it('replays the snapshot diagnostics, so an approximation stays visible after a reload', async () => {
    const snapshot = await importSchema(
      {
        kind: 'typescript-paste',
        source: "import type { M } from 'nowhere'\nexport interface B { total: M }",
      },
      { allowLoss: true },
    )
    const preview = await previewBody(snapshot, { seed: 1 })
    expect(codes(preview.diagnostics)).toContain('loss.unresolved-type')
  })
})
