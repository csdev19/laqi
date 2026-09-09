import { createHash } from 'node:crypto'

/**
 * The body, serialised so that two bodies which are the same JSON value
 * produce the same bytes. For hashing only — never for storage, where the
 * writer's own layout applies.
 *
 * Object keys are sorted by UTF-16 code units at every depth; array order is
 * data and is kept. `toJSON` is honoured and `undefined` properties are
 * dropped, because both are what writing the body would do — the hash has to
 * describe the bytes on disk, not the object that produced them.
 *
 * Returns `undefined` for a body that is absent, which is not the same as a
 * body that is `null`.
 */
export function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(inner).toSorted()) {
      sorted[key] = (inner as Record<string, unknown>)[key]
    }
    return sorted
  })
}

/**
 * The fingerprint stored in a response's generation evidence, so a later
 * edit to the body can be told from the bytes laqi wrote.
 *
 * An absent body hashes the empty string and a `null` body hashes `null`, so
 * "there was no body" and "the body was null" never collide.
 */
export function bodyHash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value) ?? '', 'utf8')
    .digest('hex')
}
