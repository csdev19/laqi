/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelEditor } from './ModelEditor'

// The keyboard rules themselves are pinned in edit-keys.test.ts. What this
// file guards is the glue: a key that produces an edit reaches the value
// through onChange with the caret where an editor would put it, and a key
// that produces none is left to the browser untouched.

afterEach(cleanup)

function Harness(props: { initial: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(props.initial)
  return (
    <ModelEditor
      value={value}
      onChange={(next) => {
        setValue(next)
        props.onChange?.(next)
      }}
    />
  )
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText('model') as HTMLTextAreaElement
}

function caretAt(index: number): void {
  textarea().setSelectionRange(index, index)
}

describe('ModelEditor', () => {
  it('shows the source in an editable field and paints the same text', () => {
    const onChange = vi.fn()
    render(<ModelEditor value="interface A {}" onChange={onChange} />)

    expect(textarea().value).toBe('interface A {}')
    expect(document.querySelector('.editor-paint')?.textContent).toBe('interface A {}')

    fireEvent.change(textarea(), { target: { value: 'interface B {}' } })
    expect(onChange).toHaveBeenCalledWith('interface B {}')
  })

  it('colours TypeScript, not JSON', () => {
    render(<ModelEditor value="export interface A {}" onChange={() => {}} />)

    expect(document.querySelector('.tok-keyword')?.textContent).toBe('export')
    expect(document.querySelector('.tok-type')?.textContent).toBe('A')
  })

  it('opens an indented block on Enter between braces and places the caret inside', () => {
    const onChange = vi.fn()
    render(<Harness initial="interface Todo {}" onChange={onChange} />)
    caretAt('interface Todo {'.length)

    fireEvent.keyDown(textarea(), { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('interface Todo {\n  \n}')
    expect(textarea().selectionStart).toBe('interface Todo {\n  '.length)
  })

  it('indents on Tab instead of leaving the field', () => {
    const onChange = vi.fn()
    render(<Harness initial="a" onChange={onChange} />)
    caretAt(1)

    const event = fireEvent.keyDown(textarea(), { key: 'Tab' })

    expect(event).toBe(false) // default prevented: focus stays here
    expect(onChange).toHaveBeenCalledWith('a  ')
  })

  it('closes a bracket as it is typed', () => {
    const onChange = vi.fn()
    render(<Harness initial="" onChange={onChange} />)

    fireEvent.keyDown(textarea(), { key: '{' })

    expect(onChange).toHaveBeenCalledWith('{}')
    expect(textarea().selectionStart).toBe(1)
  })

  it('steps over an existing closer without changing the text', () => {
    const onChange = vi.fn()
    render(<Harness initial="{}" onChange={onChange} />)
    caretAt(1)

    fireEvent.keyDown(textarea(), { key: '}' })

    expect(onChange).not.toHaveBeenCalled()
    expect(textarea().selectionStart).toBe(2)
  })

  it('leaves ordinary keys and shortcuts to the browser', () => {
    const onChange = vi.fn()
    render(<Harness initial="a" onChange={onChange} />)

    expect(fireEvent.keyDown(textarea(), { key: 'b' })).toBe(true)
    expect(fireEvent.keyDown(textarea(), { key: 'z', metaKey: true })).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('numbers every line', () => {
    render(<ModelEditor value={'a\nb\nc'} onChange={() => {}} />)

    expect(document.querySelector('.editor-gutter')?.textContent).toBe('123')
  })

  it('turns spell-check and auto-correct off, since this is code', () => {
    render(<ModelEditor value="" onChange={() => {}} />)

    expect(textarea().getAttribute('spellcheck')).toBe('false')
    expect(textarea().getAttribute('autocorrect')).toBe('off')
  })
})
