import { readFileSync } from 'node:fs'

/**
 * The example models live as real `.ts` files next to this one, so `tsc`
 * checks that they are valid TypeScript and a developer can paste them
 * verbatim into the panel. Tests read them as source text from here.
 *
 * Not exported from the package: this is a test-and-docs convenience, and
 * it reaches for the filesystem.
 */
export type ModelFixture = 'simple' | 'medium' | 'complex'

export function readModel(name: ModelFixture): string {
  return readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8')
}
