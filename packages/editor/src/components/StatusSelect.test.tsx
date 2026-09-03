/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatusSelect } from './StatusSelect'

// This field decides what the mock server actually returns. The one rule it
// must never break is that an unlisted code stays typeable — a mock that
// cannot return 599 is not a mock server.

afterEach(cleanup)

/**
 * Stateful on purpose. The component is controlled — the caller owns the
 * value — so a harness that only spied on onChange would leave the field
 * frozen and never exercise the filtering, which reads the value back.
 */
function renderSelect(initial = '200') {
  const onChange = vi.fn()

  function Harness() {
    const [value, setValue] = useState(initial)
    return (
      <StatusSelect
        label="status"
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
      />
    )
  }

  render(<Harness />)
  return { onChange, input: screen.getByLabelText('status') }
}

describe('StatusSelect', () => {
  it('shows the current value', () => {
    const { input } = renderSelect('404')
    expect((input as HTMLInputElement).value).toBe('404')
  })

  it('is closed until it is focused', () => {
    renderSelect()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens on focus and lists the catalogue', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(screen.getByRole('option', { name: /404 Not Found/ })).toBeTruthy()
  })

  it('narrows as you type, by name as well as by number', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'not found' } })
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]?.textContent).toContain('Not Found')
  })

  it('reports every keystroke, so free text survives', () => {
    // 599 is not in the catalogue. It still has to reach the caller.
    const { input, onChange } = renderSelect()
    fireEvent.change(input, { target: { value: '599' } })
    expect(onChange).toHaveBeenCalledWith('599')
  })

  it('says so rather than showing an empty box when nothing matches', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '599' } })
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByText(/599 is not a named code/)).toBeTruthy()
  })

  it('groups the options by class', () => {
    const { input } = renderSelect()
    fireEvent.focus(input)
    expect(screen.getByText('client error')).toBeTruthy()
    expect(screen.getByText('server error')).toBeTruthy()
  })

  it('picks the highlighted code on Enter and closes', () => {
    const { input, onChange } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '404' } })
    onChange.mockClear()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('404')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not swallow Enter when nothing matches, so the form can submit', () => {
    // CreateEndpointRow submits on Enter. If the combobox called
    // preventDefault unconditionally, typing 599 and pressing Enter would
    // do nothing at all and look like a broken form.
    const { input } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '599' } })
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('moves the highlight with the arrow keys', () => {
    const { input, onChange } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'not' } })
    onChange.mockClear()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    const [[picked]] = onChange.mock.calls
    expect(picked).not.toBe('304')
  })

  it('closes on Escape without changing the value', () => {
    const { input, onChange } = renderSelect('200')
    fireEvent.focus(input)
    onChange.mockClear()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('picks a code on click', () => {
    const { input, onChange } = renderSelect()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '409' } })
    onChange.mockClear()
    fireEvent.mouseDown(screen.getByRole('option', { name: /409 Conflict/ }))
    expect(onChange).toHaveBeenCalledWith('409')
  })
})
