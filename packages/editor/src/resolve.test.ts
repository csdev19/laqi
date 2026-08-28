import { describe, expect, it } from 'vitest'
import { isDirty, liveResponse, overriddenCount, overridesAfterChipClick } from './resolve'
import type { Endpoint, LaqiState, Scenarios } from './types'

function endpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'GET /users',
    method: 'GET',
    path: '/users',
    default: 'ok',
    responses: {
      ok: { status: 200 },
      empty: { status: 200 },
      boom: { status: 500 },
    },
    file: 'laqi/api.json',
    line: 2,
    ...overrides,
  }
}

const noState: LaqiState = { scenario: null, overrides: {} }
const noScenarios: Scenarios = {}

describe('liveResponse', () => {
  it('falls back to the file default when nothing else applies', () => {
    expect(liveResponse({ endpoint: endpoint(), state: noState, scenarios: noScenarios })).toEqual({
      name: 'ok',
      layer: 'default',
    })
  })

  it('uses the active scenario when it covers the endpoint', () => {
    const scenarios: Scenarios = { 'checkout-broken': { 'GET /users': 'boom' } }
    expect(
      liveResponse({
        endpoint: endpoint(),
        state: { scenario: 'checkout-broken', overrides: {} },
        scenarios,
      }),
    ).toEqual({ name: 'boom', layer: 'scenario' })
  })

  it('ignores an active scenario that does not cover this endpoint', () => {
    const scenarios: Scenarios = { offline: { 'GET /cart': 'empty' } }
    expect(
      liveResponse({
        endpoint: endpoint(),
        state: { scenario: 'offline', overrides: {} },
        scenarios,
      }),
    ).toEqual({ name: 'ok', layer: 'default' })
  })

  it('lets a per-endpoint override beat the active scenario', () => {
    const scenarios: Scenarios = { 'checkout-broken': { 'GET /users': 'boom' } }
    expect(
      liveResponse({
        endpoint: endpoint(),
        state: { scenario: 'checkout-broken', overrides: { 'GET /users': 'empty' } },
        scenarios,
      }),
    ).toEqual({ name: 'empty', layer: 'state' })
  })
})

describe('overridesAfterChipClick', () => {
  it('writes an override for a non-default response', () => {
    expect(
      overridesAfterChipClick({
        endpoint: endpoint(),
        state: noState,
        scenarios: noScenarios,
        clicked: 'boom',
      }),
    ).toEqual({ 'GET /users': 'boom' })
  })

  it('deletes the override when clicking the file default with no scenario covering it', () => {
    expect(
      overridesAfterChipClick({
        endpoint: endpoint(),
        state: { scenario: null, overrides: { 'GET /users': 'boom' } },
        scenarios: noScenarios,
        clicked: 'ok',
      }),
    ).toEqual({})
  })

  it('keeps other endpoints untouched when deleting one override', () => {
    expect(
      overridesAfterChipClick({
        endpoint: endpoint(),
        state: { scenario: null, overrides: { 'GET /users': 'boom', 'GET /cart': 'empty' } },
        scenarios: noScenarios,
        clicked: 'ok',
      }),
    ).toEqual({ 'GET /cart': 'empty' })
  })

  it('WRITES the override when clicking the file default while a scenario covers the endpoint', () => {
    // Salirse del escenario para un endpoint es una decisión real: sin
    // override, el escenario lo volvería a mover en el próximo render.
    const scenarios: Scenarios = { 'checkout-broken': { 'GET /users': 'boom' } }
    expect(
      overridesAfterChipClick({
        endpoint: endpoint(),
        state: { scenario: 'checkout-broken', overrides: {} },
        scenarios,
        clicked: 'ok',
      }),
    ).toEqual({ 'GET /users': 'ok' })
  })
})

describe('overriddenCount', () => {
  it('counts scenario-driven and override-driven endpoints, not defaults', () => {
    const endpoints = [
      endpoint({ id: 'GET /users', path: '/users' }),
      endpoint({ id: 'GET /cart', path: '/cart' }),
      endpoint({ id: 'GET /orders', path: '/orders' }),
    ]
    const scenarios: Scenarios = { offline: { 'GET /cart': 'empty' } }
    expect(
      overriddenCount({
        endpoints,
        state: { scenario: 'offline', overrides: { 'GET /users': 'boom' } },
        scenarios,
      }),
    ).toBe(2)
  })

  it('is zero on a clean state', () => {
    expect(
      overriddenCount({ endpoints: [endpoint()], state: noState, scenarios: noScenarios }),
    ).toBe(0)
  })
})

describe('isDirty', () => {
  it('is false on a clean state', () => {
    expect(isDirty(noState)).toBe(false)
  })

  it('is true with an active scenario alone', () => {
    expect(isDirty({ scenario: 'offline', overrides: {} })).toBe(true)
  })

  it('is true with an override alone', () => {
    expect(isDirty({ scenario: null, overrides: { 'GET /users': 'boom' } })).toBe(true)
  })
})
