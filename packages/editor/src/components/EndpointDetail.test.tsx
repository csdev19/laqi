/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Endpoint } from '../types'
import { EndpointDetail } from './EndpointDetail'

const {
  getLanguages,
  getTypes,
  generateData,
  regenerateResponse,
  applyGeneratedBody,
  refreshSchema,
  getResponseRevision,
  importSchema,
  setResponseSchema,
  draftModel,
  TestApiError,
} = vi.hoisted(() => ({
  getLanguages: vi.fn(),
  getTypes: vi.fn(),
  generateData: vi.fn(),
  regenerateResponse: vi.fn(),
  applyGeneratedBody: vi.fn(),
  refreshSchema: vi.fn(),
  getResponseRevision: vi.fn(),
  importSchema: vi.fn(),
  setResponseSchema: vi.fn(),
  draftModel: vi.fn(),
  // Declared here because vi.mock is hoisted: a top-level class would not
  // exist yet when the factory runs. The component narrows with
  // `instanceof`, so the mock has to hand back the same constructor.
  TestApiError: class TestApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly diagnostics?: unknown,
      readonly conflict?: { reason: string; revision: string },
    ) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))

vi.mock('../api', () => ({
  ApiError: TestApiError,
  api: {
    getLanguages,
    getTypes,
    generateData,
    regenerateResponse,
    applyGeneratedBody,
    refreshSchema,
    getResponseRevision,
    importSchema,
    setResponseSchema,
    draftModel,
  },
}))

