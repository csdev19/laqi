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
    // The name usually exists in the panel's draft and not on disk. Listing
    // what is declared is accurate and leaves the reader stuck; the fix is
    // the part worth saying.
    expect(r.message).toContain('saved to the mock file before it can be served')
  })

  // A stored override outlives the response it names: state.json is
  // outside git, and a branch switch or a rename takes the response away.
  // It used to fail loudly here, but nobody asked for it on this request,
  // the panel and get_state no longer report it, and failing turned a
  // working endpoint into a laqi error the user could not see the cause of.
  // A header naming a missing response still fails: that one was asked for.
  it('ignores a stored override whose response no longer exists, and falls through', () => {
    const r = resolveResponse({
      endpoint,
      state: { scenario: null, overrides: { 'GET /users': 'ghost' } },
      scenarios,
    })
    expect(r.ok).toBe(true)
    expect(r.layer).toBe('default')
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
