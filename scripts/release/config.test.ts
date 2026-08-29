import { describe, expect, it } from 'vitest'
import config from '../../release-please-config.json'
import manifest from '../../.release-please-manifest.json'

// release-please's schema sets `additionalProperties: false` at the root, so
// a key that is valid but misplaced still passes `JSON.parse` and any
// schema-agnostic JSON-validity check — nothing short of pinning the
// structure catches it. This suite pins the shape the release topology
// depends on.
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

  // Ruled on 2026-08-29: no beta line. The first release is plain `2.0.0`,
  // computed from the seeded `1.2.1` plus the `feat!` that adopted the
  // pipeline (df765c9). A prerelease key sneaking back in would change the
  // computed version and route the publish to a prerelease dist-tag.
  it('carries no prerelease settings at any scope', () => {
    const root = config as Record<string, unknown>
    const pkg = config.packages['.'] as Record<string, unknown>
    for (const scope of [root, pkg]) {
      expect(scope['prerelease-type']).toBeUndefined()
      expect(scope.versioning).toBeUndefined()
      expect(scope.prerelease).toBeUndefined()
    }
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
  // the repo to collide with. From here, the `feat!` adoption commit makes
  // release-please compute `2.0.0` — no `Release-As` footer needed.
  it('seeds the manifest at the last version actually published', () => {
    expect(manifest['.']).toBe('1.2.1')
  })
})
