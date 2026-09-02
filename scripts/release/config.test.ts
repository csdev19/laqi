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
  'separate-pull-requests',
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
    const site = config.packages['apps/site'] as Record<string, unknown>
    for (const scope of [root, pkg, site]) {
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

  // `include-component-in-tag: false` on the CLI package is what makes
  // release-please cut a bare `v2.0.0` tag instead of
  // `laqi-monorepo-v2.0.0`. It is the only link between the tag and the
  // publish workflow: `release-npm.yml` matches on `tags: ['v*']`, and
  // `versionFromTag` requires a leading `v`. Flip this and the tag is cut
  // but nothing publishes.
  it('cuts the CLI tag without the component prefix', () => {
    const pkg = config.packages['.'] as Record<string, unknown>
    expect(pkg['include-component-in-tag']).toBe(false)
  })

  // The site deploys from its tag alone: `deploy-site.yml` matches
  // `tags: ['site-v*']`, so the component prefix must be present and must
  // be exactly `site`. And `site-v*` must never reach release-npm — its
  // `v*` glob only matches refs starting with `v`, which the prefix
  // guarantees.
  it('cuts the site tag as site-v*', () => {
    const site = config.packages['apps/site'] as Record<string, unknown>
    expect(site.component).toBe('site')
    expect(site['include-component-in-tag']).toBe(true)
  })

  // One release PR per component: merging the site release can never cut
  // the CLI tag in the same motion, and vice versa.
  it('keeps each component in its own release PR', () => {
    const root = config as Record<string, unknown>
    expect(root['separate-pull-requests']).toBe(true)
  })

  it("the manifest's keys exactly equal the config's packages keys", () => {
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(config.packages).sort())
  })

  // These started as seed assertions pinning the bootstrap values (1.2.1 and
  // 0.0.1). A seed is true exactly once: the first release rewrites it, so
  // the assertion fails precisely when the pipeline works. What is durably
  // true is the shape — plain semver, and never a prerelease, which is the
  // 2026-08-29 ruling restated where release-please would otherwise be free
  // to route a publish to a prerelease dist-tag.
  it('holds a plain, non-prerelease version for every package', () => {
    for (const [path, version] of Object.entries(manifest)) {
      expect(version, `${path} is not plain semver`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })
})
