import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The three heavy dependencies are behind dynamic `import()` on purpose:
 * `typescript` alone is 23 MB, and `laqi start` must not pay for a compiler
 * it may never use. Nothing enforced that.
 *
 * Two regressions are in scope, and both were confirmed to turn these red
 * before being reverted:
 *
 *  - a stray top-level `import 'typescript'` anywhere in the package;
 *  - a service layer that imports at layer-BUILD time instead of at first
 *    use. That one is the sharp edge of the shared runtime: it provides all
 *    three layers at once, so a single eager layer would make one parse drag
 *    in faker and quicktype as well.
 *
 * Deliberately NOT in scope: building the `ManagedRuntime` eagerly at module
 * load. That is harmless on its own — `ManagedRuntime.make` does not build
 * its layers until something runs — and these tests assert the property that
 * actually matters (was the module evaluated?) rather than the mechanism
 * that currently delivers it.
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
    expect(loaded.has('@faker-js/faker')).toBe(false)
  })

  it('loads only faker when something generates, not the compiler', async () => {
    const { generate, primitive } = await import('./index')

    await generate(primitive('string'), { seed: 1 })

    expect(loaded.has('@faker-js/faker')).toBe(true)
    expect(loaded.has('typescript')).toBe(false)
    expect(loaded.has('quicktype-core')).toBe(false)
  })
})
