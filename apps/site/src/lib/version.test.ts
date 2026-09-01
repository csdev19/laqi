import { describe, expect, it } from 'vitest'
import { getLaqiVersion } from './version'

describe('getLaqiVersion', () => {
  it('reads the version from apps/cli/package.json', () => {
    // apps/cli/package.json is 2.0.0 as of this writing (PR #31, the
    // beta line was dropped). If that version changes, this assertion
    // is meant to change with it — the point of reading from one file
    // is that this is the only place that has to.
    expect(getLaqiVersion()).toBe('2.0.0')
  })

  it('returns a bare semver string with no leading v or @beta suffix', () => {
    expect(getLaqiVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
