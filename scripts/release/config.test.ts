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

  // `include-component-in-tag: false` is what makes release-please cut a
  // bare `v2.0.0-beta.0` tag instead of `laqi-monorepo-v2.0.0-beta.0`. It is
  // the only link between the tag and the publish workflow: `release-npm.yml`
  // matches on `tags: ['v*']`, and `versionFromTag` requires a leading `v`.
  // Flip this and the tag is cut but nothing publishes.
  it('cuts the tag without the component prefix', () => {
    const root = config as Record<string, unknown>
    expect(root['include-component-in-tag']).toBe(false)
  })

  it("the manifest's keys exactly equal the config's packages keys", () => {
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(config.packages).sort())
  })

  // Seeded to the last version genuinely published, with zero git tags in
  // the repo to collide with. See the README's "Releasing" section for the
  // one-time `Release-As` footer this composes with.
  it('seeds the manifest at the last version actually published', () => {
    expect(manifest['.']).toBe('1.2.1')
  })
})
