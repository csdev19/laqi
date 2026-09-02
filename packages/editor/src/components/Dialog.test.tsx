/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

// Every native-dialog replacement in the panel is built from this one
// component, so a keyboard bug here is a keyboard bug everywhere. The
// failures it guards against are the classic hand-rolled-modal ones: focus
// vanishing into <body>, and Tab walking out of the dialog into the page
// behind it while the dialog is still up.

afterEach(cleanup)

function renderDialog(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <Dialog title="Delete endpoint" onCancel={onCancel} onConfirm={onConfirm} {...props}>
      <input aria-label="confirmation" />
    </Dialog>,
  )
  return { onCancel, onConfirm }
}

describe('Dialog', () => {
  it('announces itself as a modal dialog labelled by its own title', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy ?? '')?.textContent).toBe('Delete endpoint')
  })

  it('moves focus into the dialog on open', () => {
    renderDialog()

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  // The most common way a hand-rolled dialog fails a keyboard user: it
  // closes and focus is left on <body>, so the next Tab restarts at the top
  // of the page instead of where the work was.
  it('returns focus to whatever had it before, on close', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()

    const { unmount } = render(
      <Dialog title="Delete endpoint" onCancel={() => {}} onConfirm={() => {}}>
        <input aria-label="confirmation" />
      </Dialog>,
    )
    unmount()

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('cancels on Escape', () => {
    const { onCancel } = renderDialog()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('confirms on submit and reports nothing else', () => {
    const { onConfirm, onCancel } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('will not confirm while the confirm action is disabled', () => {
    const { onConfirm } = renderDialog({ confirmDisabled: true })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    fireEvent.keyDown(screen.getByLabelText('confirmation'), { key: 'Enter' })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  // Browsers submit a form on Enter from a text input; jsdom does not, and
  // the component compensates explicitly so the behaviour does not depend
  // on the implicit submit either way.
  it('confirms on Enter from a text input', () => {
    const { onConfirm } = renderDialog()

    fireEvent.keyDown(screen.getByLabelText('confirmation'), { key: 'Enter' })

    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('traps Tab inside the dialog at both ends', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog')
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    last?.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first?.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('cancels on a direct backdrop click but not on a click inside the card', () => {
    const { onCancel } = renderDialog()

    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onCancel).not.toHaveBeenCalled()

    const backdrop = document.querySelector('.dialog-backdrop')
    if (backdrop) fireEvent.mouseDown(backdrop)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('uses the labels the caller supplies', () => {
    renderDialog({ confirmLabel: 'Delete', cancelLabel: 'Keep it' })

    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy()
  })
})
