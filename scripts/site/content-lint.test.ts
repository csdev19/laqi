// scripts/site/content-lint.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findBrandCasingViolations } from './content-lint'

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('findBrandCasingViolations', () => {
  it('flags "Laqi" in prose', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'Laqi is a mock server.\n')
    const violations = findBrandCasingViolations(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 1, match: 'Laqi' })
  })

  it('flags "LAQI" in prose', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'Run LAQI to start.\n')
    const violations = findBrandCasingViolations(dir)
    expect(violations).toHaveLength(1)
  })

  it('does not flag "laqi" written correctly', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'laqi is a mock server.\n')
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })

  it('does not flag "Laqi" inside an inline code span', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'The identifier is `Laqi.Client`.\n')
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })

  it('does not flag "Laqi" inside a fenced code block', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), '```\nconst Laqi = require("laqi")\n```\n')
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })

  it('flags "Laqi" at the start of a sentence, the most common real mistake', () => {
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(join(dir, 'page.md'), 'Setup\n\nLaqi runs on port 8000 by default.\n')
    const violations = findBrandCasingViolations(dir)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.file).toMatch(/page\.md$/)
  })

  it('does not flag "Laqi" as a segment of a real hyphenated header name', () => {
    // X-Laqi-Response and X-Laqi-Resolved are real, already-shipped HTTP
    // headers (see packages/server/src/control-plane-app.ts) — this is
    // the correct capitalization for that identifier, not a casing
    // mistake. A plain \bLaqi\b regex would wrongly flag this: a hyphen
    // counts as a word boundary, so "X-Laqi-Response" reads as three
    // boundary-separated words to \b, the middle one matching "Laqi".
    dir = mkdtempSync(join(tmpdir(), 'content-lint-'))
    writeFileSync(
      join(dir, 'page.md'),
      'Every response carries an X-Laqi-Response header naming the winner, ' +
        'and laqi also sets X-Laqi-Resolved for the same purpose.\n',
    )
    expect(findBrandCasingViolations(dir)).toHaveLength(0)
  })
})
