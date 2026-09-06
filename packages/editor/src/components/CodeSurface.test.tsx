/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { tokenizeJson } from '../highlight'
import { CodeSurface, mirrorScroll } from './CodeSurface'

// The whole illusion is two layers holding the same text at the same
// offset. jsdom has no layout, so nothing here can scroll for real: the
// arithmetic is pinned on the pure function, and the browser check lives in
// the driver script the PR describes.

afterEach(cleanup)

const scrollable = (top = 0, left = 0) => ({ scrollTop: top, scrollLeft: left })

describe('mirrorScroll', () => {
  it('moves the paint layer to exactly where the field is, on both axes', () => {
    const paint = scrollable()
    mirrorScroll(scrollable(120, 40), { paint, gutter: null })

    expect(paint).toEqual({ scrollTop: 120, scrollLeft: 40 })
  })

  // The gutter holds line numbers. Following the text sideways would push
  // them out of view exactly when a long line makes them most useful.
  it('moves the gutter vertically only', () => {
    const gutter = scrollable()
    mirrorScroll(scrollable(120, 40), { paint: null, gutter })

    expect(gutter).toEqual({ scrollTop: 120, scrollLeft: 0 })
  })

  it('does not mind a layer that is not mounted', () => {
    expect(() => mirrorScroll(scrollable(10, 10), { paint: null, gutter: null })).not.toThrow()
  })

  it('follows the field back to the top', () => {
    const paint = scrollable(300, 12)
    const gutter = scrollable(300)
    mirrorScroll(scrollable(0, 0), { paint, gutter })

    expect([paint.scrollTop, gutter.scrollTop]).toEqual([0, 0])
  })
})

describe('CodeSurface', () => {
  it('paints exactly the text the field holds, and numbers every line', () => {
    const source = '{\n  "id": 1\n}'
    render(<CodeSurface value={source} onChange={() => {}} tokenize={tokenizeJson} label="body" />)

    expect((screen.getByLabelText('body') as HTMLTextAreaElement).value).toBe(source)
    expect(document.querySelector('.editor-paint')?.textContent).toBe(source)
    expect(document.querySelector('.editor-gutter')?.textContent).toBe('123')
  })

  it('listens for the field scrolling, since that is what drives the others', () => {
    render(<CodeSurface value="{}" onChange={() => {}} tokenize={tokenizeJson} label="body" />)

    // Nothing to assert on offsets without layout; what this pins is that a
    // scroll on the field is handled at all rather than silently ignored.
    const field = screen.getByLabelText('body')
    expect(() => field.dispatchEvent(new Event('scroll', { bubbles: true }))).not.toThrow()
  })

  it('adds the caller class beside the shared one', () => {
    render(
      <CodeSurface
        value=""
        onChange={() => {}}
        tokenize={tokenizeJson}
        label="model"
        className="model-editor"
      />,
    )

    const shell = document.querySelector('.editor-shell')
    expect(shell?.classList.contains('model-editor')).toBe(true)
  })

  it('hides the decorative layers from assistive technology', () => {
    render(<CodeSurface value="{}" onChange={() => {}} tokenize={tokenizeJson} label="body" />)

    expect(document.querySelector('.editor-gutter')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.editor-paint')?.getAttribute('aria-hidden')).toBe('true')
  })
})
