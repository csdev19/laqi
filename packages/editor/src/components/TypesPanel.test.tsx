/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { TypesPanel } from './TypesPanel'

// The panel exists so nobody has to paste into an editor to find out what a
// response's shape is. Which of the two sources it is showing has to be on
// screen: one is what the developer wrote, the other is a guess made from a
// single sample.

vi.mock('../api', () => ({
  api: { getTypes: vi.fn(), getLanguages: vi.fn() },
}))

const getTypes = vi.mocked(api.getTypes)
const getLanguages = vi.mocked(api.getLanguages)

const MODEL = 'export interface Invoice {\n  id: string\n  status: "paid" | "void"\n}\n'

beforeEach(() => {
  getTypes.mockResolvedValue({ code: 'interface Derived { id: string }', language: 'TypeScript' })
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

describe('TypesPanel', () => {
  it('shows the stored model, whole, when the body was generated from one', async () => {
    renderPanel({ status: 200, generatedFrom: { typeName: 'Invoice', model: MODEL } })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain(MODEL.trim()))
    expect(screen.getByText(/the Invoice model this body was generated from/)).toBeTruthy()
  })

  // Reading a model that is already in hand costs nothing; asking the server
  // to guess one from the body would be a round trip nobody reads.
  it('does not ask the server for types it already has', async () => {
    renderPanel({ status: 200, generatedFrom: { typeName: 'Invoice', model: MODEL } })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Invoice'))
    expect(getTypes).not.toHaveBeenCalled()
  })

  it('derives from the body when there is no model behind it', async () => {
    renderPanel({ status: 200, body: { id: 'x' } })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))
    expect(getTypes).toHaveBeenCalledWith('GET /invoices', {
      response: 'ok',
      lang: 'typescript',
    })
    expect(screen.getByText('derived from the body')).toBeTruthy()
  })

  // The stored model can only be TypeScript, so asking for Go is asking for
  // the derived form, and the panel says so rather than showing nothing.
  it('falls back to derived types when another language is asked for', async () => {
    renderPanel({ status: 200, generatedFrom: { typeName: 'Invoice', model: MODEL } })
    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Invoice'))

    const select = screen.getByLabelText('types language') as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(2))
    select.value = 'go'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() =>
      expect(getTypes).toHaveBeenCalledWith('GET /invoices', { response: 'ok', lang: 'go' }),
    )
    expect(await screen.findByText(/the stored model is TypeScript/)).toBeTruthy()
  })

  it('reports a failure to derive rather than showing an empty panel', async () => {
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
