import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateStore } from './state-store'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-state-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('StateStore', () => {
  it('returns the default state when nothing has been written', () => {
    expect(new StateStore(root).read()).toEqual({ scenario: null, overrides: {} })
  })

  it('round-trips a state', () => {
    const store = new StateStore(root)
    store.write({ scenario: 'checkout-broken', overrides: { 'GET /users': 'boom' } })
    expect(store.read()).toEqual({
      scenario: 'checkout-broken',
      overrides: { 'GET /users': 'boom' },
    })
  })

  it('creates the .laqi directory on write', () => {
    const store = new StateStore(root)
    store.write({ scenario: null, overrides: { 'GET /a': 'b' } })
    expect(store.path).toContain('.laqi')
    expect(readFileSync(store.path, 'utf8')).toContain('GET /a')
  })

  it('falls back to the default state when the file is corrupt', () => {
    mkdirSync(join(root, '.laqi'), { recursive: true })
    writeFileSync(join(root, '.laqi', 'state.json'), 'not json', 'utf8')
    expect(new StateStore(root).read()).toEqual({ scenario: null, overrides: {} })
  })

  it('falls back when the file parses but has the wrong shape', () => {
    mkdirSync(join(root, '.laqi'), { recursive: true })
    writeFileSync(join(root, '.laqi', 'state.json'), '{"overrides": 42}', 'utf8')
    expect(new StateStore(root).read()).toEqual({ scenario: null, overrides: {} })
  })

  it('writes formatted JSON so a human can read it', () => {
    const store = new StateStore(root)
    store.write({ scenario: null, overrides: { 'GET /a': 'b' } })
    expect(readFileSync(store.path, 'utf8')).toContain('\n')
  })
})
