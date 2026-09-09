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

const RECIPE = ['o', [['id', 0, 's']]]

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
  it('exports types from the stored generation recipe', async () => {
    // The origin is the server's answer, not the panel's guess: only the
    // server knows whether the stored recipe was usable.
    getTypes.mockResolvedValue({
      code: 'interface Derived { id: string }',
      language: 'TypeScript',
      origin: 'recipe',
    })
    renderPanel({ status: 200, generatedFrom: { typeName: 'Invoice', recipe: RECIPE } })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))
    expect(screen.getByText(/exported from Laqi’s Invoice generation recipe/)).toBeTruthy()
  })

  it('asks the server to print the recipe in the selected language', async () => {
    renderPanel({ status: 200, generatedFrom: { typeName: 'Invoice', recipe: RECIPE } })

    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))
    expect(getTypes).toHaveBeenCalledWith('GET /invoices', {
      response: 'ok',
      lang: 'typescript',
    })
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

  it('exports a recipe to another language without a TypeScript fallback', async () => {
    getTypes.mockResolvedValue({
      code: 'interface Derived { id: string }',
      language: 'TypeScript',
      origin: 'recipe',
    })
    renderPanel({ status: 200, generatedFrom: { typeName: 'Invoice', recipe: RECIPE } })
    await waitFor(() => expect(screen.getByLabelText('types').textContent).toContain('Derived'))

    const select = screen.getByLabelText('types language') as HTMLSelectElement
    await waitFor(() => expect(select.options).toHaveLength(2))
    select.value = 'go'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() =>
      expect(getTypes).toHaveBeenCalledWith('GET /invoices', { response: 'ok', lang: 'go' }),
    )
    expect(await screen.findByText(/generation recipe/)).toBeTruthy()
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
