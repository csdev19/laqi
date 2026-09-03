/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Endpoint } from '../types'
import { EndpointDetail } from './EndpointDetail'

const { getLanguages, getTypes, generateData } = vi.hoisted(() => ({
  getLanguages: vi.fn(),
  getTypes: vi.fn(),
  generateData: vi.fn(),
}))

vi.mock('../api', () => ({
  api: { getLanguages, getTypes, generateData },
}))

beforeEach(() => {
  getLanguages.mockResolvedValue([
    { name: 'typescript', displayName: 'TypeScript' },
    { name: 'typescript-zod', displayName: 'TypeScript + Zod' },
  ])
  getTypes.mockResolvedValue({
    code: 'export interface Users { id: number }',
    language: 'typescript',
  })
  generateData.mockResolvedValue({ preview: { id: 99, name: 'Fresh' }, warnings: [] })
})

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
  return {
    ...props,
    rerender: (next: Endpoint) => view.rerender(<EndpointDetail {...props} endpoint={next} />),
  }
}

const body = () => screen.getByLabelText('response body') as HTMLTextAreaElement

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the draft survives an unrelated reload', () => {
  it('keeps what you were typing when the endpoint object is replaced but unchanged', () => {
    // App.refresh() re-parses the server's JSON, so it returns new objects
    // even when nothing changed. Any unrelated reload — the watcher, an
    // agent via MCP, another tab saving — used to go through here and wipe
    // out what you were typing, with no warning.
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

    rerender(
      endpoint({ responses: { ok: { status: 200, body: { theirs: 2 } }, boom: { status: 500 } } }),
    )

    await waitFor(() => expect(body().value).toContain('theirs'))
  })

  it('resets when switching to a different endpoint entirely', async () => {
    const { rerender } = renderDetail(endpoint())
    fireEvent.change(body(), { target: { value: '{"mine": 1}' } })

    rerender(
      endpoint({
        id: 'GET /orders',
        path: '/orders',
        responses: { ok: { status: 200, body: {} } },
        default: 'ok',
      }),
    )

    await waitFor(() => expect(body().value).not.toContain('mine'))
  })
})

describe('serving a response', () => {
  it('shows a primary "Serve this" action for a response that is not live, and calls onFlip', () => {
    const { onFlip } = renderDetail(endpoint())

    // `ok` is the default and starts live, so switch to `boom` first.
    fireEvent.click(screen.getByRole('button', { name: /boom/i }))
    const serve = screen.getByRole('button', { name: 'Serve this' })
    fireEvent.click(serve)

    expect(onFlip).toHaveBeenCalledWith(expect.objectContaining({ id: 'GET /users' }), 'boom')
  })

  it('renders the live response as a Serving state pill instead of a clickable button', () => {
    renderDetail(endpoint())

    // `ok` is the default, so it starts live/selected.
    expect(screen.getByText('Serving')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /serve this/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^live now$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^set live$/i })).toBeNull()
  })
})

describe('renaming a response (no window.prompt)', () => {
  it('opens a dialog pre-filled with the current name, focused, instead of window.prompt', () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    renderDetail(endpoint())

    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }))

    const input = screen.getByLabelText('new name') as HTMLInputElement
    expect(input.value).toBe('ok')
    expect(document.activeElement).toBe(input)
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it('renames the response and selects it on confirm', () => {
    renderDetail(endpoint())

    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }))
    const input = screen.getByLabelText('new name')
    fireEvent.change(input, { target: { value: 'success' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^rename$/i }))

    expect(screen.queryByLabelText('new name')).toBeNull()
    expect(screen.getByText('success')).toBeTruthy()
  })

  it('confirms on Enter from the input', () => {
    renderDetail(endpoint())

    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }))
    const input = screen.getByLabelText('new name')
    fireEvent.change(input, { target: { value: 'success' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(screen.queryByLabelText('new name')).toBeNull()
    expect(screen.getByText('success')).toBeTruthy()
  })

  it('closes on Escape without renaming, and returns focus to the Rename trigger', () => {
    renderDetail(endpoint())

    const trigger = screen.getByRole('button', { name: /^rename$/i })
    // A real click focuses a button; jsdom's fireEvent.click does not, so
    // this is done explicitly to reproduce what the browser does on its own.
    trigger.focus()
    fireEvent.click(trigger)
    const input = screen.getByLabelText('new name')
    fireEvent.change(input, { target: { value: 'should-not-apply' } })
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })

    expect(screen.queryByLabelText('new name')).toBeNull()
    expect(screen.queryByText('should-not-apply')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('cancels on a click on the overlay but not on a click inside the card', () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }))

    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(screen.getByLabelText('new name')).toBeTruthy()

    const backdrop = document.querySelector('.dialog-backdrop')!
    fireEvent.mouseDown(backdrop)
    expect(screen.queryByLabelText('new name')).toBeNull()
  })

  it('disables confirm for an empty name, the unchanged name, or a name already in use', () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }))
    const input = screen.getByLabelText('new name')
    const confirm = () =>
      within(screen.getByRole('dialog')).getByRole('button', { name: /^rename$/i })

    fireEvent.change(input, { target: { value: '' } })
    expect(confirm().hasAttribute('disabled')).toBe(true)

    fireEvent.change(input, { target: { value: 'ok' } })
    expect(confirm().hasAttribute('disabled')).toBe(true)

    fireEvent.change(input, { target: { value: 'boom' } })
    expect(confirm().hasAttribute('disabled')).toBe(true)

    fireEvent.change(input, { target: { value: 'success' } })
    expect(confirm().hasAttribute('disabled')).toBe(false)
  })

  it('traps Tab focus inside the dialog', () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /^rename$/i }))

    const dialog = screen.getByRole('dialog')
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('input, button:not([disabled])'),
    )
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!

    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})

