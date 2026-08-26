/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toLogEntry } from '../log'
import type { LaqiEvent, LogEntry } from '../types'
import { RequestLog } from './RequestLog'

const at = new Date(2026, 7, 25, 9, 4, 7)

function served(overrides: Partial<Extract<LaqiEvent, { type: 'request' }>> = {}): LogEntry {
  return toLogEntry(
    {
      type: 'request',
      method: 'GET',
      path: '/users/42',
      status: 200,
      ms: 3,
      endpointId: 'GET /users/:id',
      resolvedName: 'ok',
      resolvedLayer: 'default',
      ...overrides,
    },
    1,
    at,
  )
}

function noRoute(): LogEntry {
  return toLogEntry(
    { type: 'request', method: 'GET', path: '/typo', status: 404, ms: 0, endpointId: null },
    2,
    at,
  )
}

function renderLog(entries: LogEntry[], props: Partial<Parameters<typeof RequestLog>[0]> = {}) {
  const onJump = vi.fn()
  render(
    <RequestLog
      entries={entries}
      paused={false}
      onTogglePause={() => {}}
      onClear={() => {}}
      onJump={onJump}
      {...props}
    />,
  )
  return { onJump }
}

afterEach(cleanup)

describe('RequestLog', () => {
  it('shows the requested path, not the route pattern', () => {
    renderLog([served()])
    expect(screen.getByText('/users/42')).toBeTruthy()
  })

  it('prints the resolved string verbatim, so it matches the response header', () => {
    renderLog([served()])
    expect(screen.getByText('ok (default)')).toBeTruthy()
  })

  it('jumps to the endpoint that served a row', () => {
    const { onJump } = renderLog([served()])
    fireEvent.click(screen.getByRole('button', { name: '/users/42' }))
    expect(onJump).toHaveBeenCalledWith('GET /users/:id')
  })

  it('gives a no-route row the loudest treatment and no destination', () => {
    renderLog([noRoute()])
    expect(screen.getByText('no matching route')).toBeTruthy()
    // No es un botón: no hay endpoint al que ir.
    expect(screen.queryByRole('button', { name: '/typo' })).toBeNull()
    expect(document.querySelector('.log-row.is-no-route')).toBeTruthy()
  })

  it('waits for requests instead of showing an empty pane', () => {
    renderLog([])
    expect(screen.getByText(/Waiting for requests/)).toBeTruthy()
  })

  it('counts what it is showing', () => {
    renderLog([served(), noRoute()])
    expect(screen.getByText('requests · 2')).toBeTruthy()
  })

  it('swaps the Pause label and dims the dot when paused', () => {
    renderLog([], { paused: true })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
    expect(document.querySelector('.live-dot.is-paused')).toBeTruthy()
  })

  it('keeps a permanent legend of the four layers', () => {
    renderLog([])
    for (const layer of ['header', 'state', 'scenario', 'default']) {
      expect(screen.getByText(layer)).toBeTruthy()
    }
  })
})
