/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Endpoint, LaqiState, Scenarios, Status } from './types'

const putState = vi.fn()
const createEndpoint = vi.fn()
const updateEndpoint = vi.fn()
const deleteEndpoint = vi.fn()

let endpoints: Endpoint[]
let state: LaqiState
let scenarios: Scenarios
let status: Status

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    api: {
      getEndpoints: () => Promise.resolve(endpoints),
      getState: () => Promise.resolve(state),
      getScenarios: () => Promise.resolve(scenarios),
      getStatus: () => Promise.resolve(status),
      putState: (next: LaqiState) => {
        putState(next)
        state = next
        return Promise.resolve(next)
      },
      createEndpoint,
      updateEndpoint,
      deleteEndpoint,
    },
  }
})

const { App } = await import('./App')

function endpoint(partial: Partial<Endpoint> & Pick<Endpoint, 'id' | 'method' | 'path'>): Endpoint {
  return {
    default: 'ok',
    responses: { ok: { status: 200, body: { a: 1 } }, boom: { status: 500 } },
    file: 'laqi/api.json',
    line: 2,
    ...partial,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  endpoints = [
    endpoint({ id: 'GET /users', method: 'GET', path: '/users', description: 'the people' }),
    endpoint({ id: 'POST /orders', method: 'POST', path: '/orders' }),
  ]
  state = { scenario: null, overrides: {} }
  scenarios = { 'checkout-broken': { 'POST /orders': 'boom' } }
  status = { watching: 'laqi', endpointCount: 2, address: '127.0.0.1:8000', errors: [] }
})

afterEach(cleanup)

/** Espera al primer render con datos ya cargados. */
async function renderApp() {
  render(<App />)
  await screen.findByText('/users')
}

function rowFor(path: string): HTMLElement {
  const button = screen.getByRole('button', { name: path })
  const row = button.closest('.endpoint-row')
  if (!row) throw new Error(`no row for ${path}`)
  return row as HTMLElement
}

describe('endpoint list', () => {
  it('lists every endpoint with its method, path and description', async () => {
    await renderApp()
    expect(screen.getByText('/orders')).toBeTruthy()
    expect(screen.getByText('the people')).toBeTruthy()
    expect(within(rowFor('/users')).getByText('GET')).toBeTruthy()
  })

  it('shows every response as its own chip, so a flip is one click', async () => {
    await renderApp()
    const row = rowFor('/users')
    expect(within(row).getByRole('button', { name: /^ok/ })).toBeTruthy()
    expect(within(row).getByRole('button', { name: /^boom/ })).toBeTruthy()
  })

  it('marks the live chip as pressed and the others as not', async () => {
    await renderApp()
    const row = rowFor('/users')
    expect(within(row).getByRole('button', { name: /^ok/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(row).getByRole('button', { name: /^boom/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('reads layer "default" on an untouched row', async () => {
    await renderApp()
    expect(within(rowFor('/users')).getByText('default')).toBeTruthy()
  })
})

describe('flipping a response', () => {
  it('writes an override and repaints the row as state', async () => {
    await renderApp()
    fireEvent.click(within(rowFor('/users')).getByRole('button', { name: /^boom/ }))

    await waitFor(() => expect(putState).toHaveBeenCalled())
    expect(putState.mock.calls[0]![0]).toEqual({
      scenario: null,
      overrides: { 'GET /users': 'boom' },
    })
    await waitFor(() => expect(within(rowFor('/users')).getByText('state')).toBeTruthy())
  })

  it('removes the override when the file default is clicked back', async () => {
    state = { scenario: null, overrides: { 'GET /users': 'boom' } }
    await renderApp()

    fireEvent.click(within(rowFor('/users')).getByRole('button', { name: /^ok/ }))

    await waitFor(() => expect(putState).toHaveBeenCalled())
    expect(putState.mock.calls[0]![0]).toEqual({ scenario: null, overrides: {} })
  })

  it('counts overridden endpoints in the header', async () => {
    await renderApp()
    fireEvent.click(within(rowFor('/users')).getByRole('button', { name: /^boom/ }))
    await waitFor(() => {
      const overridden = document.querySelector('.fact-value.is-overridden')
      expect(overridden?.textContent).toBe('1')
    })
  })
})

describe('scenarios', () => {
  it('activates a scenario and moves the endpoints it covers', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: /checkout-broken/ }))

    await waitFor(() =>
      expect(putState).toHaveBeenCalledWith({ scenario: 'checkout-broken', overrides: {} }),
    )
    await waitFor(() => expect(within(rowFor('/orders')).getByText('scenario')).toBeTruthy())
  })

  it('deactivates it when clicked again', async () => {
    state = { scenario: 'checkout-broken', overrides: {} }
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: /checkout-broken/ }))
    await waitFor(() => expect(putState).toHaveBeenCalledWith({ scenario: null, overrides: {} }))
  })

  it('shows how many endpoints a scenario touches before you click it', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: /checkout-broken/ }).textContent).toContain('1')
  })

  it('hides Reset all until something is dirty, then clears both layers', async () => {
    await renderApp()
    expect(screen.queryByRole('button', { name: 'Reset all to default' })).toBeNull()

    fireEvent.click(within(rowFor('/users')).getByRole('button', { name: /^boom/ }))
    const reset = await screen.findByRole('button', { name: 'Reset all to default' })

    fireEvent.click(reset)
    await waitFor(() =>
      expect(putState).toHaveBeenLastCalledWith({ scenario: null, overrides: {} }),
    )
  })

  it('lets a per-endpoint override beat the active scenario', async () => {
    state = { scenario: 'checkout-broken', overrides: { 'POST /orders': 'ok' } }
    await renderApp()
    expect(within(rowFor('/orders')).getByText('state')).toBeTruthy()
  })
})

