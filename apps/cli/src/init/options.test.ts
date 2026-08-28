import { describe, expect, it } from 'vitest'
import type { RawInitFlags } from './args'
import { DEFAULT_DIR, DEFAULT_PORT, resolveInitOptions } from './options'

function ok(flags: RawInitFlags) {
  const result = resolveInitOptions(flags)
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
  return result.options
}

function err(flags: RawInitFlags) {
  const result = resolveInitOptions(flags)
  if (result.ok) throw new Error('expected an error, got ok')
  return result.error
}

describe('resolveInitOptions — defaults', () => {
  it('resolves every question to its documented default with no flags', () => {
    // The table in laqi-init.md, row by row.
    expect(ok({})).toEqual({
      dir: DEFAULT_DIR,
      from: 'example',
      spec: undefined,
      port: DEFAULT_PORT,
      script: false,
      open: false,
      force: false,
    })
  })

  it('--yes changes nothing by itself — every field still resolves to its default', () => {
    expect(ok({ yes: true })).toEqual(ok({}))
  })
})

describe('resolveInitOptions — mocks folder', () => {
  it('--dir overrides the default', () => {
    expect(ok({ dir: './mocks' }).dir).toBe('./mocks')
  })

  it('strips a trailing slash so paths join predictably', () => {
    expect(ok({ dir: 'mocks/' }).dir).toBe('mocks')
  })

  it('falls back to the default on an empty --dir', () => {
    expect(ok({ dir: '  ' }).dir).toBe(DEFAULT_DIR)
  })
})

describe('resolveInitOptions — start from', () => {
  it('accepts example, empty and openapi', () => {
    expect(ok({ from: 'example', spec: undefined }).from).toBe('example')
    expect(ok({ from: 'empty' }).from).toBe('empty')
    expect(ok({ from: 'openapi', spec: './api.json' }).from).toBe('openapi')
  })

  it('rejects scan with a message naming it as a future spec, not a typo', () => {
    const message = err({ from: 'scan' })
    expect(message).toContain('scan')
    expect(message).toContain('is not implemented yet')
  })

  it('rejects an unrecognised value', () => {
    expect(err({ from: 'bogus' })).toContain('bogus')
  })

  it('requires --spec when --from openapi is given', () => {
    expect(err({ from: 'openapi' })).toContain('--spec')
  })

  it('carries the spec path through when given', () => {
    expect(ok({ from: 'openapi', spec: './openapi.json' }).spec).toBe('./openapi.json')
  })
})

describe('resolveInitOptions — port', () => {
  it('--port overrides the default', () => {
    expect(ok({ port: '8010' }).port).toBe(8010)
  })

  it('rejects a non-numeric port', () => {
    expect(err({ port: 'abc' })).toContain('abc')
  })

  it('rejects a port outside 0-65535', () => {
    expect(err({ port: '70000' }).length).toBeGreaterThan(0)
    expect(err({ port: '-1' }).length).toBeGreaterThan(0)
  })

  it('rejects a fractional port', () => {
    expect(err({ port: '80.5' })).toContain('80.5')
  })
})

describe('resolveInitOptions — add npm script', () => {
  it('defaults to off', () => {
    expect(ok({}).script).toBe(false)
  })

  it('bare --script resolves to the default name "mock"', () => {
    expect(ok({ script: true }).script).toBe('mock')
  })

  it('--script=name carries the custom name through', () => {
    expect(ok({ script: 'mock:api' }).script).toBe('mock:api')
  })
})

describe('resolveInitOptions — open the panel', () => {
  it('defaults to off', () => {
    expect(ok({}).open).toBe(false)
  })

  it('--open turns it on', () => {
    expect(ok({ open: true }).open).toBe(true)
  })
})

describe('resolveInitOptions — force', () => {
  it('defaults to off', () => {
    expect(ok({}).force).toBe(false)
  })

  it('--force turns it on', () => {
    expect(ok({ force: true }).force).toBe(true)
  })
})

describe('resolveInitOptions — purity', () => {
  it('is a pure function: same flags in, deep-equal options out, no I/O', () => {
    const flags: RawInitFlags = { dir: './mocks', from: 'empty', port: '8010', open: true }
    expect(ok(flags)).toEqual(ok({ ...flags }))
  })
})
