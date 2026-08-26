// packages/core/src/events.test.ts
import { describe, expect, it, vi } from 'vitest'
import { EventBus, type LaqiEvent } from './events'

describe('EventBus', () => {
  it('delivers an emitted event to a subscribed listener', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = { type: 'endpoints-changed', endpointCount: 3 }
    bus.emit(event)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(event)
  })

  it('delivers to every subscriber', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.subscribe(a)
    bus.subscribe(b)

    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)

    unsubscribe()
    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribing one listener does not affect another', () => {
    const bus = new EventBus()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = bus.subscribe(a)
    bus.subscribe(b)

    unsubscribeA()
    bus.emit({ type: 'endpoints-changed', endpointCount: 1 })

    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('carries a request event with the exact fields the log needs', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = {
      type: 'request',
      method: 'GET',
      path: '/users',
      status: 200,
      ms: 4,
      endpointId: 'GET /users',
      resolvedName: 'ok',
      resolvedLayer: 'default',
    }
    bus.emit(event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it('carries a no-route request event, which has no resolution', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = {
      type: 'request',
      method: 'GET',
      path: '/typo',
      status: 404,
      ms: 0,
      endpointId: null,
    }
    bus.emit(event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it('carries an error event with file position', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.subscribe(listener)

    const event: LaqiEvent = {
      type: 'error',
      file: 'laqi/api.json',
      line: 4,
      col: 7,
      message: 'trailing comma',
      excerpt: '4 | }\n  | ^',
    }
    bus.emit(event)

    expect(listener).toHaveBeenCalledWith(event)
  })

  it('a listener throwing does not stop delivery to the next listener', () => {
    const bus = new EventBus()
    const broken = vi.fn(() => {
      throw new Error('boom')
    })
    const healthy = vi.fn()
    bus.subscribe(broken)
    bus.subscribe(healthy)

    expect(() => bus.emit({ type: 'endpoints-changed', endpointCount: 1 })).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
