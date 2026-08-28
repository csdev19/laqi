import { describe, expect, it } from 'vitest'
import { parseInitArgs } from './args'

function ok(argv: string[]) {
  const result = parseInitArgs(argv)
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`)
  return result.flags
}

function err(argv: string[]) {
  const result = parseInitArgs(argv)
  if (result.ok) throw new Error('expected an error, got ok')
  return result.error
}

describe('parseInitArgs', () => {
  it('parses nothing into an empty flags object', () => {
    expect(ok([])).toEqual({})
  })

  it('parses --dir and --port as values', () => {
    expect(ok(['--dir', './mocks', '--port', '8010'])).toEqual({ dir: './mocks', port: '8010' })
  })

  it('accepts the --flag=value form for value flags', () => {
    expect(ok(['--dir=./mocks', '--from=openapi'])).toEqual({ dir: './mocks', from: 'openapi' })
  })

  it('parses bare --script as true', () => {
    expect(ok(['--script'])).toEqual({ script: true })
  })

  it('parses --script=name as the name', () => {
    expect(ok(['--script=mock:api'])).toEqual({ script: 'mock:api' })
  })

  it('rejects --script= with no name', () => {
    expect(err(['--script='])).toContain('non-empty name')
  })

  it('parses the boolean flags', () => {
    expect(ok(['--open', '--force', '--yes', '--help'])).toEqual({
      open: true,
      force: true,
      yes: true,
      help: true,
    })
  })

  it('accepts -h as an alias for --help', () => {
    expect(ok(['-h'])).toEqual({ help: true })
  })

  it('rejects an unknown flag', () => {
    expect(err(['--bogus'])).toContain('--bogus')
  })

  it('rejects a value flag with no value at the end of argv', () => {
    expect(err(['--dir'])).toContain('--dir needs a value')
  })

  it('combines value and boolean flags in one call', () => {
    expect(ok(['--from', 'empty', '--open', '--script=mock'])).toEqual({
      from: 'empty',
      open: true,
      script: 'mock',
    })
  })
})
