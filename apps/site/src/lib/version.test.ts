import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getLaqiVersion } from './version'

// Read the same file getLaqiVersion reads from, independently, so this
// test stays correct across every release without anyone touching it —
// that's the whole point of sourcing the version from one file instead
// of hardcoding it here too.
const cliPackageJsonUrl = new URL('../../../cli/package.json', import.meta.url)
function readCliPackageVersion(): string {
  const raw = readFileSync(fileURLToPath(cliPackageJsonUrl), 'utf-8')
  return (JSON.parse(raw) as { version: string }).version
}

describe('getLaqiVersion', () => {
  it('reads the version from apps/cli/package.json', () => {
    expect(getLaqiVersion()).toBe(readCliPackageVersion())
  })

  it('returns a bare semver string with no leading v or @beta suffix', () => {
    expect(getLaqiVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
