import { Effect } from 'effect'
import { GenerateError } from './errors'
import { numberRules, STRING_RULES } from './field-rules'
import { FakerFactory } from './services/faker'
import { generateRuntime } from './services/runtime'
import type { PrimitiveType, Shape } from './shape'

/** Fixed reference date: with a seed, output must be byte-reproducible. */
const REF_DATE = '2026-01-01T00:00:00.000Z'
const DEFAULT_ARRAY_LENGTH = 3

/** Exactly what a record emits, whatever `arrayLength` says. Characterised, not chosen. */
const RECORD_KEYS = 2

/**
 * A hard ceiling on the total number of values a single generation may
 * produce. Nested arrays amplify multiplicatively — `arrayLength ^ depth` —
 * so a small, legal-looking model (`string[][][]` at `arrayLength: 100`) can
 * otherwise blow up to `100^3 = 1,000,000` leaf values from 20 bytes of
 * input, blocking the (single-threaded) server for seconds on one request.
 * 100_000 is generous for legitimate use (e.g. 1000 items × 20 fields = 20k)
 * and fatal to the amplification case.
 */
export const MAX_GENERATED_VALUES = 100_000

export type GenerateOptions = { seed?: number; arrayLength?: number }

/** A literal a plan may pick from. Wider than `Shape`'s, which has no null. */
export type PlanLiteral = string | number | boolean | null

export type PlanField = { name: string; plan: Plan; optional: boolean }

/**
 * The rules the generator executes.
 *
 * A plan is ephemeral: it is built from a `Shape` or compiled from a JSON
 * Schema document, executed, and dropped. It is never persisted and never
 * exported, which is why it may say things neither of its two sources can —
 * a numeric range, a string length, a choice between alternatives.
 *
 * Every node of a plan built by `liftShape` carries no constraints at all,
 * which is what makes "compiling `shapeToJsonSchema(shape)` reproduces
 * `liftShape(shape)`" a statement a test can check by equality.
 */
export type Plan =
  | { kind: 'object'; fields: PlanField[] }
  | { kind: 'array'; items: Plan }
  | { kind: 'tuple'; items: Plan[] }
  | { kind: 'record'; values: Plan }
  | { kind: 'literals'; values: PlanLiteral[] }
  | { kind: 'primitive'; type: PrimitiveType }
  | { kind: 'choice'; options: Plan[] }
  | { kind: 'unknown' }

/**
 * A `Shape` is a plan with nothing added. Total and lossless: every `Shape`
 * kind has the same name and the same meaning as a plan node.
 */
export function liftShape(shape: Shape): Plan {
  switch (shape.kind) {
    case 'object':
      return {
        kind: 'object',
        fields: shape.fields.map((field) => ({
          name: field.name,
          plan: liftShape(field.shape),
          optional: field.optional,
        })),
      }
    case 'array':
      return { kind: 'array', items: liftShape(shape.items) }
    case 'tuple':
      return { kind: 'tuple', items: shape.items.map(liftShape) }
    case 'record':
      return { kind: 'record', values: liftShape(shape.values) }
    case 'literals':
      return { kind: 'literals', values: [...shape.values] }
    case 'primitive':
      return { kind: 'primitive', type: shape.type }
    case 'unknown':
      return { kind: 'unknown' }
  }
}

/**
 * Thrown internally (never exported) from inside the synchronous, plain-JS
 * recursion below when the per-call budget is exhausted. Caught once, at the
 * `Effect.try` boundary, and turned into a proper `GenerateError` — Effect
 * never sees a bare throw.
 */
class BudgetExceededError extends Error {}

/**
 * Plan → data. faker (seeded) provides the values; the field-name rules make
 * them look real.
 *
 * Unlike `generateEffect`, this does not validate its input: a plan is built
 * inside this package, by `liftShape` (whose `Shape` was validated) or by the
 * schema compiler (whose document was validated). It never crosses a JSON
 * boundary, so there is no untrusted plan to guard against.
 */
