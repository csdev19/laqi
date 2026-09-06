import { useLayoutEffect, useRef } from 'react'
import { applyEdit, editForKey, type Edit } from '../edit-keys'
import { tokenizeTypeScript, type Token } from '../highlight'
import { CodeSurface } from './CodeSurface'

/**
 * The languages a pasted model can be written in. One entry today; the
 * registry exists so adding Zod, Prisma or Go is a new tokenizer and a
 * new key here, not a new component.
 */
export type ModelLanguage = 'typescript'

const LANGUAGES: Record<ModelLanguage, { tokenize: (source: string) => Token[] }> = {
  typescript: { tokenize: tokenizeTypeScript },
}

/**
 * CodeSurface plus the keyboard rules from `edit-keys`, so that pasting and
 * touching up a model feels like an editor: Tab indents, Enter keeps the
 * indentation, brackets close themselves.
 */
export function ModelEditor(props: {
  value: string
  onChange: (value: string) => void
  language?: ModelLanguage
  label?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const language = LANGUAGES[props.language ?? 'typescript']
  const input = useRef<HTMLTextAreaElement>(null)
  const pendingSelection = useRef<[number, number] | null>(null)

  // A manual edit changes the value through React, so the caret can only be
  // placed once the new value has been rendered into the textarea.
  useLayoutEffect(() => {
    const selection = pendingSelection.current
    if (!selection || !input.current) return
    pendingSelection.current = null
    input.current.setSelectionRange(selection[0], selection[1])
  })

  const apply = (textarea: HTMLTextAreaElement, edit: Edit) => {
    const state = {
      value: textarea.value,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    }
    // `insertText` goes through the browser's own edit path, which is what
    // keeps native undo working. It is absent in jsdom and refused by some
    // browsers, and then the edit is applied by hand instead.
    textarea.setSelectionRange(edit.start, edit.end)
    const changes = edit.text.length > 0 || edit.start !== edit.end
    const native = changes && insertText(edit.text)
    if (native) {
      textarea.setSelectionRange(edit.caret, edit.caretEnd)
      return
    }
    const next = applyEdit(state, edit)
    if (next.value !== state.value) {
      pendingSelection.current = [next.start, next.end]
      props.onChange(next.value)
    } else {
      textarea.setSelectionRange(next.start, next.end)
    }
  }

  return (
    <CodeSurface
      value={props.value}
      onChange={props.onChange}
      tokenize={language.tokenize}
      label={props.label ?? 'model'}
      className="model-editor"
      placeholder={props.placeholder}
      autoFocus={props.autoFocus}
      textareaRef={input}
      onKeyDown={(event) => {
        const edit = editForKey(
          {
            value: event.currentTarget.value,
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          },
          event,
        )
        if (!edit) return
        event.preventDefault()
        apply(event.currentTarget, edit)
      }}
    />
  )
}

function insertText(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  try {
    return text.length > 0
      ? document.execCommand('insertText', false, text)
      : document.execCommand('delete', false)
  } catch {
    return false
  }
}
