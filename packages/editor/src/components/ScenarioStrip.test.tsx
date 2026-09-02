/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scenarios } from '../types'
import { ScenarioStrip } from './ScenarioStrip'

// Activating a scenario is the move the product is demonstrated with: one
// click moves several endpoints at once. The rule that makes it safe to try
// is that the same click undoes it.

afterEach(cleanup)

const scenarios: Scenarios = {
  offline: { 'GET /todos': 'error', 'POST /todos': 'error' },
  'empty-state': { 'GET /todos': 'empty' },
}

function renderStrip(props: Partial<Parameters<typeof ScenarioStrip>[0]> = {}) {
  const onActivate = vi.fn()
  const onReset = vi.fn()
  render(
    <ScenarioStrip
      scenarios={scenarios}
      active={null}
      dirty={false}
      onActivate={onActivate}
      onReset={onReset}
      {...props}
    />,
  )
  return { onActivate, onReset }
}

describe('ScenarioStrip', () => {
  it('shows every declared scenario with how many endpoints it moves', () => {
    renderStrip()

    expect(screen.getByRole('button', { name: /^offline/ }).textContent).toContain('2')
    expect(screen.getByRole('button', { name: /^empty-state/ }).textContent).toContain('1')
  })

  it('activates the scenario that was clicked', () => {
    const { onActivate } = renderStrip()

    fireEvent.click(screen.getByRole('button', { name: /^offline/ }))

    expect(onActivate).toHaveBeenCalledWith('offline')
  })

  // Every destructive action stays one click from reverting: clicking the
  // active scenario deactivates it rather than re-applying it.
  it('deactivates when the active scenario is clicked again', () => {
    const { onActivate } = renderStrip({ active: 'offline' })

    fireEvent.click(screen.getByRole('button', { name: /^offline/ }))

    expect(onActivate).toHaveBeenCalledWith(null)
  })

  it('marks the active scenario as pressed', () => {
    renderStrip({ active: 'offline' })

    expect(screen.getByRole('button', { name: /^offline/ }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: /^empty-state/ }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  // An empty strip must say why it is empty; a bare row reads as broken.
  it('explains itself when no scenarios are declared', () => {
    renderStrip({ scenarios: {} })

    expect(screen.getByText(/none declared/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // Reset is drawn only when there is something to reset, so its presence
  // is itself the signal that the API is off its file defaults.
  it('offers a reset only while something is overridden', () => {
    const { onReset } = renderStrip({ dirty: true })

    const reset = screen.getByRole('button', { name: /Reset all to default/ })
    fireEvent.click(reset)

    expect(onReset).toHaveBeenCalledOnce()
  })

  it('hides the reset when nothing is overridden', () => {
    renderStrip({ dirty: false })

    expect(screen.queryByRole('button', { name: /Reset all to default/ })).toBeNull()
  })
})
