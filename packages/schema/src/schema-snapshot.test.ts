import { describe, expect, it } from 'vitest'
import { diagnostic } from './diagnostics'
import {
  DIALECT_2020_12,
  GenerationEvidenceSchema,
  SchemaSnapshotSchema,
  SourceDescriptorSchema,
} from './schema-snapshot'

const document = { $schema: DIALECT_2020_12, type: 'object' }

const snapshot = {
  name: 'Invoice',
  document,
  source: { kind: 'typescript-paste' },
  diagnostics: [],
}

describe('SourceDescriptorSchema', () => {
  it('accepts every kind the spec lists', () => {
    const sources = [
      { kind: 'typescript-paste' },
      { kind: 'json-schema' },
      { kind: 'json-schema', file: 'src/types/invoice.schema.json' },
      { kind: 'openapi', pointer: '/paths/~1invoices/get/responses/200' },
      { kind: 'openapi', file: 'openapi.yaml', pointer: '/components/schemas/Invoice' },
      { kind: 'project-module', file: 'src/types.ts', exportName: 'Invoice', side: 'output' },
    ]
    for (const source of sources) {
      expect(SourceDescriptorSchema.safeParse(source).success, JSON.stringify(source)).toBe(true)
    }
  })

  it('refuses a file on a paste, because a paste has no file to invent', () => {
    expect(
      SourceDescriptorSchema.safeParse({ kind: 'typescript-paste', file: 'src/types.ts' }).success,
    ).toBe(false)
  })

  it('requires the pointer that lets an OpenAPI refresh find the schema again', () => {
    expect(SourceDescriptorSchema.safeParse({ kind: 'openapi', file: 'a.yaml' }).success).toBe(
      false,
    )
  })

  it('requires a module to say which export and which side was converted', () => {
    expect(
      SourceDescriptorSchema.safeParse({ kind: 'project-module', file: 'a.ts', side: 'output' })
        .success,
    ).toBe(false)
    expect(
      SourceDescriptorSchema.safeParse({
        kind: 'project-module',
        file: 'a.ts',
        exportName: 'A',
        side: 'both',
      }).success,
    ).toBe(false)
  })

  it('refuses a kind it does not know', () => {
    expect(SourceDescriptorSchema.safeParse({ kind: 'graphql' }).success).toBe(false)
  })
})

describe('SchemaSnapshotSchema', () => {
  it('accepts a clean snapshot', () => {
    expect(SchemaSnapshotSchema.safeParse(snapshot).success).toBe(true)
  })

  it('keeps the diagnostics an import produced', () => {
    const withLoss = {
      ...snapshot,
      diagnostics: [diagnostic('loss.union-narrowed', 'kept the first member', '/properties/a')],
    }
    expect(SchemaSnapshotSchema.safeParse(withLoss).success).toBe(true)
  })

  it('requires the stored document to declare draft 2020-12, whatever the source spoke', () => {
    const draft07 = {
      ...snapshot,
      document: { $schema: 'http://json-schema.org/draft-07/schema#' },
    }
    const result = SchemaSnapshotSchema.safeParse(draft07)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain(DIALECT_2020_12)

    expect(
      SchemaSnapshotSchema.safeParse({ ...snapshot, document: { type: 'object' } }).success,
    ).toBe(false)
  })

  it('refuses a bare boolean document, which has nowhere to declare its dialect', () => {
    expect(SchemaSnapshotSchema.safeParse({ ...snapshot, document: true }).success).toBe(false)
  })

  it('stores nothing beside the document — no Shape, no packed form, no source text', () => {
    expect(
      SchemaSnapshotSchema.safeParse({ ...snapshot, shape: { kind: 'unknown' } }).success,
    ).toBe(false)
    expect(SchemaSnapshotSchema.safeParse({ ...snapshot, model: 'interface A {}' }).success).toBe(
      false,
    )
  })

  it('needs a name to show, because a snapshot with no label cannot be reported', () => {
    expect(SchemaSnapshotSchema.safeParse({ ...snapshot, name: '' }).success).toBe(false)
  })
})

describe('GenerationEvidenceSchema', () => {
  const evidence = {
    seed: 7,
    options: { arrayLength: 3 },
    bodyHash: 'a'.repeat(64),
  }

  it('accepts the evidence a generated body carries', () => {
    expect(GenerationEvidenceSchema.safeParse(evidence).success).toBe(true)
  })

  it('records the effective arrayLength, always', () => {
    expect(GenerationEvidenceSchema.safeParse({ ...evidence, options: {} }).success).toBe(false)
  })

  it('carries any further option that changed the output', () => {
    const parsed = GenerationEvidenceSchema.safeParse({
      ...evidence,
      options: { arrayLength: 3, locale: 'es' },
    })
    expect(parsed.success && parsed.data.options.locale).toBe('es')
  })

  it('needs a seed, because a body with no seed cannot be reproduced', () => {
    const { seed: _seed, ...withoutSeed } = evidence
    expect(GenerationEvidenceSchema.safeParse(withoutSeed).success).toBe(false)
  })

  it('takes only a lowercase hex SHA-256', () => {
    expect(
      GenerationEvidenceSchema.safeParse({ ...evidence, bodyHash: 'A'.repeat(64) }).success,
    ).toBe(false)
    expect(GenerationEvidenceSchema.safeParse({ ...evidence, bodyHash: 'ab' }).success).toBe(false)
  })
})
