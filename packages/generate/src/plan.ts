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

/** Numeric bounds a document asserted. Absent means the field-name rules decide. */
export type NumberRule = { minimum?: number; maximum?: number; multipleOf?: number }

/** The string formats laqi generates. `date-time` is not here: it is the `date` primitive. */
export type TextFormat = 'date' | 'email' | 'uri' | 'uuid'

export type TextRule = { minLength?: number; maxLength?: number; format?: TextFormat }

export type ItemsRule = { min?: number; max?: number; unique?: boolean }

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
  | { kind: 'array'; items: Plan; length?: ItemsRule }
  | { kind: 'tuple'; items: Plan[] }
  | { kind: 'record'; values: Plan }
  | { kind: 'literals'; values: PlanLiteral[] }
  | { kind: 'primitive'; type: PrimitiveType; number?: NumberRule; text?: TextRule }
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
 * Raised when the plan's own constraints admit no value — bounds that cross,
 * a multipleOf with no multiple in range, more distinct items than the
 * element schema can produce. Generating something wrong would be worse
 * than failing, so this stops the call.
 */
class UnsatisfiableError extends Error {}

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
          return arrayFor(node, fieldName)
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
          return primitiveFor(node, fieldName)
      }
    }

    function arrayFor(node: Plan & { kind: 'array' }, fieldName: string): unknown {
      const rule = node.length
      const length = rule
        ? Math.max(rule.min ?? 1, Math.min(clampedArrayLength, rule.max ?? clampedArrayLength))
        : clampedArrayLength

      if (!rule?.unique) {
        return Array.from({ length }, () => valueFor(node.items, fieldName))
      }

      // Distinctness is compared on the serialised value, so two objects
      // with the same contents count as one — which is what `uniqueItems`
      // means. The attempt ceiling keeps a plan that cannot produce enough
      // distinct values (five unique booleans) from spinning; failing is
      // the honest answer, since a short array would break the document
      // that asked for the length.
      const seen = new Map<string, unknown>()
      for (let attempt = 0; attempt < length * 20 && seen.size < length; attempt++) {
        const candidate = valueFor(node.items, fieldName)
        seen.set(JSON.stringify(candidate) ?? 'undefined', candidate)
      }
      if (seen.size < length) {
        throw new UnsatisfiableError(
          `this array asks for ${length} distinct items, and its element schema does not have that many`,
        )
      }
      return [...seen.values()]
    }

    function primitiveFor(node: Plan & { kind: 'primitive' }, fieldName: string): unknown {
      const type = node.type
      if (type === 'null') return null
      if (type === 'boolean') return faker.datatype.boolean()
      if (type === 'date') return faker.date.recent({ days: 90 }).toISOString()

      if (type === 'integer' || type === 'number') {
        // A document's bounds are an assertion about the data; a field-name
        // rule is only a cosmetic guess. So the bounds win where both apply.
        if (node.number) return boundedNumber(node.number, type)
        const rules = numberRules(idCounters, fieldName, type)
        const rule = rules.find((r) => r.when(fieldName))!
        return rule.use(faker)
      }

      if (node.text) return constrainedText(node.text)
      const rule = STRING_RULES.find((r) => r.when(fieldName))!
      return rule.use(faker)
    }

    function boundedNumber(rule: NumberRule, type: 'number' | 'integer'): number {
      const min = rule.minimum ?? 0
      const max = rule.maximum ?? min + 1000

      if (rule.multipleOf !== undefined) {
        const step = rule.multipleOf
        const lowest = Math.ceil(min / step)
        const highest = Math.floor(max / step)
        if (lowest > highest) {
          throw new UnsatisfiableError(`no multiple of ${step} lies between ${min} and ${max}`)
        }
        return faker.number.int({ min: lowest, max: highest }) * step
      }

      if (min > max) {
        throw new UnsatisfiableError(`no value lies between ${min} and ${max}`)
      }
      return type === 'integer'
        ? faker.number.int({ min: Math.ceil(min), max: Math.floor(max) })
        : faker.number.float({ min, max, fractionDigits: 2 })
    }

    function constrainedText(rule: TextRule): string {
      const formatted = rule.format ? textForFormat(rule.format) : undefined
      // A length asserted by the document wins over the shape of a format:
      // a truncated uuid still satisfies maxLength, an over-long one does
      // not satisfy the document at all.
      if (rule.minLength === undefined && rule.maxLength === undefined) {
        return formatted ?? faker.lorem.words(2)
      }
      const min = rule.minLength ?? 0
      const max = Math.max(min, rule.maxLength ?? Math.max(min, 12))
      const base = formatted ?? faker.string.alpha({ length: { min: max, max } })
      return base.length > max
        ? base.slice(0, max)
        : base.padEnd(min, faker.string.alpha({ length: 1 }))
    }

    function textForFormat(format: TextFormat): string {
      switch (format) {
        case 'date':
          return faker.date.recent({ days: 90 }).toISOString().slice(0, 10)
        case 'email':
          return faker.internet.email()
        case 'uri':
          return faker.internet.url()
        case 'uuid':
          return faker.string.uuid()
      }
    }

    return yield* Effect.try({
      try: () => valueFor(plan, ''),
      catch: (e) =>
        e instanceof BudgetExceededError || e instanceof UnsatisfiableError
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
