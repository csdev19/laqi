import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The three heavy dependencies are behind dynamic `import()` on purpose:
 * `typescript` alone is 23 MB, and `laqi start` must not pay for a compiler
 * it may never use. Nothing enforced that — a stray top-level import, or a
 * service layer built eagerly, would move the cost to startup silently.
 *
 * Each factory records that the module was evaluated and then returns the
 * real one, so this observes loading without replacing behaviour.
 */
const loaded = new Set<string>()

vi.mock('typescript', async () => {
  loaded.add('typescript')
  return { default: (await vi.importActual<{ default: unknown }>('typescript')).default }
})
vi.mock('@faker-js/faker', async () => {
  loaded.add('@faker-js/faker')
  return await vi.importActual('@faker-js/faker')
})
vi.mock('quicktype-core', async () => {
  loaded.add('quicktype-core')
  return await vi.importActual('quicktype-core')
})

beforeEach(() => {
  loaded.clear()
  vi.resetModules()
})

describe('heavy dependencies stay lazy', () => {
  it('loads none of them when the package is merely imported', async () => {
    await import('./index')

    expect([...loaded]).toEqual([])
  })

  it('loads the compiler only when something actually parses', async () => {
    const { parseTypes } = await import('./index')
    expect([...loaded]).toEqual([])

    await parseTypes('export interface A { a: string }', 'A')

    expect(loaded.has('typescript')).toBe(true)
    expect(loaded.has('quicktype-core')).toBe(false)
  })
})
