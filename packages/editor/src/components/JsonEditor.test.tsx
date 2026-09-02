/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonEditor, ValidityReadout } from './JsonEditor'

// A transparent textarea over a painted <pre>, aligned character for
// character. The whole illusion depends on the two layers holding the same
// text, so the tests pin what would break the alignment or the readout the
// developer trusts before saving.

afterEach(cleanup)

describe('JsonEditor', () => {
  it('shows the source in an editable field', () => {
    const onChange = vi.fn()
    render(<JsonEditor value='{ "id": 1 }' onChange={onChange} />)

    const input = screen.getByLabelText('response body')
    expect((input as HTMLTextAreaElement).value).toBe('{ "id": 1 }')

    fireEvent.change(input, { target: { value: '{ "id": 2 }' } })
    expect(onChange).toHaveBeenCalledWith('{ "id": 2 }')
  })

  it('numbers every line, including the last', () => {
    render(<JsonEditor value={'{\n  "id": 1\n}'} onChange={() => {}} />)

    const gutter = document.querySelector('.editor-gutter')
    expect(gutter?.children).toHaveLength(3)
    expect(gutter?.textContent).toBe('123')
  })

  // The paint layer is what the developer sees; if it ever holds different
  // text than the textarea, the caret drifts away from the characters.
  it('paints exactly the text the field holds', () => {
    const source = '{ "name": "Ada", "ok": true }'
    render(<JsonEditor value={source} onChange={() => {}} />)

    expect(document.querySelector('.editor-paint')?.textContent).toBe(source)
  })

  // A source ending in a newline leaves the caret on a line the paint layer
  // would not otherwise have — the tokens stop at the last character — so
  // the caret would sit outside the painted area. The extra newline is what
  // holds that line open.
  it('paints an extra blank line when the source ends in a newline', () => {
    const { unmount } = render(<JsonEditor value={'{}\n'} onChange={() => {}} />)
    expect(document.querySelector('.editor-paint')?.textContent).toBe('{}\n\n')
    unmount()

    render(<JsonEditor value={'{}'} onChange={() => {}} />)
    expect(document.querySelector('.editor-paint')?.textContent).toBe('{}')
  })

  it('honours read-only', () => {
    render(<JsonEditor value="{}" onChange={() => {}} readOnly />)

    expect((screen.getByLabelText('response body') as HTMLTextAreaElement).readOnly).toBe(true)
  })

  it('hides the decorative layers from assistive technology', () => {
    render(<JsonEditor value="{}" onChange={() => {}} />)

    expect(document.querySelector('.editor-gutter')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.editor-paint')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('ValidityReadout', () => {
  // This is the signal a developer reads before saving a body into their
  // repository, so "valid" has to mean parseable, not merely non-empty.
  it('reports valid JSON with its size', () => {
    render(<ValidityReadout source='{ "id": 1 }' />)

    expect(screen.getByText(/valid JSON/).textContent).toContain('B')
  })

  it('reports the reason when the JSON will not parse', () => {
    render(<ValidityReadout source="{ nope" />)

    expect(document.querySelector('.editor-validity.is-invalid')).toBeTruthy()
    expect(screen.queryByText(/^valid JSON/)).toBeNull()
  })
})
