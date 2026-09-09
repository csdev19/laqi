import { Effect } from 'effect'
import { GenerateError } from './errors'
import { generateFromPlanEffect, liftShape, type GenerateOptions } from './plan'
import { FakerFactory } from './services/faker'
import { generateRuntime } from './services/runtime'
import { validateShape, type Shape } from './shape'

export { ruleFor, type FieldRule } from './field-rules'
export { MAX_GENERATED_VALUES } from './plan'

/**
 * Shape → data.
 *
 * A `Shape` is lifted to a generation plan and executed. The lift adds
 * nothing: everything about how a value is chosen — the field-name rules,
 * the seeded faker, the array length, the value budget — belongs to the plan
 * executor, and is shared with schema-compiled plans.
 */
export const generateEffect = (
  shape: Shape,
  options: GenerateOptions = {},
): Effect.Effect<unknown, GenerateError, FakerFactory> =>
  Effect.gen(function* () {
    // `Shape` is a compile-time union only. This is the last boundary
    // before values are produced, and the contract downstream is plain
    // JSON — so the shape is checked for real here rather than trusted.
    // A JS consumer, a future JSON boundary, or a hand-built shape would
    // otherwise reach faker and fail opaquely (an empty literal union) or
    // silently (an unrecognised kind, which falls off the switch as
    // `undefined`).
    const invalid = validateShape(shape)
    if (invalid) return yield* Effect.fail(new GenerateError({ message: invalid }))

    return yield* generateFromPlanEffect(liftShape(shape), options)
  })

/**
 * Promise facade preserving today's exact contract: resolves with plain
 * JSON-serialisable data, rejects on failure (e.g. faker failing to load).
 */
export async function generate(shape: Shape, options: GenerateOptions = {}): Promise<unknown> {
  return generateRuntime().runPromise(generateEffect(shape, options))
}
