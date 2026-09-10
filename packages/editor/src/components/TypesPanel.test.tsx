/** @vitest-environment jsdom */
import type { SchemaSnapshot } from '@laqi/schema'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { TypesPanel } from './TypesPanel'

// The panel exists so nobody has to paste into an editor to find out what a
// response's shape is. Which of the two sources it is showing has to be on
// screen: one states what the response may contain, the other is a guess made
// from a single sample.

vi.mock('../api', () => ({
  api: { getTypes: vi.fn(), getLanguages: vi.fn() },
}))

const getTypes = vi.mocked(api.getTypes)
const getLanguages = vi.mocked(api.getLanguages)

const SCHEMA: SchemaSnapshot = {
  name: 'Invoice',
  source: { kind: 'typescript-paste' },
  diagnostics: [],
  document: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
}

beforeEach(() => {
  getTypes.mockResolvedValue({
    code: 'interface Derived { id: string }',
    language: 'TypeScript',
    origin: 'body',
    typeName: 'Derived',
  })
  getLanguages.mockResolvedValue([
    { name: 'typescript', displayName: 'TypeScript' },
    { name: 'go', displayName: 'Go' },
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPanel(response: Parameters<typeof TypesPanel>[0]['response']) {
  render(
    <TypesPanel endpointId="GET /invoices" responseName="ok" response={response} revision="1" />,
  )
}

/** The server decides the origin: only it knows whether the schema was usable. */
function serverSays(origin: 'schema' | 'body', diagnostics?: SchemaSnapshot['diagnostics']) {
  getTypes.mockResolvedValue({
    code: 'interface Derived { id: string }',
    language: 'TypeScript',
    typeName: 'Derived',
    origin,
    ...(diagnostics ? { diagnostics } : {}),
  })
}

describe('TypesPanel', () => {
  it('names the schema the types were exported from', async () => {
    serverSays('schema')
    renderPanel({ status: 200, schema: SCHEMA })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))
    expect(screen.getByText(/exported from the Invoice schema/)).toBeTruthy()
  })

  it('says the response carries no schema when the types came from the body', async () => {
    renderPanel({ status: 200, body: { id: 'x' } })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))
    expect(getTypes).toHaveBeenCalledWith('GET /invoices', {
      response: 'ok',
      lang: 'typescript',
    })
    expect(screen.getByText(/carries no schema/)).toBeTruthy()
  })

  it('asks the server to print in the selected language, schema or not', async () => {
    serverSays('schema')
    renderPanel({ status: 200, schema: SCHEMA })
    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))

    const select = screen.getByLabelText('types language') as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(2))
    select.value = 'go'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() =>
      expect(getTypes).toHaveBeenCalledWith('GET /invoices', { response: 'ok', lang: 'go' }),
    )
    expect(await screen.findByText(/exported from the Invoice schema/)).toBeTruthy()
  })

  // Copying types without seeing this would be copying a claim laqi already
  // knows is incomplete.
  it('shows what the schema had to approximate, beside the types', async () => {
    serverSays('schema', [
      {
        code: 'loss.union-narrowed',
        kind: 'loss',
        severity: 'warning',
        pointer: '/properties/total',
        message: 'Invoice.total: mixed union — narrowed to number',
      },
    ])
    renderPanel({ status: 200, schema: SCHEMA })

    expect(await screen.findByText(/approximated: .*narrowed to number/)).toBeTruthy()
  })

  it('reports a failure to print rather than showing an empty panel', async () => {
    getTypes.mockRejectedValue(new Error('quicktype fell over'))
    renderPanel({ status: 200, body: {} })

    expect(await screen.findByText(/quicktype fell over/)).toBeTruthy()
  })

  it('keeps working when the language list cannot be fetched', async () => {
    getLanguages.mockRejectedValue(new Error('offline'))
    renderPanel({ status: 200, body: {} })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))
    expect((screen.getByLabelText('types language') as HTMLSelectElement).options).toHaveLength(1)
  })
})

describe('finding the way out of having no schema', () => {
  it('points at Build model when the types came from the body', async () => {
    serverSays('body')
    renderPanel({ status: 200, body: { id: 'x' } })

    expect(await screen.findByText(/Build model, above/)).toBeTruthy()
  })

  it('says nothing about it once the response carries a schema', async () => {
    serverSays('schema')
    renderPanel({ status: 200, schema: SCHEMA })

    await screen.findByText(/exported from the/)
    expect(screen.queryByText(/Build model, above/)).toBeNull()
  })
})
