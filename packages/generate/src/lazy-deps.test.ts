import { afterEach, describe, expect, it, vi } from 'vitest'

const HEAVY = ['typescript', '@faker-js/faker', 'quicktype-core'] as const

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
 *    use. That is the sharp edge of the shared runtime: it provides all
 *    three layers at once, so one eager layer would make a single parse drag
 *    in faker and quicktype as well.
 *
 * Deliberately NOT in scope: building the `ManagedRuntime` eagerly at module
 * load. That is harmless on its own — `ManagedRuntime.make` does not build
 * its layers until something runs — and these tests assert the property that
 * actually matters (was the module evaluated?) rather than the mechanism
 * that currently delivers it.
 *
 * `vi.doMock` per run, not a hoisted `vi.mock`: a hoisted factory runs ONCE
 * for the whole file and `vi.resetModules()` does not re-run it, so every
 * assertion after the first one for a given module would read a stale
 * recording and quietly assert nothing.
 */
async function loadedDuring(act: (mod: typeof import('./index')) => Promise<unknown>) {
  const loaded = new Set<string>()
  vi.resetModules()
  vi.doMock('typescript', async () => {
    loaded.add('typescript')
    return { default: (await vi.importActual<{ default: unknown }>('typescript')).default }
  })
  vi.doMock('@faker-js/faker', async () => {
    loaded.add('@faker-js/faker')
    return await vi.importActual('@faker-js/faker')
  })
  vi.doMock('quicktype-core', async () => {
    loaded.add('quicktype-core')
    return await vi.importActual('quicktype-core')
  })

  const mod = await import('./index')
  const atImport = [...loaded]
  await act(mod)
  return { atImport, afterAct: loaded }
}

afterEach(() => {
  for (const dependency of HEAVY) vi.doUnmock(dependency)
  vi.resetModules()
})

describe('heavy dependencies stay lazy', () => {
  it('loads none of them when the package is merely imported', async () => {
    const { atImport } = await loadedDuring(async () => {})

    expect(atImport).toEqual([])
  })

  it('loads only the compiler when something parses', async () => {
    const { atImport, afterAct } = await loadedDuring((m) =>
      m.parseTypes('export interface A { a: string }', 'A'),
    )

    expect(atImport).toEqual([])
    expect([...afterAct]).toEqual(['typescript'])
  })

  it('loads only faker when something generates', async () => {
    const { afterAct } = await loadedDuring((m) => m.generate(m.primitive('string'), { seed: 1 }))

    expect([...afterAct]).toEqual(['@faker-js/faker'])
  })

  it('loads only quicktype when something prints', async () => {
    const { afterAct } = await loadedDuring((m) =>
      m.printTypes(m.primitive('string'), { typeName: 'Thing' }),
    )

    expect([...afterAct]).toEqual(['quicktype-core'])
  })

  it('loads only quicktype when listing the supported languages', async () => {
    const { afterAct } = await loadedDuring((m) => m.supportedLanguages())

    expect([...afterAct]).toEqual(['quicktype-core'])
  })
})
