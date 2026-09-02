/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aState, anEndpoint, noScenarios } from '../test-fixtures'
import { CommandPalette } from './CommandPalette'

// ⌘K is the keyboard path to any endpoint×response pair. It is used without
// looking, so the invariant that matters is that what ↵ acts on is always
// what the list is showing.

afterEach(cleanup)

const todos = anEndpoint()
const orders = anEndpoint({
  id: 'POST /orders',
  method: 'POST',
  path: '/orders',
  default: 'created',
  responses: { created: { status: 201 }, boom: { status: 500 } },
})

function renderPalette(props: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onFlip = vi.fn()
  const onOpen = vi.fn()
  const onClose = vi.fn()
  render(
    <CommandPalette
      endpoints={[todos, orders]}
      state={aState()}
      scenarios={noScenarios}
      onFlip={onFlip}
      onOpen={onOpen}
      onClose={onClose}
      {...props}
    />,
  )
  return { onFlip, onOpen, onClose, input: screen.getByLabelText('command') }
}

const rows = () =>
  screen.queryAllByRole('button').filter((b) => b.className.includes('palette-row'))
const highlighted = () => document.querySelector('.palette-row.is-highlighted')

describe('CommandPalette', () => {
  it('lists one row per endpoint and response pair', () => {
    renderPalette()

    // 3 responses on /todos + 2 on /orders
    expect(rows()).toHaveLength(5)
  })

  it('narrows to the pair described by every typed token, in any order', () => {
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'orders boom' } })

    expect(rows()).toHaveLength(1)
    expect(rows()[0]?.textContent).toContain('/orders')
    expect(rows()[0]?.textContent).toContain('boom')
  })

  it('puts the highlighted response live on Enter and closes', () => {
    const { input, onFlip, onClose } = renderPalette()

    fireEvent.change(input, { target: { value: 'orders boom' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onFlip).toHaveBeenCalledWith(orders, 'boom')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens the detail view instead when Enter is held with the modifier', () => {
    const { input, onOpen, onFlip } = renderPalette()

    fireEvent.change(input, { target: { value: 'orders boom' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })

    expect(onOpen).toHaveBeenCalledWith('POST /orders')
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('moves the highlight with the arrow keys and stops at both ends', () => {
    const { input } = renderPalette()

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(highlighted()?.textContent).toContain('/todos')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(highlighted()?.textContent).toContain('empty')

    for (let i = 0; i < 20; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(highlighted()?.textContent).toContain('boom')
  })

  // A list that shrinks under the cursor would leave the highlight out of
  // range, and ↵ would silently do nothing — the worst outcome for a
  // keyboard path used without looking.
  it('returns the highlight to the top when the query changes', () => {
    const { input, onFlip } = renderPalette()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.change(input, { target: { value: 'orders' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onFlip).toHaveBeenCalledWith(orders, 'created')
  })

  it('says so when nothing matches, instead of showing an empty box', () => {
    const { input } = renderPalette()

    fireEvent.change(input, { target: { value: 'nothing-like-this' } })

    expect(screen.getByText(/nothing matches/)).toBeTruthy()
    expect(rows()).toHaveLength(0)
  })

  it('marks the pair that is already live, so it is not flipped twice', () => {
    renderPalette({ state: aState({ overrides: { 'POST /orders': 'boom' } }) })

    const boomRow = rows().find((row) => row.textContent?.includes('boom'))
    expect(boomRow?.textContent).toContain('live')
  })

  it('closes when the backdrop is clicked but not when the dialog is', () => {
    const { onClose } = renderPalette()

    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    const backdrop = document.querySelector('.palette-backdrop')
    if (backdrop) fireEvent.mouseDown(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
