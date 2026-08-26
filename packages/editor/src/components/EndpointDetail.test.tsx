/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Endpoint } from '../types'
import { EndpointDetail } from './EndpointDetail'

function endpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'GET /users',
    method: 'GET',
    path: '/users',
    description: 'the people',
    default: 'ok',
    responses: { ok: { status: 200, body: { a: 1 } }, boom: { status: 500 } },
    file: 'laqi/api.json',
    line: 2,
    ...overrides,
  }
}

function renderDetail(value: Endpoint) {
  const props = {
    endpoint: value,
    state: { scenario: null, overrides: {} },
    scenarios: {},
    address: '127.0.0.1:8000',
    saveError: null,
    onBack: vi.fn(),
    onFlip: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
  }
  const view = render(<EndpointDetail {...props} />)
  return { ...props, rerender: (next: Endpoint) => view.rerender(<EndpointDetail {...props} endpoint={next} />) }
}

const body = () => screen.getByLabelText('response body') as HTMLTextAreaElement

afterEach(cleanup)

describe('the draft survives an unrelated reload', () => {
  it('keeps what you were typing when the endpoint object is replaced but unchanged', () => {
    // App.refresh() vuelve a parsear el JSON del servidor, así que devuelve
    // objetos nuevos aunque nada haya cambiado. Cualquier recarga ajena —
    // el watcher, un agente por MCP, otra pestaña guardando — pasaba por
    // acá y borraba lo que estabas tipeando, sin aviso.
    const original = endpoint()
    const { rerender } = renderDetail(original)

    fireEvent.change(body(), { target: { value: '{"half-typed": ' } })
    rerender(structuredClone(original))

    expect(body().value).toBe('{"half-typed": ')
  })

  it('keeps it across several such reloads', () => {
    const original = endpoint()
    const { rerender } = renderDetail(original)

    fireEvent.change(body(), { target: { value: '{"mine": 1}' } })
    for (let i = 0; i < 5; i++) rerender(structuredClone(original))

    expect(body().value).toBe('{"mine": 1}')
  })

  it('still resets when the definition genuinely changed on disk', async () => {
    const { rerender } = renderDetail(endpoint())
    fireEvent.change(body(), { target: { value: '{"mine": 1}' } })

    rerender(endpoint({ responses: { ok: { status: 200, body: { theirs: 2 } }, boom: { status: 500 } } }))

    await waitFor(() => expect(body().value).toContain('theirs'))
  })

  it('resets when switching to a different endpoint entirely', async () => {
    const { rerender } = renderDetail(endpoint())
    fireEvent.change(body(), { target: { value: '{"mine": 1}' } })

    rerender(endpoint({ id: 'GET /orders', path: '/orders', responses: { ok: { status: 200, body: {} } }, default: 'ok' }))

    await waitFor(() => expect(body().value).not.toContain('mine'))
  })
})
