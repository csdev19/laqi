import { describe, expect, it } from 'vitest'
import config from '../../release-please-config.json'
import manifest from '../../.release-please-manifest.json'

// release-please's schema sets `additionalProperties: false` at the root and
// defines `prerelease-type` only inside `ReleaserConfigOptions`, which
// applies at package scope. A key that is valid but misplaced still passes
// `JSON.parse` and any schema-agnostic JSON-validity check, so nothing short
// of pinning the structure catches it. Without `prerelease-type`, release-please's
// prerelease strategy silently produces a plain final version instead of a
// beta, which the publish pipeline would then push to npm as `latest`.
const ROOT_KEYS_ALLOWED = new Set([
  '$schema',
  'release-type',
  'include-component-in-tag',
  'bootstrap-sha',
  'packages',
])

describe('release-please-config.json', () => {
  it('has no top-level key outside the explicit allow-list', () => {
    for (const key of Object.keys(config)) {
      expect(ROOT_KEYS_ALLOWED.has(key), `unexpected root key: ${key}`).toBe(true)
    }
  })

  it('carries the prerelease settings at package scope, not root', () => {
    const root = config as Record<string, unknown>
    expect(root['prerelease-type']).toBeUndefined()
    expect(root.versioning).toBeUndefined()
    expect(root.prerelease).toBeUndefined()

    const pkg = config.packages['.'] as Record<string, unknown>
    expect(pkg['prerelease-type']).toBe('beta')
    expect(pkg.versioning).toBe('prerelease')
    expect(pkg.prerelease).toBe(true)
  })

  it('writes the version into apps/cli/package.json via extra-files', () => {
    const pkg = config.packages['.']
    const entry = pkg['extra-files'].find(
      (f: { path: string }) => f.path === 'apps/cli/package.json',
    )
    expect(entry).toBeDefined()
  })

  it("the manifest's keys exactly equal the config's packages keys", () => {
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(config.packages).sort())
  })
})