export const generateFromPlanEffect = (
  plan: Plan,
  options: GenerateOptions = {},
): Effect.Effect<unknown, GenerateError, FakerFactory> =>
  Effect.gen(function* () {
    // faker arrives as a service: the layer owns the dynamic import, and a
    // test can hand this program a failing loader without touching the
    // module loader. Its load failure is mapped here so this program's
    // error channel stays exactly `GenerateError`.
    const newFaker = yield* Effect.mapError(
      yield* FakerFactory,
      (cause) => new GenerateError({ message: cause.message }),
    )
    const faker = newFaker()
    if (options.seed !== undefined) {
      faker.seed(options.seed)
      faker.setDefaultRefDate(REF_DATE)
    }

    // `Math.max`/`Math.min` propagate a NaN input straight through (any
    // arithmetic comparison touching NaN is neither the min nor the max),
    // so a NaN arrayLength used to escape the 1..1000 clamp as NaN itself,
    // and `Array.from({length: NaN})` silently reads that as length 0 — an
    // empty array with no error. Guard `Number.isFinite` first so any
    // non-finite input (NaN, ±Infinity) falls back to the default instead
    // of reaching the arithmetic at all.
    const requestedArrayLength = options.arrayLength
    const clampedArrayLength = Number.isFinite(requestedArrayLength)
      ? Math.max(1, Math.min(requestedArrayLength as number, 1000))
      : DEFAULT_ARRAY_LENGTH
    const idCounters = new Map<string, number>()

    // Per-call budget (a local, not a module-level global) so concurrent
    // requests can never interfere with each other's counters — same
    // pattern as `idCounters` above. Every value produced, container or
    // leaf, counts against it; exceeding it aborts the whole generation
    // rather than silently truncating (silent truncation would hand the
    // caller wrong data with no signal).
    let produced = 0
    function bump(): void {
      produced++
      if (produced > MAX_GENERATED_VALUES) {
        throw new BudgetExceededError(
          `this model would generate more than ${MAX_GENERATED_VALUES} values; ` +
            `reduce arrayLength or the nesting depth`,
        )
      }
    }

    function valueFor(node: Plan, fieldName: string): unknown {
      bump()
      switch (node.kind) {
        case 'object':
          return Object.fromEntries(node.fields.map((f) => [f.name, valueFor(f.plan, f.name)]))
        case 'array':
          return Array.from({ length: clampedArrayLength }, () => valueFor(node.items, fieldName))
        case 'tuple':
          // Exactly one value per element plan, in order — arrayLength does
          // not apply here, arity comes from the tuple itself. This is the
          // whole point of the `tuple` kind: unlike `array`, a tuple's
          // length is fixed data, not a generation parameter.
          return node.items.map((item) => valueFor(item, fieldName))
        case 'record':
          return Object.fromEntries(
            Array.from({ length: RECORD_KEYS }, () => [
              faker.lorem.word(),
              valueFor(node.values, ''),
            ]),
          )
        case 'literals':
          return faker.helpers.arrayElement(node.values)
        case 'choice':
          return valueFor(faker.helpers.arrayElement(node.options), fieldName)
        case 'unknown':
          return null
        case 'primitive':
          return primitiveFor(node.type, fieldName)
      }
    }

    function primitiveFor(type: PrimitiveType, fieldName: string): unknown {
      if (type === 'null') return null
      if (type === 'boolean') return faker.datatype.boolean()
      if (type === 'date') return faker.date.recent({ days: 90 }).toISOString()

      if (type === 'integer' || type === 'number') {
        const rules = numberRules(idCounters, fieldName, type)
        const rule = rules.find((r) => r.when(fieldName))!
        return rule.use(faker)
      }

      const rule = STRING_RULES.find((r) => r.when(fieldName))!
      return rule.use(faker)
    }

    return yield* Effect.try({
      try: () => valueFor(plan, ''),
      catch: (e) =>
        e instanceof BudgetExceededError
          ? new GenerateError({ message: e.message })
          : new GenerateError({ message: String(e) }),
    })
  })

/** Promise facade over the plan executor. Resolves with plain JSON-serialisable data. */
export async function generateFromPlan(
  plan: Plan,
  options: GenerateOptions = {},
): Promise<unknown> {
  return generateRuntime().runPromise(generateFromPlanEffect(plan, options))
}
