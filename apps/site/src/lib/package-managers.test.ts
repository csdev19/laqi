import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MANAGER,
  isPackageManagerId,
  PACKAGE_MANAGERS,
  type PackageManager,
} from './package-managers'

const commands = (manager: PackageManager) => [manager.global, manager.runner, manager.dev]

describe('PACKAGE_MANAGERS', () => {
  it('covers the four managers the roadmap named', () => {
    expect(PACKAGE_MANAGERS.map((manager) => manager.id)).toEqual(['npm', 'pnpm', 'yarn', 'bun'])
  })

  it('pins every command to laqi@2', () => {
    // The pin is the point of the install page: `laqi` alone can resolve to
    // the 2022 v1. One variant missing the pin teaches the wrong thing to
    // whoever's manager it is.
    for (const manager of PACKAGE_MANAGERS) {
      for (const command of commands(manager)) {
        expect(command).toContain('laqi@2')
      }
    }
  })

  it("never invokes another manager's binary", () => {
    // The real risk in a table like this is a copy-paste between rows —
    // pnpm's line ending up under yarn. `npx` is npm's own runner, so the
    // rule is not "starts with the manager's name", it is "does not start
    // with somebody else's".
    for (const manager of PACKAGE_MANAGERS) {
      const others = PACKAGE_MANAGERS.filter((other) => other.id !== manager.id)
      for (const command of commands(manager)) {
        const binary = command.split(' ')[0]!
        for (const other of others) {
          expect(binary.startsWith(other.id), `${manager.id}: "${command}"`).toBe(false)
        }
      }
    }
  })

  it('never mentions a version that is not the major pin', () => {
    // A hardcoded 2.0.1 here would go stale on the next release, which is
    // the exact failure `getLaqiVersion()` exists to prevent elsewhere.
    for (const manager of PACKAGE_MANAGERS) {
      for (const command of commands(manager)) {
        expect(command).not.toMatch(/laqi@\d+\.\d+/)
      }
    }
  })

  it('defaults to npm', () => {
    expect(DEFAULT_MANAGER).toBe('npm')
    expect(PACKAGE_MANAGERS[0]?.id).toBe(DEFAULT_MANAGER)
  })

  it('carries a note only where one manager genuinely differs', () => {
    // Verified in the command matrix: `yarn global` is Yarn 1 only. No
    // other manager needs an asterisk, and adding one to all four would
    // turn the note into furniture nobody reads.
    const noted = PACKAGE_MANAGERS.filter((manager) => manager.note !== undefined)
    expect(noted.map((manager) => manager.id)).toEqual(['yarn'])
  })
})

describe('isPackageManagerId', () => {
  it('accepts the four ids', () => {
    for (const manager of PACKAGE_MANAGERS) {
      expect(isPackageManagerId(manager.id)).toBe(true)
    }
  })

  it('rejects anything else, including junk out of localStorage', () => {
    // The stored value is user-writable. A stale or tampered key must fall
    // back to npm, not set data-pm to an id no CSS rule matches, which
    // would hide every command on the page.
    for (const value of ['deno', '', null, undefined, 42, {}]) {
      expect(isPackageManagerId(value)).toBe(false)
    }
  })
})

describe('the inline head script', () => {
  it('knows exactly the managers this module defines', async () => {
    // The head script has to be blocking, inline and dependency-free, so it
    // carries its own ES5 copy of the id list. That duplication is the one
    // thing that can silently rot: add a fifth manager here and the script
    // would refuse to select it, leaving that tab dead.
    const { PM_INLINE_SCRIPT } = await import('./pm-script.mjs')
    const ids = PM_INLINE_SCRIPT.match(/var ids = \[([^\]]*)\]/)?.[1]
    expect(ids).toBeDefined()

    const inScript = ids!.split(',').map((entry) => entry.trim().replace(/'/g, ''))
    expect(inScript).toEqual(PACKAGE_MANAGERS.map((manager) => manager.id))
  })

  it('falls back to the same default this module declares', async () => {
    const { PM_INLINE_SCRIPT } = await import('./pm-script.mjs')
    expect(PM_INLINE_SCRIPT).toContain(`var fallback = '${DEFAULT_MANAGER}'`)
  })

  it('guards every localStorage access, because Safari private mode throws', async () => {
    // This runs blocking in <head>. An unguarded throw would abort the
    // script before it stamps data-pm, and the page would render npm for
    // everyone regardless of what they picked.
    const { PM_INLINE_SCRIPT } = await import('./pm-script.mjs')
    const accesses = PM_INLINE_SCRIPT.match(/localStorage\./g) ?? []
    const catches = PM_INLINE_SCRIPT.match(/catch/g) ?? []
    expect(accesses.length).toBeGreaterThan(0)
    expect(catches.length).toBeGreaterThanOrEqual(accesses.length)
  })
})
