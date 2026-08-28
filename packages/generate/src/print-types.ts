import { Effect } from 'effect'
import { PrintError } from './errors'
import { shapeToJsonSchema } from './json-schema'
import type { Shape } from './shape'

/**
 * Shape → source code in any of quicktype's target languages, through the
 * JSON Schema bridge. quicktype touches ONLY this printing arrow: parsing
 * and data generation never depend on it, so it stays swappable.
 *
 * Dynamic import: quicktype-core is heavy and startup must not pay for it
 * when printing is never used.
 *
 * Tuple handling (spike-verified against quicktype-core 26, both the
 * 2020-12 `prefixItems`/`items:false` form this bridge emits and the older
 * `items: [...]` tuple form): quicktype does NOT render a fixed-arity,
 * per-position tuple type in any target language. It reads `[string,
 * number]` as "an array of at least 2 items, each `string | number`" and
 * renders e.g. TypeScript's `[number | string, number | string,
 * ...(number | string)[]]`, Python's `list[float | str]`, Go's a struct
 * with two optional pointer fields — never two distinct positional types.
 * `items: false` (meant to close the tuple against extra elements) is
 * silently ignored rather than erroring.
 *
 * This is an acceptable degradation for the TYPES path only, per the
 * controller ruling: a union-typed array still type-checks against the
 * real data and is honest about "there's more than one shape of element
 * here" even though it loses per-position precision and arity. It must
 * NEVER be allowed to leak into the DATA path — `generate()` computes
 * tuples directly from the Shape IR (exact length, exact per-position
 * type) and never routes through this JSON Schema bridge at all.
 */
export const printTypesEffect = (
  shape: Shape,
  options: { typeName: string; lang?: string },
): Effect.Effect<{ code: string; language: string }, PrintError> =>
  Effect.gen(function* () {
    const {
      quicktype,
      InputData,
      JSONSchemaInput,
      FetchingJSONSchemaStore,
      defaultTargetLanguages,
      isLanguageName,
    } = yield* Effect.tryPromise({
      try: () => import('quicktype-core'),
      catch: (e) => new PrintError({ message: String(e) }),
    })

    const requested = options.lang ?? 'typescript'
    // Each language's `name` is `names[0]` (per quicktype-core's own docs), so
    // this type guard alone covers both the canonical name and its aliases —
    // and it narrows `requested` to quicktype's LanguageName union for us.
    if (!isLanguageName(requested)) {
      const names = defaultTargetLanguages.map((l) => l.name).join(', ')
      return yield* Effect.fail(
        new PrintError({
          message: `unknown language ${JSON.stringify(requested)} — supported: ${names}`,
        }),
      )
    }
    const lang = requested

    const { code } = yield* Effect.tryPromise({
      try: async () => {
        const input = new JSONSchemaInput(new FetchingJSONSchemaStore())
        await input.addSource({
          name: options.typeName,
          schema: JSON.stringify(shapeToJsonSchema(shape)),
        })
        const inputData = new InputData()
        inputData.addInput(input)

        const result = await quicktype({
          inputData,
          lang,
          rendererOptions: { 'just-types': 'true' },
        })
        return { code: result.lines.join('\n') }
      },
      catch: (e) => new PrintError({ message: String(e) }),
    })

    return { code, language: lang }
  })

/**
 * Promise facade preserving the plan's exact contract: resolves with the
 * printed code, rejects (via Effect's FiberFailure, whose message carries
 * the PrintError text) on an unknown language or a quicktype failure.
 */
export async function printTypes(
  shape: Shape,
  options: { typeName: string; lang?: string },
): Promise<{ code: string; language: string }> {
  return Effect.runPromise(printTypesEffect(shape, options))
}

/** All languages quicktype can target — no meaningful failure branch, so plain async. */
export async function supportedLanguages(): Promise<{ name: string; displayName: string }[]> {
  const { defaultTargetLanguages } = await import('quicktype-core')
  return defaultTargetLanguages.map((l) => ({ name: l.name, displayName: l.displayName }))
}