describe('filter', () => {
  it('narrows the list and updates the count', async () => {
    await renderApp()
    fireEvent.change(screen.getByLabelText('filter'), { target: { value: 'orders' } })

    expect(screen.queryByText('/users')).toBeNull()
    expect(screen.getByText('1 shown')).toBeTruthy()
  })

  it('says so when nothing matches instead of showing a blank pane', async () => {
    await renderApp()
    fireEvent.change(screen.getByLabelText('filter'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No endpoint matches/)).toBeTruthy()
  })
})

describe('command palette', () => {
  it('opens with ctrl+K and flips the chosen response on enter', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    const input = await screen.findByLabelText('command')
    fireEvent.change(input, { target: { value: 'orders boom' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(putState).toHaveBeenCalledWith({ scenario: null, overrides: { 'POST /orders': 'boom' } }),
    )
    expect(screen.queryByLabelText('command')).toBeNull()
  })

  it('closes on escape without touching state', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await screen.findByLabelText('command')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('command')).toBeNull())
    expect(putState).not.toHaveBeenCalled()
  })

  it('marks an already-live option so you do not flip what is already flipped', async () => {
    await renderApp()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByLabelText('command'), { target: { value: 'users ok' } })

    expect(screen.getByText('live')).toBeTruthy()
  })
})

describe('creating an endpoint', () => {
  it('posts the definition and opens the new endpoint', async () => {
    createEndpoint.mockResolvedValue({ id: 'GET /health' })
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: '+ New endpoint' }))
    fireEvent.change(screen.getByLabelText('path'), { target: { value: '/health' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(createEndpoint).toHaveBeenCalledWith({
        method: 'GET',
        path: '/health',
        default: 'ok',
        responses: { ok: { status: 200, body: {} } },
      }),
    )
  })

  it('refuses a path that does not start with a slash', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '+ New endpoint' }))
    fireEvent.change(screen.getByLabelText('path'), { target: { value: 'health' } })

    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true)
  })

  it('shows the server error next to the form, not in a toast', async () => {
    createEndpoint.mockRejectedValue(new Error('"GET /users" already exists in laqi/api.json'))
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: '+ New endpoint' }))
    fireEvent.change(screen.getByLabelText('path'), { target: { value: '/users' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText(/already exists/)).toBeTruthy()
  })
})

describe('endpoint detail', () => {
  it('opens from the path and goes back on escape', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '/users' }))

    expect(await screen.findByLabelText('response body')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('response body')).toBeNull())
  })

  it('offers a curl that teaches the header layer', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '/users' }))

    expect(await screen.findByText(/X-Laqi-Response: ok/)).toBeTruthy()
    expect(screen.getByText(/127\.0\.0\.1:8000\/users/)).toBeTruthy()
  })

  it('names the file the endpoint came from', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '/users' }))
    expect(await screen.findByText('laqi/api.json:2')).toBeTruthy()
  })

  it('saves an edited body back to the file', async () => {
    updateEndpoint.mockResolvedValue({ ok: true })
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '/users' }))

    const body = await screen.findByLabelText('response body')
    fireEvent.change(body, { target: { value: '{"a": 2}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }))

    await waitFor(() =>
      expect(updateEndpoint).toHaveBeenCalledWith('GET /users', {
        description: 'the people',
        default: 'ok',
        responses: { ok: { status: 200, body: { a: 2 } }, boom: { status: 500 } },
      }),
    )
  })

  it('blocks the save while the body is not valid JSON', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '/users' }))

    const body = await screen.findByLabelText('response body')
    fireEvent.change(body, { target: { value: '{"a": ' } })

    expect(screen.getByRole('button', { name: 'Save to file' }).hasAttribute('disabled')).toBe(true)
  })

  it('deletes the endpoint and returns to the list', async () => {
    deleteEndpoint.mockResolvedValue(undefined)
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '/users' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete endpoint' }))

    await waitFor(() => expect(deleteEndpoint).toHaveBeenCalledWith('GET /users'))
  })
})

describe('load failures', () => {
  it('shows the parse error inline and says the rest is still served', async () => {
    status = {
      ...status,
      errors: [{ file: 'laqi/api.json', line: 7, col: 3, message: 'a trailing comma after "boom"' }],
    }
    await renderApp()

    expect(screen.getByText('laqi/api.json:7:3')).toBeTruthy()
    expect(screen.getByText(/a trailing comma/)).toBeTruthy()
    expect(screen.getByText(/rest of the mocks are still being served/)).toBeTruthy()
  })

  it('never lets the endpoint count lie about a failed file', async () => {
    status = { ...status, errors: [{ file: 'laqi/broken.json', message: 'bad' }] }
    await renderApp()
    expect(screen.getByText('2 (+1 file failed)')).toBeTruthy()
  })
})

describe('fresh project', () => {
  it('shows a paste target naming the watched folder', async () => {
    endpoints = []
    status = { ...status, endpointCount: 0 }
    render(<App />)

    const empty = (await screen.findByText('No endpoints loaded')).closest('.empty')!
    // Nombra la carpeta vigilada, no una genérica: es un blanco donde pegar.
    expect(within(empty as HTMLElement).getByText('laqi')).toBeTruthy()
    expect(within(empty as HTMLElement).getByText('Copy example file')).toBeTruthy()
  })
})
