import { describe, expect, it } from 'vitest'
import { applyEdit, editForKey, type EditState } from './edit-keys'

// The model box has to feel like a code editor, not a form field: Tab
// indents, Enter keeps the indentation, brackets close themselves. Every
// rule here is a pure function of (text, selection, key) so it can be
// pinned without a DOM, and `applyEdit` is the one place that turns the
// resulting edit back into text.

/** Build a state from a string with `|` marking the caret (or two, a selection). */
function at(marked: string): EditState {
  const start = marked.indexOf('|')
  const rest = marked.slice(start + 1)
  const second = rest.indexOf('|')
  const value = marked.replace(/\|/g, '')
  return { value, start, end: second === -1 ? start : start + second }
}

/** Render a state back with `|` markers, so expectations read like source. */
function show(state: EditState): string {
  const { value, start, end } = state
  return start === end
    ? value.slice(0, start) + '|' + value.slice(start)
    : value.slice(0, start) + '|' + value.slice(start, end) + '|' + value.slice(end)
}

function press(marked: string, key: string, modifiers: { shiftKey?: boolean } = {}): string | null {
  const state = at(marked)
  const edit = editForKey(state, { key, ...modifiers })
  return edit ? show(applyEdit(state, edit)) : null
}

describe('editForKey', () => {
  describe('Tab', () => {
    it('inserts two spaces at the caret', () => {
      expect(press('a|b', 'Tab')).toBe('a  |b')
    })

    it('indents every line the selection touches and keeps them selected', () => {
      expect(press('|a\nb|\nc', 'Tab')).toBe('|  a\n  b|\nc')
    })

    it('outdents on Shift+Tab, removing at most one indent per line', () => {
      expect(press('|  a\n    b\nc|', 'Tab', { shiftKey: true })).toBe('|a\n  b\nc|')
    })

    it('outdents the current line even with no selection', () => {
      expect(press('  a|', 'Tab', { shiftKey: true })).toBe('a|')
    })
  })

  describe('Enter', () => {
    it('carries the current indentation onto the new line', () => {
      expect(press('  id: number|', 'Enter')).toBe('  id: number\n  |')
    })

    it('opens an indented block between a bracket pair', () => {
      expect(press('interface Todo {|}', 'Enter')).toBe('interface Todo {\n  |\n}')
    })

    it('keeps the outer indentation when opening a nested block', () => {
      expect(press('  address: {|}', 'Enter')).toBe('  address: {\n    |\n  }')
    })

    it('indents one level after an opening bracket with nothing to close', () => {
      expect(press('type A = {|', 'Enter')).toBe('type A = {\n  |')
    })

    it('replaces a selection with the newline', () => {
      expect(press('a|xyz|b', 'Enter')).toBe('a\n|b')
    })
  })

  describe('bracket pairs', () => {
    it.each([
      ['{', '{|}'],
      ['[', '[|]'],
      ['(', '(|)'],
    ])('closes %s and leaves the caret inside', (key, expected) => {
      expect(press('|', key)).toBe(expected)
    })

    it('wraps a selection instead of replacing it', () => {
      expect(press('a |b| c', '[')).toBe('a [|b|] c')
    })

    it('steps over a closer that is already there', () => {
      expect(press('{|}', '}')).toBe('{}|')
    })

    it('still types a closer when nothing matches ahead', () => {
      expect(press('{|', '}')).toBeNull()
    })

    it('deletes both halves of an empty pair on Backspace', () => {
      expect(press('a{|}b', 'Backspace')).toBe('a|b')
    })

    it('leaves Backspace to the browser everywhere else', () => {
      expect(press('ab|', 'Backspace')).toBeNull()
      expect(press('{x|}', 'Backspace')).toBeNull()
    })
  })

  describe('quotes', () => {
    it('pairs a quote at the end of a line', () => {
      expect(press('kind: |', "'")).toBe("kind: '|'")
      expect(press('kind: |', '"')).toBe('kind: "|"')
      expect(press('kind: |', '`')).toBe('kind: `|`')
    })

    it('steps over the closing quote instead of doubling it', () => {
      expect(press("'vip|'", "'")).toBe("'vip'|")
    })

    it('does not pair a quote right after a word, so contractions still type', () => {
      expect(press('don|', "'")).toBeNull()
    })

    it('does not pair a quote before a word', () => {
      expect(press('|vip', "'")).toBeNull()
    })

    it('wraps a selection in the quote', () => {
      expect(press('|vip|', "'")).toBe("'|vip|'")
    })
  })

  it('leaves shortcuts alone', () => {
    expect(editForKey(at('a|'), { key: 'z', metaKey: true })).toBeNull()
    expect(editForKey(at('a|'), { key: 'Enter', ctrlKey: true })).toBeNull()
    expect(editForKey(at('a|'), { key: 'Tab', altKey: true })).toBeNull()
  })

  it('leaves ordinary characters alone', () => {
    expect(press('a|', 'b')).toBeNull()
    expect(press('a|', 'ArrowLeft')).toBeNull()
  })
})
