/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LaqiEvent } from '../types'
import { useEvents } from './useEvents'

// The panel's live surfaces — the request log, the endpoint list reloading
// after a file edit — all hang off this one subscription. When it breaks it
// does not throw: the panel just stops changing while looking healthy, which
// reads as "laqi stopped watching my files". Nothing covered it, because
// jsdom has no EventSource and the hook quietly no-ops without one.

type Listener = (event: MessageEvent<string>) => void

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly listeners = new Map<string, Set<Listener>>()
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  /** Deliver a frame the way the control plane would. */
  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>)
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

function withFakeEventSource(): typeof FakeEventSource {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  return FakeEventSource
}

const only = (): FakeEventSource => {
  const [instance] = FakeEventSource.instances
  if (!instance) throw new Error('the hook opened no EventSource')
  return instance
}

const aRequest: LaqiEvent = {
  type: 'request',
  method: 'GET',
  path: '/todos',
  status: 200,
  ms: 2,
  endpointId: 'GET /todos',
  resolvedName: 'ok',
  resolvedLayer: 'default',
} as LaqiEvent

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useEvents', () => {
  it('subscribes to all three event types the control plane sends', () => {
    withFakeEventSource()
    renderHook(() => useEvents(() => {}))

    for (const type of ['request', 'endpoints-changed', 'error']) {
      expect(only().listenerCount(type), `no listener for "${type}"`).toBe(1)
    }
  })

  it('hands the parsed event to the caller', () => {
    withFakeEventSource()
    const onEvent = vi.fn()
    renderHook(() => useEvents(onEvent))

    only().emit('request', JSON.stringify(aRequest))

    expect(onEvent).toHaveBeenCalledWith(aRequest)
  })

  // A malformed frame used to be able to throw out of the listener. The
  // stream is the panel's lifeline; one bad frame must not end it.
  it('survives a corrupt frame and keeps delivering the next one', () => {
    withFakeEventSource()
    const onEvent = vi.fn()
    renderHook(() => useEvents(onEvent))

    expect(() => only().emit('request', '{not json')).not.toThrow()
    only().emit('request', JSON.stringify(aRequest))

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(aRequest)
  })

  // The reason the handler lives in a ref: re-subscribing on every render
  // would drop the frames that arrive while the connection is reopening —
  // typing in the filter would silently punch holes in the request log.
  it('does not reopen the connection when the handler changes', () => {
    const Fake = withFakeEventSource()
    const { rerender } = renderHook(
      ({ onEvent }: { onEvent: (e: LaqiEvent) => void }) => useEvents(onEvent),
      { initialProps: { onEvent: vi.fn() } },
    )

    const second = vi.fn()
    rerender({ onEvent: second })
    only().emit('request', JSON.stringify(aRequest))

    expect(Fake.instances).toHaveLength(1)
    expect(second).toHaveBeenCalledWith(aRequest)
  })

  it('closes the connection and drops its listeners on unmount', () => {
    withFakeEventSource()
    const { unmount } = renderHook(() => useEvents(() => {}))
    const source = only()

    unmount()

    expect(source.closed).toBe(true)
    expect(source.listenerCount('request')).toBe(0)
  })

  // Server-rendered or non-browser environments have no EventSource. The
  // panel has to render anyway, just without the live stream.
  it('does nothing when the environment has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined)
    expect(() => renderHook(() => useEvents(() => {}))).not.toThrow()
  })
})
