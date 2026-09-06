/**
 * The keyboard rules that make a plain textarea behave like a code editor:
 * Tab indents, Enter keeps the indentation, brackets and quotes close
 * themselves. Pure functions over (text, selection, key), so the rules are
 * pinned without a DOM and the component only has to apply the result.
 */

export type EditState = { value: string; start: number; end: number }

/** Replace `[start, end)` with `text`, then select `[caret, caretEnd]`. */
export type Edit = { start: number; end: number; text: string; caret: number; caretEnd: number }

export type Key = {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

export const INDENT = '  '

const PAIRS: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
const CLOSERS = new Set(Object.values(PAIRS))
const QUOTES = new Set(['"', "'", '`'])
const WORD = /[\w$]/

/** The edit a key press should produce, or `null` to let the browser type it. */
export function editForKey(state: EditState, key: Key): Edit | null {
  if (key.metaKey || key.ctrlKey || key.altKey) return null

  switch (key.key) {
    case 'Tab':
      return key.shiftKey ? outdent(state) : indent(state)
    case 'Enter':
      return newline(state)
    case 'Backspace':
      return deletePair(state)
  }

  const { value, start, end } = state
  const selected = value.slice(start, end)
  const after = value[end] ?? ''

  if (key.key in PAIRS) {
    const close = PAIRS[key.key]!
    return wrap(state, key.key, close)
  }
  if (CLOSERS.has(key.key) && start === end && after === key.key) {
    return stepOver(state)
  }
  if (QUOTES.has(key.key)) {
    if (selected.length > 0) return wrap(state, key.key, key.key)
    if (after === key.key) return stepOver(state)
    const before = value[start - 1] ?? ''
    // A quote glued to a word is an apostrophe or the end of a word, not the
    // start of a string — pairing it there would leave `don''t` behind.
    if (WORD.test(before) || WORD.test(after) || QUOTES.has(before)) return null
    return wrap(state, key.key, key.key)
  }

  return null
}

/** The text and selection after `edit` is applied to `state`. */
export function applyEdit(state: EditState, edit: Edit): EditState {
  const value = state.value.slice(0, edit.start) + edit.text + state.value.slice(edit.end)
  return { value, start: edit.caret, end: edit.caretEnd }
}

function indent(state: EditState): Edit {
  const { value, start, end } = state
  if (start === end) {
    return {
      start,
      end,
      text: INDENT,
      caret: start + INDENT.length,
      caretEnd: start + INDENT.length,
    }
  }
  const from = lineStart(value, start)
  const lines = value.slice(from, end).split('\n')
  const text = lines.map((line) => INDENT + line).join('\n')
  return { start: from, end, text, caret: from, caretEnd: from + text.length }
}

function outdent(state: EditState): Edit | null {
  const { value, start, end } = state
  const from = lineStart(value, start)
  const to = start === end ? lineEnd(value, end) : end
  const lines = value.slice(from, to).split('\n')
  const trimmed = lines.map((line) => line.replace(/^ {1,2}/, ''))
  const text = trimmed.join('\n')
  if (text === value.slice(from, to)) return null
  if (start === end) {
    const removed = lines[0]!.length - trimmed[0]!.length
    const caret = Math.max(from, start - removed)
    return { start: from, end: to, text, caret, caretEnd: caret }
  }
  return { start: from, end: to, text, caret: from, caretEnd: from + text.length }
}

function newline(state: EditState): Edit {
  const { value, start, end } = state
  const current = leadingSpaces(value, lineStart(value, start))
  const before = value[start - 1] ?? ''
  const after = value[end] ?? ''

  if (before in PAIRS) {
    const inner = '\n' + current + INDENT
    if (PAIRS[before] === after) {
      const text = inner + '\n' + current
      return { start, end, text, caret: start + inner.length, caretEnd: start + inner.length }
    }
    return { start, end, text: inner, caret: start + inner.length, caretEnd: start + inner.length }
  }

  const text = '\n' + current
  return { start, end, text, caret: start + text.length, caretEnd: start + text.length }
}

function deletePair(state: EditState): Edit | null {
  const { value, start, end } = state
  if (start !== end) return null
  const before = value[start - 1] ?? ''
  const after = value[start] ?? ''
  const closes = PAIRS[before] === after || (QUOTES.has(before) && before === after)
  if (!closes) return null
  return { start: start - 1, end: start + 1, text: '', caret: start - 1, caretEnd: start - 1 }
}

function wrap(state: EditState, open: string, close: string): Edit {
  const { value, start, end } = state
  const selected = value.slice(start, end)
  return {
    start,
    end,
    text: open + selected + close,
    caret: start + open.length,
    caretEnd: start + open.length + selected.length,
  }
}

function stepOver(state: EditState): Edit {
  const { end } = state
  return { start: end, end, text: '', caret: end + 1, caretEnd: end + 1 }
}

function lineStart(value: string, index: number): number {
  return value.lastIndexOf('\n', index - 1) + 1
}

function lineEnd(value: string, index: number): number {
  const next = value.indexOf('\n', index)
  return next === -1 ? value.length : next
}

function leadingSpaces(value: string, from: number): string {
  return /^[ \t]*/.exec(value.slice(from))![0]
}
