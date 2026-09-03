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
