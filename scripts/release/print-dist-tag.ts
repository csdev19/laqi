#!/usr/bin/env bun
// Prints the dist-tag for a version, after checking it against the release
// tag when there is one. Used by .github/workflows/release-npm.yml.
//
//   bun scripts/release/print-dist-tag.ts 2.0.0-beta.0                 -> beta
//   bun scripts/release/print-dist-tag.ts 2.0.0-beta.0 v2.0.0-beta.0   -> beta
//   bun scripts/release/print-dist-tag.ts 2.0.0       v2.0.0-beta.0    -> exit 1
//
// The comparison lives here rather than in shell so it is covered by
// dist-tag.test.ts: a mismatch means extra-files did not run and the tarball
// would ship stamped with the wrong number.
import { distTagFor, versionFromTag } from './dist-tag'

const [, , version, tag] = process.argv

if (version === undefined) {
  console.error('usage: print-dist-tag.ts <version> [release-tag]')
  process.exit(1)
}

try {
  if (tag !== undefined) {
    const tagged = versionFromTag(tag)
    if (tagged !== version) {
      throw new Error(
        `tag ${tag} carries version ${tagged}, but apps/cli/package.json says ${version}`,
      )
    }
  }
  console.log(distTagFor(version))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