beforeEach(() => {
  // Call counts accumulated across tests before this: a test asserting "called
  // twice" was really asserting the sum of every click in the file above it.
  vi.clearAllMocks()
  getLanguages.mockResolvedValue([
    { name: 'typescript', displayName: 'TypeScript' },
    { name: 'typescript-zod', displayName: 'TypeScript + Zod' },
  ])
  getTypes.mockResolvedValue({
    code: 'export interface Users { id: number }',
    language: 'typescript',
    origin: 'body',
    typeName: 'Users',
  })
  generateData.mockResolvedValue({ preview: { id: 99, name: 'Fresh' }, warnings: [] })
  regenerateResponse.mockResolvedValue({
    body: { id: 99, name: 'Fresh' },
    evidence: { seed: 1, options: { arrayLength: 3 }, bodyHash: 'a'.repeat(64) },
    diagnostics: [],
    revision: 'rev-1',
  })
  applyGeneratedBody.mockResolvedValue({ revision: 'rev-2' })
  refreshSchema.mockResolvedValue({ snapshot: {}, revision: 'rev-2' })
  getResponseRevision.mockResolvedValue({ revision: 'rev-1' })
  importSchema.mockResolvedValue({
    snapshot: {
      name: 'Users',
      document: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
      source: { kind: 'typescript-paste' },
      diagnostics: [],
    },
    candidates: ['Users'],
  })
  setResponseSchema.mockResolvedValue({ revision: 'rev-2' })
  draftModel.mockResolvedValue({
    source: 'export interface Users { id: number }',
    typeName: 'Users',
  })
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
  it('keeps draft actions local until save and reload make the response available', async () => {
    const original = endpoint({
      id: 'GET /orders/:id',
      path: '/orders/:id',
      responses: { ok: { status: 200 } },
    })
    const { onSave, onFlip, rerender } = renderDetail(original)
    fireEvent.click(screen.getByRole('button', { name: /add not-found, error/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(regenerateResponse).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Serve this' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save to file' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    // A save request alone is not evidence the write succeeded.
    expect(screen.queryByRole('button', { name: 'Serve this' })).toBeNull()
    const [id, definition] = onSave.mock.calls[0]!
    expect(id).toBe(original.id)
    rerender({ ...original, ...definition })
    fireEvent.click(await screen.findByRole('button', { name: 'Serve this' }))
    expect(onFlip).toHaveBeenCalledWith(expect.objectContaining({ id: original.id }), 'not-found')
  })

  it('shows a primary "Serve this" action for a response that is not live, and calls onFlip', () => {
    const { onFlip } = renderDetail(endpoint())

    // `ok` is the default and starts live, so switch to `boom` first.
    fireEvent.click(screen.getByRole('button', { name: /boom/i }))
    const serve = screen.getByRole('button', { name: 'Serve this' })
    fireEvent.click(serve)

    expect(onFlip).toHaveBeenCalledWith(expect.objectContaining({ id: 'GET /users' }), 'boom')
  })

  it('does not offer "Serve this" for a response that only exists in the draft', () => {
    // Serving goes through PUT /api/state, and the server only knows what
    // is on disk. Offering the button for an unsaved response produced a
    // "not declared on GET /x. Available: ok" band that said nothing about
    // the fix: save first.
    const { onFlip } = renderDetail(
      endpoint({ id: 'GET /orders/:id', path: '/orders/:id', responses: { ok: { status: 200 } } }),
    )
    fireEvent.click(screen.getByRole('button', { name: /add not-found, error/ }))

    expect(screen.queryByRole('button', { name: 'Serve this' })).toBeNull()
    expect(screen.getByText(/save to file/i, { selector: '.serve-note' }).textContent).toMatch(
      /"not-found" is not on disk yet/,
    )
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('keeps the live response visible when editing a different response', () => {
    renderDetail(endpoint())

    // `ok` is the default. Live is an execution state, not the editor
    // selection, so it stays visible after selecting another response.
    const live = screen.getByRole('button', { name: 'ok, live via default' })
    expect(live.getAttribute('aria-current')).toBe('true')
    expect(live.textContent).toContain('Live · default')
    expect(screen.getByLabelText('Live response: ok, via default')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'boom' }))

    expect(
      screen.getByRole('button', { name: 'ok, live via default' }).getAttribute('aria-current'),
    ).toBe('true')
    expect(screen.getByRole('button', { name: 'boom' }).className).toContain('is-selected')
    expect(screen.getByRole('button', { name: 'Serve this' })).toBeTruthy()
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

  // The editor keeps showing what is on disk, because that is what the
  // person is being asked to replace. Putting the preview there used to
  // make the "overwrite?" question unanswerable.
  it('regenerate opens the comparison and leaves the body on disk on screen', async () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await screen.findByRole('dialog')
    expect(body().value).not.toContain('"Fresh"')
    expect(applyGeneratedBody).not.toHaveBeenCalled()
  })

  it('shows both sides, so the decision can be made by looking', async () => {
    renderDetail(
      endpoint({ responses: { ok: { status: 200, body: { mine: 1 } }, boom: { status: 500 } } }),
    )
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await screen.findByRole('dialog')
    expect(screen.getByLabelText('body on disk').textContent).toContain('"mine"')
    expect(screen.getByLabelText('generated body').textContent).toContain('"Fresh"')
  })

  it('applies with the evidence and the revision it was generated against', async () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(applyGeneratedBody).toHaveBeenCalled())
    const [id, response, input] = applyGeneratedBody.mock.calls[0]!
    expect(id).toBe('GET /users')
    expect(response).toBe('ok')
    expect(input.revision).toBe('rev-1')
    expect(input.evidence).toMatchObject({ seed: 1 })
    expect(input.confirm).toBeUndefined()
  })

  it('opens nothing until something has been regenerated', () => {
    renderDetail(endpoint())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('writes nothing when the comparison is cancelled', async () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(applyGeneratedBody).not.toHaveBeenCalled()
  })

  it('answers a refused write inside the comparison, against the current revision', async () => {
    applyGeneratedBody.mockRejectedValueOnce(
      new TestApiError('the body on disk has changed since laqi wrote it', 409, undefined, {
        reason: 'body-modified',
        revision: 'rev-current',
      }),
    )
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    expect(await screen.findByText(/has changed since laqi wrote it/)).toBeTruthy()
    // Both sides are still on screen: that is what makes the refusal answerable.
    expect(screen.getByLabelText('body on disk')).toBeTruthy()
    expect(screen.getByLabelText('generated body')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /overwrite anyway/i }))

    await waitFor(() => expect(applyGeneratedBody).toHaveBeenCalledTimes(2))
    const [, , retry] = applyGeneratedBody.mock.calls[1]!
    expect(retry.confirm).toBe(true)
    // The retry is against what is on disk NOW, not what the preview saw.
    expect(retry.revision).toBe('rev-current')
  })

  it('discards a Regenerate response that resolves after the endpoint reloaded underneath it', async () => {
    let resolveGenerate!: (value: {
      body: unknown
      evidence: unknown
      diagnostics: unknown[]
      revision: string
    }) => void
    regenerateResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGenerate = resolve
        }),
    )
    const original = endpoint()
    const { rerender } = renderDetail(original)

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    await waitFor(() => expect(regenerateResponse).toHaveBeenCalled())

    // The watcher reloads with fresh data while the Regenerate promise is
    // still pending: the reload has to win.
    const reloaded = endpoint({
      responses: { ok: { status: 200, body: { theirs: 2 } }, boom: { status: 500 } },
    })
    rerender(reloaded)
    await waitFor(() => expect(body().value).toContain('theirs'))

    resolveGenerate({
      body: { id: 99, name: 'Fresh' },
      evidence: {},
      diagnostics: [],
      revision: 'rev-1',
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(body().value).toContain('theirs')
    expect(body().value).not.toContain('Fresh')
    // And no comparison opened: that preview was about the old file.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows an error when Regenerate fails, instead of dying silently', async () => {
    regenerateResponse.mockRejectedValueOnce(new Error('the generator crashed'))
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

  it('shows what generation approximated, in the comparison', async () => {
    regenerateResponse.mockResolvedValueOnce({
      body: { id: 99, name: 'Fresh' },
      evidence: {},
      diagnostics: [
        {
          code: 'loss.index-signature',
          kind: 'loss',
          severity: 'warning',
          message: 'dropped an index signature on Users',
          pointer: '',
        },
      ],
      revision: 'rev-1',
    })
    renderDetail(endpoint())

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(await screen.findByText(/dropped an index signature/)).toBeTruthy()
  })

  it('shows no warning region when generation had nothing to report', async () => {
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))

    await screen.findByRole('dialog')
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

describe('building a model from a body that has no schema', () => {
  /** The response laqi refuses to regenerate: a body, and nothing that says what it is. */
  const noSchema = () =>
    endpoint({ responses: { ok: { status: 200, body: { id: 1 } }, boom: { status: 500 } } })

  const withSchema = () =>
    endpoint({
      responses: {
        ok: {
          status: 200,
          body: { id: 1 },
          schema: {
            name: 'Users',
            document: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
            source: { kind: 'typescript-paste' },
            diagnostics: [],
          },
        },
        boom: { status: 500 },
      },
    })

  it('offers Build model when there is no schema to regenerate from', () => {
    renderDetail(noSchema())
    expect(screen.getByRole('button', { name: /build model/i })).toBeTruthy()
  })

  // A schema can be stale — built from an older body, or by an older laqi —
  // and the body is still the sample. Rebuilding replaces it, through the
  // same revision-checked write as everything else.
  it('offers to rebuild once the response has a schema, and says it replaces it', async () => {
    renderDetail(withSchema())
    fireEvent.click(screen.getByRole('button', { name: /rebuild model from body/i }))

    await waitFor(() => expect(screen.getByLabelText('model')).toBeTruthy())
    expect(screen.getByText(/replaces the schema this response has/i)).toBeTruthy()
  })

  it('drafts the model from the body and writes nothing yet', async () => {
    renderDetail(noSchema())

    fireEvent.click(screen.getByRole('button', { name: /build model/i }))

    await waitFor(() => expect(screen.getByLabelText('model')).toBeTruthy())
    expect((screen.getByLabelText('model') as HTMLTextAreaElement).value).toContain(
      'interface Users',
    )
    expect(setResponseSchema).not.toHaveBeenCalled()
  })

  // Inference reads one sample. Saying so where the person can act on it is
  // the whole difference between this and guessing silently.
  it('names the two things one sample cannot show', async () => {
    renderDetail(noSchema())
    fireEvent.click(screen.getByRole('button', { name: /build model/i }))

    await waitFor(() => expect(screen.getByLabelText('model')).toBeTruthy())
    expect(screen.getByText(/literal union reads as string/i)).toBeTruthy()
    expect(screen.getByText(/fixed tuple as a list/i)).toBeTruthy()
  })

  it('stores what is on screen, edits included, as an ordinary model', async () => {
    renderDetail(noSchema())
    fireEvent.click(screen.getByRole('button', { name: /build model/i }))
    await waitFor(() => expect(screen.getByLabelText('model')).toBeTruthy())

    // The person fixes what inference could not know.
    fireEvent.change(screen.getByLabelText('model'), {
      target: { value: "export interface Users { status: 'draft' | 'paid' }" },
    })
    fireEvent.click(screen.getByRole('button', { name: /save as schema/i }))

    await waitFor(() => expect(setResponseSchema).toHaveBeenCalled())
    expect(importSchema).toHaveBeenCalledWith({
      kind: 'typescript-paste',
      source: "export interface Users { status: 'draft' | 'paid' }",
      typeName: 'Users',
    })
    const [id, response, input] = setResponseSchema.mock.calls[0]!
    expect(id).toBe('GET /users')
    expect(response).toBe('ok')
    expect(input.revision).toBe('rev-1')
  })

  it('leaves the body alone: this writes a schema, not data', async () => {
    renderDetail(noSchema())
    fireEvent.click(screen.getByRole('button', { name: /build model/i }))
    await waitFor(() => expect(screen.getByLabelText('model')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /save as schema/i }))

    await waitFor(() => expect(setResponseSchema).toHaveBeenCalled())
    expect(applyGeneratedBody).not.toHaveBeenCalled()
  })

  it('drops the draft on Cancel without writing', async () => {
    renderDetail(noSchema())
    fireEvent.click(screen.getByRole('button', { name: /build model/i }))
    await waitFor(() => expect(screen.getByLabelText('model')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByLabelText('model')).toBeNull()
    expect(setResponseSchema).not.toHaveBeenCalled()
  })

  it('shows why a model was refused, instead of failing quietly', async () => {
    importSchema.mockRejectedValueOnce(new Error('no interface or type alias found'))
    renderDetail(noSchema())
    fireEvent.click(screen.getByRole('button', { name: /build model/i }))
    await waitFor(() => expect(screen.getByLabelText('model')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /save as schema/i }))

    expect(await screen.findByText(/no interface or type alias/)).toBeTruthy()
    expect(setResponseSchema).not.toHaveBeenCalled()
  })
})

describe('answering a refused write', () => {
  const refuse = () =>
    applyGeneratedBody.mockRejectedValueOnce(
      new TestApiError('laqi did not write the body on disk', 409, undefined, {
        reason: 'body-unverified',
        revision: 'rev-current',
      }),
    )

  // The refusal is answered where both sides are visible, so "what would I
  // lose" is a question the screen already answers.
  it('keeps the bytes that confirming would replace on screen', async () => {
    refuse()
    renderDetail(
      endpoint({
        responses: { ok: { status: 200, body: { handwritten: 'keep me' } }, boom: { status: 500 } },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    await screen.findByRole('button', { name: /overwrite anyway/i })
    expect(screen.getByLabelText('body on disk').textContent).toContain('keep me')
  })

  // A refusal is a warning the person reads before the bodies, not a
  // subtitle in italics: it names what laqi is about to replace and why it
  // could not decide alone.
  it('presents the refusal as a warning callout with a heading', async () => {
    refuse()
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    const callout = await screen.findByRole('alert')
    expect(callout.textContent).toMatch(/this body was not generated by laqi/i)
    expect(callout.textContent).toMatch(/laqi did not write the body on disk/i)
  })

  it('says the asking stops once laqi has written a body itself', async () => {
    refuse()
    renderDetail(endpoint())
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))

    expect(await screen.findByText(/asks once per response/i)).toBeTruthy()
  })
})
