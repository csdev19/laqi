import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The compiler is loaded through a dynamic `import('typescript')`, and the
 * whole checker walk that follows is plain synchronous JavaScript. Neither
 * is covered by the `ParseError` channel unless it is explicitly wired
 * there — a rejected import or a throwing checker would otherwise escape
 * as an Effect defect, invisible to `catchTag('ParseError')` and surfacing
 * to the caller as a raw FiberFailure. These tests pin that down.
 */
afterEach(() => {
  vi.doUnmock('typescript')
  vi.resetModules()
})

describe('parseTypes when the compiler itself fails', () => {
  it('reports a failed compiler import as a parse failure, not a rejected promise', async () => {
    vi.doMock('typescript', () => {
      throw new Error('cannot find module typescript')
    })
    vi.resetModules()
    const { parseTypes } = await import('./parse-types')

    const result = await parseTypes('export interface User { name: string }', 'User')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.error).toMatch(/typescript/i)
  })

  it('reports a compiler import failure through the typed ParseError channel', async () => {
    vi.doMock('typescript', () => {
      throw new Error('cannot find module typescript')
    })
    vi.resetModules()
    const { Effect } = await import('effect')
    const { parseTypesEffect } = await import('./parse-types')

    const caught = await Effect.runPromise(
      parseTypesEffect('export interface User { name: string }', 'User').pipe(
        Effect.catchTag('ParseError', (e) => Effect.succeed(`caught: ${e.message}`)),
      ),
    )
    expect(caught).toMatch(/^caught: /)
  })

  it('reports a throwing checker as a parse failure instead of an unhandled defect', async () => {
    vi.doMock('typescript', async () => {
      const actual = await vi.importActual<typeof import('typescript')>('typescript')
      return {
        default: {
          ...actual,
          createProgram: () => {
            throw new Error('checker exploded')
          },
        },
      }
    })
    vi.resetModules()
    const { parseTypes } = await import('./parse-types')

    const result = await parseTypes('export interface User { name: string }', 'User')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.error).toMatch(/checker exploded/)
  })
})
