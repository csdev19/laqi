/**
 * Deriving the npm dist-tag from the version.
 *
 * `npm publish` tags a version `latest` unless told otherwise — it does NOT
 * infer anything from a `-beta` suffix. Publishing 2.0.0-beta.0 without an
 * explicit `--tag` would therefore hand the beta to everyone still running
 * `npx laqi` against the 1.2.1 published in 2022. See ADR-0010.
 */

const SEMVER =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/** The npm dist-tag a version should be published under. */
export function distTagFor(version: string): string {
  const match = SEMVER.exec(version)
  if (!match?.groups) {
    throw new Error(`${JSON.stringify(version)} is not a valid semver version`)
  }

  const { prerelease } = match.groups
  if (prerelease === undefined) return 'latest'

  // `2.0.0-beta.1` -> `beta`. The counter is not part of the tag name, or
  // every beta would land on its own tag and `laqi@beta` would resolve to
  // nothing.
  const identifier = prerelease.split('.')[0]
  if (/^\d+$/.test(identifier)) {
    throw new Error(
      `${JSON.stringify(version)} has a numeric prerelease identifier (${identifier}); ` +
        'npm rejects a dist-tag that parses as a version. Name the prerelease, e.g. -beta.1',
    )
  }

  // `latest` is the one tag this whole module exists to protect: a
  // prerelease whose identifier IS `latest` must never come back looking
  // like an ordinary tag name, or it would silently replace the 1.2.1 that
  // every `npx laqi` user gets today. Compared case-insensitively — npm
  // dist-tags are case-sensitive, so `LATEST` would not literally collide
  // with `latest`, but a tag named `LATEST` sitting beside `latest` is a
  // trap for whoever reads the tag list next.
  if (identifier.toLowerCase() === 'latest') {
    throw new Error(
      `${JSON.stringify(version)} has a prerelease identifier (${identifier}) that reads as ` +
        '"latest"; that would publish over the tag every existing user resolves. ' +
        'Name the prerelease something else, e.g. -beta.1',
    )
  }

  // npm refuses a dist-tag that parses as a valid semver version or range
  // (`v1`, `1`, `2.0`, `x`, `X`, `*`). Reject those here rather than fail at
  // publish time.
  if (/^[vV]?\d/.test(identifier) || /^[xX*]$/.test(identifier)) {
    throw new Error(
      `${JSON.stringify(version)} has a prerelease identifier (${identifier}) that npm would ` +
        'read as a version or a range; it rejects a dist-tag like that. ' +
        'Name the prerelease something else, e.g. -beta.1',
    )
  }

  return identifier
}

/** The version carried by a release tag: `v2.0.0-beta.0` -> `2.0.0-beta.0`. */
export function versionFromTag(tag: string): string {
  if (!tag.startsWith('v')) {
    throw new Error(`release tag ${JSON.stringify(tag)} must start with "v"`)
  }

  const version = tag.slice(1)
  if (!SEMVER.test(version)) {
    throw new Error(`${JSON.stringify(version)} is not a valid semver version`)
  }

  return version
}
