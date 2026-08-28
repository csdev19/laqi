import { describe, expect, it } from 'vitest'
import { distTagFor, versionFromTag } from './dist-tag'

describe('distTagFor', () => {
  it('sends a plain release to latest', () => {
    expect(distTagFor('2.0.0')).toBe('latest')
    expect(distTagFor('10.20.30')).toBe('latest')
  })

  // The whole point: npm would tag these `latest` on its own, replacing the
  // 1.2.1 that every existing `npx laqi` user gets today.
  it('sends a prerelease to a tag named after its identifier', () => {
    expect(distTagFor('2.0.0-beta')).toBe('beta')
    expect(distTagFor('2.0.0-beta.0')).toBe('beta')
    expect(distTagFor('2.0.0-beta.17')).toBe('beta')
    expect(distTagFor('3.0.0-rc.1')).toBe('rc')
  })

  it('ignores build metadata', () => {
    expect(distTagFor('2.0.0+build.5')).toBe('latest')
    expect(distTagFor('2.0.0-beta.1+build.5')).toBe('beta')
  })

  // `1.0.0-1` is legal semver, but "1" is not a usable dist-tag name and npm
  // rejects a tag that parses as a version. Failing loudly beats guessing.
  it('refuses a numeric prerelease identifier', () => {
    expect(() => distTagFor('1.0.0-1')).toThrow(/identifier/i)
  })

  // `latest` is the one tag this whole module exists to protect. An
  // identifier that IS `latest` must never slip through as if it were an
  // ordinary tag name — that would silently replace the 1.2.1 that every
  // `npx laqi` user gets today.
  it('refuses a prerelease identifier that is latest, case-insensitively', () => {
    expect(() => distTagFor('2.0.0-latest')).toThrow(/latest/i)
    expect(() => distTagFor('2.0.0-latest.1')).toThrow(/latest/i)
    expect(() => distTagFor('2.0.0-LATEST.1')).toThrow(/latest/i)
  })

  // npm refuses a dist-tag that parses as a valid semver version or range.
  // Catching this here beats discovering it as a CI break at publish time.
  it('refuses a prerelease identifier that would be read as a version or range', () => {
    expect(() => distTagFor('2.0.0-x.1')).toThrow(/identifier/i)
    expect(() => distTagFor('2.0.0-v1.5')).toThrow(/identifier/i)
    expect(() => distTagFor('2.0.0-2.1')).toThrow(/identifier/i)
  })

  it('refuses anything that is not a semver version', () => {
    expect(() => distTagFor('v2.0.0')).toThrow(/not a valid semver/i)
    expect(() => distTagFor('2.0')).toThrow(/not a valid semver/i)
    expect(() => distTagFor('')).toThrow(/not a valid semver/i)
  })
})

describe('versionFromTag', () => {
  it('strips the leading v', () => {
    expect(versionFromTag('v2.0.0-beta.0')).toBe('2.0.0-beta.0')
    expect(versionFromTag('v2.0.0')).toBe('2.0.0')
  })

  it('refuses a tag without the v prefix', () => {
    expect(() => versionFromTag('2.0.0')).toThrow(/must start with/i)
  })

  it('refuses a tag whose remainder is not a version', () => {
    expect(() => versionFromTag('vlatest')).toThrow(/not a valid semver/i)
  })
})
