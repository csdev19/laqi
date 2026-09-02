/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aState, anEndpoint, noScenarios } from '../test-fixtures'
import type { Endpoint } from '../types'
import { EndpointRow } from './EndpointRow'

// The most-clicked element in the product: every response is a chip, one
// click each, and the row has to answer "what did I change?" without one.

afterEach(cleanup)

function renderRow(props: Partial<Parameters<typeof EndpointRow>[0]> = {}) {
  const onFlip = vi.fn()
  const onOpen = vi.fn()
  render(
    <EndpointRow
      endpoint={anEndpoint()}
      state={aState()}
      scenarios={noScenarios}
      showDescription
      onFlip={onFlip}
      onOpen={onOpen}
      {...props}
    />,
  )
  return { onFlip, onOpen }
}

const chip = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('EndpointRow', () => {
  it('draws one chip per declared response, with its status', () => {
    renderRow()

    expect(chip('ok').textContent).toContain('200')
    expect(chip('empty').textContent).toContain('200')
    expect(chip('error').textContent).toContain('500')
  })

  it('marks exactly the live response as pressed', () => {
    renderRow()

    expect(chip('ok').getAttribute('aria-pressed')).toBe('true')
    expect(chip('empty').getAttribute('aria-pressed')).toBe('false')
  })

  it('reports the endpoint and the response name when a chip is clicked', () => {
    const endpoint = anEndpoint()
    const { onFlip } = renderRow({ endpoint })

    fireEvent.click(chip('error'))

    expect(onFlip).toHaveBeenCalledWith(endpoint, 'error')
  })

  it('opens the detail view from the path, not from a chip', () => {
    const { onOpen, onFlip } = renderRow()

    fireEvent.click(screen.getByRole('button', { name: '/todos' }))

    expect(onOpen).toHaveBeenCalledWith('GET /todos')
    expect(onFlip).not.toHaveBeenCalled()
  })

  // The layer tag is the row's answer to "why is this the live response?".
  // Getting it wrong sends people hunting through files for an override the
  // panel itself set.
  it('names the layer that decided the live response', () => {
    const { rerender } = renderChangeable()

    expect(screen.getByText('default')).toBeTruthy()

    rerender(aState({ overrides: { 'GET /todos': 'error' } }), noScenarios)
    expect(screen.getByText('state')).toBeTruthy()
    expect(chip('error').getAttribute('aria-pressed')).toBe('true')

    rerender(aState({ scenario: 'offline' }), { offline: { 'GET /todos': 'empty' } })
    expect(screen.getByText('scenario')).toBeTruthy()
    expect(chip('empty').getAttribute('aria-pressed')).toBe('true')
  })

  it('hides the description when the pane is too narrow for it', () => {
    const endpoint: Endpoint = anEndpoint({ description: 'A page of todos' })
    renderRow({ endpoint, showDescription: false })

    expect(screen.queryByText('A page of todos')).toBeNull()
  })
})

/** A row whose state and scenarios can be swapped without remounting. */
function renderChangeable() {
  const endpoint = anEndpoint()
  const view = render(
    <EndpointRow
      endpoint={endpoint}
      state={aState()}
      scenarios={noScenarios}
      showDescription
      onFlip={() => {}}
      onOpen={() => {}}
    />,
  )
  return {
    rerender: (
      state: ReturnType<typeof aState>,
      scenarios: Record<string, Record<string, string>>,
    ) =>
      view.rerender(
        <EndpointRow
          endpoint={endpoint}
          state={state}
          scenarios={scenarios}
          showDescription
          onFlip={() => {}}
          onOpen={() => {}}
        />,
      ),
  }
}
