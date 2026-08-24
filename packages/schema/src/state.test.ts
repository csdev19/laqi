import { describe, expect, it } from 'vitest'
import { ConfigSchema } from './config'
import { ScenariosSchema } from './scenarios'
import { DEFAULT_STATE, StateSchema } from './state'

describe('StateSchema', () => {
  it('fills in an empty state', () => {
    expect(StateSchema.parse({})).toEqual({ scenario: null, overrides: {} })
  })

  it('keeps overrides and the active scenario', () => {
    const parsed = StateSchema.parse({
      scenario: 'checkout-broken',
      overrides: { 'GET /users': 'boom' },
    })
    expect(parsed.scenario).toBe('checkout-broken')
    expect(parsed.overrides['GET /users']).toBe('boom')
  })

  it('exposes an empty DEFAULT_STATE', () => {
    expect(DEFAULT_STATE).toEqual({ scenario: null, overrides: {} })
  })
})

describe('ScenariosSchema', () => {
  it('maps a scenario name to endpoint/response pairs', () => {
    const parsed = ScenariosSchema.parse({
      'checkout-broken': { 'POST /orders': 'boom', 'GET /cart': 'empty' },
    })
    expect(parsed['checkout-broken']?.['POST /orders']).toBe('boom')
  })
})

describe('ConfigSchema', () => {
  it('applies defaults when the file is absent', () => {
    const parsed = ConfigSchema.parse({})
    expect(parsed.port).toBe(8000)
    expect(parsed.host).toBe('127.0.0.1')
    expect(parsed.dir).toBe('laqi')
    expect(parsed.file).toBe('laqi.json')
  })

  it('rejects an out-of-range port', () => {
    expect(ConfigSchema.safeParse({ port: -1 }).success).toBe(false)
    expect(ConfigSchema.safeParse({ port: 70000 }).success).toBe(false)
  })
})
