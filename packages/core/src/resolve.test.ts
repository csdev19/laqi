import { describe, expect, it } from 'vitest'
import type { LoadedEndpoint } from './loader'
import { formatResolvedHeader, resolveResponse } from './resolve'

const endpoint: LoadedEndpoint = {
  id: 'GET /users',
  method: 'GET',
  path: '/users',
  default: 'ok',
  responses: {
    ok: { status: 200, body: [] },
    empty: { status: 200, body: [] },
    boom: { status: 500, body: { code: 'INTERNAL' } },
  },
  file: 'laqi/api.json',
  line: 2,
}

const scenarios = {
  'checkout-broken': { 'GET /users': 'boom' },
  'new-user': { 'GET /users': 'empty' },
}

const empty = { scenario: null, overrides: {} }

describe('resolveResponse precedence', () => {
  it('falls back to the file default', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'default' })
  })

  it('uses the active scenario over the default', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'checkout-broken', overrides: {} },
      scenarios,
    })
    expect(r).toMatchObject({ ok: true, name: 'boom', layer: 'scenario' })
  })

  it('uses a per-endpoint override over the scenario', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'checkout-broken', overrides: { 'GET /users': 'empty' } },
      scenarios,
    })
    expect(r).toMatchObject({ ok: true, name: 'empty', layer: 'state' })
  })

  it('uses the request header over everything', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'checkout-broken', overrides: { 'GET /users': 'empty' } },
      scenarios,
      headerResponse: 'ok',
    })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'header' })
  })

  it('reports layer "header" for a header-supplied scenario, because it persists nothing', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerScenario: 'new-user' })
    expect(r).toMatchObject({ ok: true, name: 'empty', layer: 'header' })
  })

  it('ignores an active scenario that does not cover this endpoint', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: 'unrelated', overrides: {} },
      scenarios: { unrelated: { 'GET /other': 'boom' } },
    })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'default' })
  })

  it('ignores a scenario name that does not exist', () => {
    const r = resolveResponse({ endpoint, state: { scenario: 'ghost', overrides: {} }, scenarios })
    expect(r).toMatchObject({ ok: true, name: 'ok', layer: 'default' })
  })

  it('returns the resolved response object', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerResponse: 'boom' })
    expect(r.ok && r.response.status).toBe(500)
  })
})

describe('resolveResponse failure', () => {
  it('fails loudly when a header names a response that does not exist', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerResponse: 'ghost' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toContain('ghost')
    expect(r.message).toContain('ok')
    expect(r.layer).toBe('header')
  })

  it('fails loudly when an override names a response that does not exist', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: null, overrides: { 'GET /users': 'ghost' } },
      scenarios,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.layer).toBe('state')
  })

  it('rejects a prototype-chain name like "toString" instead of serving garbage', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios, headerResponse: 'toString' })
    expect(r.ok).toBe(false)
  })
})

describe('formatResolvedHeader', () => {
  it('renders "<name> (<layer>)" exactly as the panel prints it', () => {
    const r = resolveResponse({ endpoint, state: empty, scenarios })
    expect(formatResolvedHeader(r)).toBe('ok (default)')
  })

  it('renders the state layer', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: null, overrides: { 'GET /users': 'boom' } },
      scenarios,
    })
    expect(formatResolvedHeader(r)).toBe('boom (state)')
  })
})
