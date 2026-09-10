import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json'

/**
 * A fingerprint of one stored response, quoted back by a caller that wants
 * to replace something it has already looked at.
 *
 * Two agents and a person share these files. Between the moment the panel
 * renders a body and the moment someone presses Apply, the file may have
 * been rewritten by the other two — and a blind write would erase that
 * without either of them ever seeing it happen. The revision is how a write
 * says "the thing I decided about is still the thing on disk".
 *
 * It is per response, not per file: two people regenerating different
 * responses of the same endpoint are not in each other's way, and making
 * them conflict would train everyone to pass `confirm`.
 *
 * Computed from the RAW stored entry, never from a parsed `MockResponse`.
 * Validation strips unknown keys and can materialise absent optionals, so a
 * revision taken after a parse would disagree with one taken before it —
 * and a revision that disagrees with itself refuses every write.
 */
export function responseRevision(stored: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(stored) ?? '', 'utf8')
    .digest('hex')
}
