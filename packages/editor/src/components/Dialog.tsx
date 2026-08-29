import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * shadcn's *pattern*, laqi's *skin*: an in-app dialog with an overlay, a
 * centred card, right-aligned actions, a trapped focus loop and Escape to
 * close — but built from `--panel`/`--line2`/mono, not a rounded grey card
 * that would look pasted into this UI.
 *
 * Deliberately narrow: title + optional description + a body (the caller's
 * input) + Cancel/confirm. That covers every native-dialog replacement this
 * panel needs today; it is not a general-purpose modal framework.
 */
export function Dialog(props: {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  children: ReactNode
}) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)

  // Focus moves into the dialog on open and comes back to whatever had it
  // before on close — the most common way a hand-rolled dialog fails a
  // keyboard user is focus vanishing into <body>. Captured in the effect,
  // not a prop, so every caller gets this for free.
  useEffect(() => {
    const trigger = document.activeElement
    const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    first?.focus()
    return () => {
      if (trigger instanceof HTMLElement) trigger.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onCancel()
      return
    }
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      // Real browsers already submit the <form> on Enter from a text input;
      // this makes it explicit so the behaviour does not depend on that
      // implicit submit (which, notably, jsdom does not simulate).
      event.preventDefault()
      if (!props.confirmDisabled) props.onConfirm()
      return
    }
    if (event.key !== 'Tab') return

    // Tab must not escape to the page behind while the dialog is open.
    const card = cardRef.current
    const focusables = card
      ? Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : []
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!props.confirmDisabled) props.onConfirm()
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // Only a direct hit on the backdrop cancels — a click that started
        // or ended on the card must not, even if it bubbles up.
        if (event.target === event.currentTarget) props.onCancel()
      }}
    >
      <div
        ref={cardRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <form onSubmit={handleSubmit}>
          <h2 id={titleId} className="dialog-title mono">
            {props.title}
          </h2>
          {props.description ? <p className="dialog-description">{props.description}</p> : null}
          <div className="dialog-body">{props.children}</div>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={props.onCancel}>
              {props.cancelLabel ?? 'Cancel'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={props.confirmDisabled}>
              {props.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
