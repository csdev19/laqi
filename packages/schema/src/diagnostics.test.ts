import { describe, expect, it } from 'vitest'
import { DIAGNOSTIC_CODES, DiagnosticSchema, diagnostic } from './diagnostics'

describe('diagnostic()', () => {
  it('takes kind and severity from the code, so a call site cannot disagree with the table', () => {
    expect(diagnostic('loss.union-narrowed', 'a mixed union kept only its first member')).toEqual({
      code: 'loss.union-narrowed',
      kind: 'loss',
      severity: 'warning',
      pointer: '',
      message: 'a mixed union kept only its first member',
    })

    expect(diagnostic('dialect.normalized', 'draft-07 was rewritten to 2020-12')).toMatchObject({
      kind: 'information',
      severity: 'warning',
    })

    expect(diagnostic('unsatisfiable', 'an empty enum has no member to pick')).toMatchObject({
      kind: 'loss',
      severity: 'error',
    })
  })

  it('records the pointer into the source when there is one', () => {
    expect(diagnostic('loss.depth', 'too deep', '/properties/a/items').pointer).toBe(
      '/properties/a/items',
    )
  })
})

describe('the code table', () => {
  it('gives every code exactly one kind and severity', () => {
    for (const [code, entry] of Object.entries(DIAGNOSTIC_CODES)) {
      expect(entry.kind, code).toMatch(/^(loss|information)$/)
      expect(entry.severity, code).toMatch(/^(warning|error)$/)
      expect(entry.raisedWhen.length, code).toBeGreaterThan(0)
    }
  })

  it('never marks an information diagnostic as an error, because information does not block', () => {
    for (const [code, entry] of Object.entries(DIAGNOSTIC_CODES)) {
      if (entry.kind === 'information') expect(entry.severity, code).toBe('warning')
    }
  })
})

describe('DiagnosticSchema', () => {
  it('accepts a diagnostic this package built', () => {
    expect(
      DiagnosticSchema.safeParse(diagnostic('loss.function', 'a callable has no data form'))
        .success,
    ).toBe(true)
  })

  it('refuses a code it does not know, naming it', () => {
    const result = DiagnosticSchema.safeParse({
      code: 'loss.invented',
      kind: 'loss',
      severity: 'warning',
      pointer: '',
      message: 'x',
    })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('loss.invented')
  })

  it('refuses a stored diagnostic whose kind disagrees with its code', () => {
    const result = DiagnosticSchema.safeParse({
      ...diagnostic('loss.depth', 'too deep'),
      kind: 'information',
    })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('loss.depth')
  })

  it('refuses a stored diagnostic whose severity disagrees with its code', () => {
    const result = DiagnosticSchema.safeParse({
      ...diagnostic('unsatisfiable', 'nothing satisfies this'),
      severity: 'warning',
    })
    expect(result.success).toBe(false)
  })
})

describe('the parsed type', () => {
  it('carries the code as a DiagnosticCode, so the table can be indexed with it', () => {
    const parsed = DiagnosticSchema.parse(diagnostic('loss.circular', 'cut a self-reference'))
    // A compile-time assertion as much as a run-time one: `parsed.code` would
    // not index DIAGNOSTIC_CODES if it were a bare string.
    expect(DIAGNOSTIC_CODES[parsed.code].kind).toBe('loss')
  })
})