describe('generated types and data', () => {
  it('copies the types for the selected language', async () => {
    renderDetail(endpoint())
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    fireEvent.click(await screen.findByRole('button', { name: /copy types/i }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('interface')),
    )
  })

  it('regenerate fills the body draft with the preview and lets Save do the writing', async () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await waitFor(() => expect(body().value).toContain('"Fresh"'))
    // No write happened: regenerate only edits the draft. Saving is the
    // existing Save button — zero new write paths, verbatim from the spec.
    expect(screen.getByRole('button', { name: 'Save to file' }).hasAttribute('disabled')).toBe(
      false,
    )
  })

  it('discards a Regenerate response that resolves after the endpoint reloaded underneath it', async () => {
    let resolveGenerate!: (value: { preview: unknown; warnings: string[] }) => void
    generateData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGenerate = resolve
        }),
    )
    const original = endpoint()
    const { rerender } = renderDetail(original)

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    await waitFor(() => expect(generateData).toHaveBeenCalled())

    // The watcher reloads with fresh data while the Regenerate promise is
    // still pending: the reload has to win.
    const reloaded = endpoint({
      responses: { ok: { status: 200, body: { theirs: 2 } }, boom: { status: 500 } },
    })
    rerender(reloaded)
    await waitFor(() => expect(body().value).toContain('theirs'))

    resolveGenerate({ preview: { id: 99, name: 'Fresh' }, warnings: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(body().value).toContain('theirs')
    expect(body().value).not.toContain('Fresh')
  })

  it('shows an error when Regenerate fails, instead of dying silently', async () => {
    generateData.mockRejectedValueOnce(new Error('the generator crashed'))
    renderDetail(endpoint())

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(await screen.findByText(/the generator crashed/)).toBeTruthy()
  })

  it('shows an error when Copy types fails, instead of an unhandled rejection', async () => {
    getTypes.mockRejectedValueOnce(new Error('types generation crashed'))
    renderDetail(endpoint())

    fireEvent.click(screen.getByRole('button', { name: /copy types/i }))

    expect(await screen.findByText(/types generation crashed/)).toBeTruthy()
  })

  it('renders generation warnings from Regenerate', async () => {
    generateData.mockResolvedValueOnce({
      preview: { id: 99, name: 'Fresh' },
      warnings: ['dropped an index signature on Users'],
    })
    renderDetail(endpoint())

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(await screen.findByText(/dropped an index signature/)).toBeTruthy()
  })

  it('shows no warning region when Regenerate returns no warnings', async () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await waitFor(() => expect(body().value).toContain('"Fresh"'))
    expect(screen.queryByRole('status', { name: /warning/i })).toBeNull()
  })
})

describe('the response scaffold', () => {
  it('offers the siblings an item GET is missing, named', () => {
    renderDetail(
      endpoint({ id: 'GET /orders/:id', path: '/orders/:id', responses: { ok: { status: 200 } } }),
    )
    expect(screen.getByRole('button', { name: /add not-found, error/ })).toBeTruthy()
  })

  it('adds them to the draft without touching what is there', () => {
    const { onSave } = renderDetail(
      endpoint({
        id: 'GET /orders/:id',
        path: '/orders/:id',
        responses: { ok: { status: 200, body: { mine: true } } },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /add not-found, error/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }))

    const [, definition] = onSave.mock.calls[0]!
    expect(Object.keys(definition.responses)).toEqual(['ok', 'not-found', 'error'])
    expect(definition.responses.ok!.body).toEqual({ mine: true })
    expect(definition.responses['not-found']!.status).toBe(404)
  })

  it('does not appear once the family is complete', () => {
    renderDetail(
      endpoint({
        id: 'DELETE /orders/:id',
        method: 'DELETE',
        path: '/orders/:id',
        default: 'deleted',
        responses: { deleted: { status: 204 }, 'not-found': { status: 404 } },
      }),
    )
    expect(screen.queryByRole('button', { name: /^\+ add / })).toBeNull()
  })

  it('does not appear for a method it has no opinion about', () => {
    renderDetail(
      endpoint({
        id: 'OPTIONS /orders',
        method: 'OPTIONS',
        path: '/orders',
        default: 'ok',
        responses: { ok: { status: 204 } },
      }),
    )
    expect(screen.queryByRole('button', { name: /^\+ add / })).toBeNull()
  })

  it('leaves the default response alone', () => {
    // The scaffold adds alternatives. Silently repointing `default` at a 404
    // would change what the server serves right now.
    const { onSave } = renderDetail(
      endpoint({ id: 'GET /orders/:id', path: '/orders/:id', responses: { ok: { status: 200 } } }),
    )
    fireEvent.click(screen.getByRole('button', { name: /add not-found, error/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }))
    expect(onSave.mock.calls[0]![1].default).toBe('ok')
  })

  it('scaffolds a 204 with no body at all', () => {
    const { onSave } = renderDetail(
      endpoint({
        id: 'DELETE /orders/:id',
        method: 'DELETE',
        path: '/orders/:id',
        default: 'deleted',
        responses: { 'not-found': { status: 404 } },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /add deleted/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }))

    const deleted = onSave.mock.calls[0]![1].responses.deleted!
    expect(deleted.status).toBe(204)
    expect(Object.hasOwn(deleted, 'body')).toBe(false)
  })
})
