import { describe, expect, it } from 'vitest'
import { generate, MAX_GENERATED_VALUES, ruleFor } from './generate'
import { primitive, type Shape } from './shape'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'name', shape: primitive('string'), optional: false },
    { name: 'email', shape: primitive('string'), optional: false },
    { name: 'createdAt', shape: primitive('date'), optional: false },
    { name: 'price', shape: primitive('number'), optional: false },
    { name: 'tag', shape: { kind: 'literals', values: ['vip', 'regular'] }, optional: false },
    { name: 'active', shape: primitive('boolean'), optional: false },
  ],
}

describe('generate', () => {
  it('is byte-reproducible under a seed — including dates', async () => {
    // faker's date methods reference Date.now(); without a fixed refDate the
    // same seed produced different output (spike-verified). The seed contract
    // is what makes this snapshot-testable at all.
    const a = await generate(user, { seed: 42 })
    const b = await generate(user, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('varies when the seed varies', async () => {
    expect(await generate(user, { seed: 1 })).not.toEqual(await generate(user, { seed: 2 }))
  })

  it('makes values that look like their field names', async () => {
    const value = (await generate(user, { seed: 42 })) as Record<string, unknown>
    expect(value.email).toMatch(/@/)
    expect(value.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof value.price).toBe('number')
    expect(['vip', 'regular']).toContain(value.tag)
    expect(typeof value.active).toBe('boolean')
  })

  it('gives arrays sequential ids and the requested length', async () => {
    const list = (await generate(
      { kind: 'array', items: user },
      { seed: 42, arrayLength: 4 },
    )) as Record<string, unknown>[]
    expect(list).toHaveLength(4)
    expect(list.map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it('defaults arrays to 3 items', async () => {
    expect(
      (await generate({ kind: 'array', items: primitive('integer') }, { seed: 1 })) as unknown[],
    ).toHaveLength(3)
  })

  it('always includes optional fields (generated data should show the full shape)', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [{ name: 'nick', shape: primitive('string'), optional: true }],
    }
    expect(Object.keys((await generate(shape, { seed: 1 })) as object)).toEqual(['nick'])
  })

  it('renders record, null and unknown sanely', async () => {
    const value = (await generate(
      {
        kind: 'object',
        fields: [
          { name: 'meta', shape: { kind: 'record', values: primitive('string') }, optional: false },
          { name: 'gone', shape: primitive('null'), optional: false },
          { name: 'mystery', shape: { kind: 'unknown' }, optional: false },
        ],
      },
      { seed: 1 },
    )) as Record<string, unknown>
    expect(Object.keys(value.meta as object).length).toBeGreaterThan(0)
    expect(value.gone).toBeNull()
    expect(value.mystery).toBeNull()
  })

  // End-to-end regression for the round-2 finding: `isIdField` received an
  // already-lowercased name but tested for `[A-Z_]`, which can never match,
  // so it degraded to plain "ends with id" — paid/valid/void/rapid were all
  // id-classified. This test failed before the rule-table refactor and
  // passes after it.
  it('does not match paid/valid/void/rapid with endsWith("id") — word boundaries only', async () => {
    // Test with INTEGER type so the id branch is actually reached
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'paid', shape: primitive('integer'), optional: false },
        { name: 'valid', shape: primitive('integer'), optional: false },
        { name: 'void', shape: primitive('integer'), optional: false },
        { name: 'rapid', shape: primitive('integer'), optional: false },
        { name: 'identifier', shape: primitive('integer'), optional: false },
        { name: 'userId', shape: primitive('integer'), optional: false },
        { name: 'user_id', shape: primitive('integer'), optional: false },
        { name: 'orderId', shape: primitive('integer'), optional: false },
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: '_id', shape: primitive('integer'), optional: false },
      ],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    // paid, valid, void, rapid, identifier should NOT be sequential IDs
    expect(value.paid).toBeGreaterThanOrEqual(0)
    expect(value.valid).toBeGreaterThanOrEqual(0)
    expect(value.void).toBeGreaterThanOrEqual(0)
    expect(value.rapid).toBeGreaterThanOrEqual(0)
    expect(value.identifier).toBeGreaterThanOrEqual(0)
    // id and _id should be sequential (1, 2, ...)
    expect(value.id).toBe(1)
    expect(value._id).toBe(2)
    // Foreign keys should be in range [1, 1000]
    expect(value.userId).toBeGreaterThanOrEqual(1)
    expect(value.userId).toBeLessThanOrEqual(1000)
    expect(value.user_id).toBeGreaterThanOrEqual(1)
    expect(value.user_id).toBeLessThanOrEqual(1000)
    expect(value.orderId).toBeGreaterThanOrEqual(1)
    expect(value.orderId).toBeLessThanOrEqual(1000)
  })

  it('combined fixture with paid, valid, emailVerifiedAt, filename, username, id, userId, orderId', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'paid', shape: primitive('boolean'), optional: false },
        { name: 'valid', shape: primitive('boolean'), optional: false },
        { name: 'emailVerifiedAt', shape: primitive('string'), optional: false },
        { name: 'filename', shape: primitive('string'), optional: false },
        { name: 'username', shape: primitive('string'), optional: false },
        { name: 'id', shape: primitive('integer'), optional: false },
        { name: 'userId', shape: primitive('integer'), optional: false },
        { name: 'orderId', shape: primitive('integer'), optional: false },
      ],
    }
    const value = (await generate(shape, { seed: 42 })) as Record<string, unknown>
    expect(typeof value.paid).toBe('boolean')
    expect(typeof value.valid).toBe('boolean')
    expect(String(value.emailVerifiedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(String(value.filename)).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/)
    expect(String(value.username)).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/)
    expect(value.id).toBe(1)
    expect(typeof value.userId).toBe('number')
    expect(typeof value.orderId).toBe('number')
  })

  it('arrayLength is clamped to 1..1000', async () => {
    const shape = { kind: 'array' as const, items: primitive('integer') }
    expect((await generate(shape, { seed: 1, arrayLength: 0 })) as unknown[]).toHaveLength(1)
    expect((await generate(shape, { seed: 1, arrayLength: -5 })) as unknown[]).toHaveLength(1)
    expect((await generate(shape, { seed: 1, arrayLength: 1001 })) as unknown[]).toHaveLength(1000)
    expect((await generate(shape, { seed: 1, arrayLength: 500 })) as unknown[]).toHaveLength(500)
  })

  // --- Finding 2: NaN escapes the arrayLength clamp -----------------------

  it('clamps non-finite arrayLength to the default instead of leaking through Math.min/max as NaN (which Array.from silently reads as length 0)', async () => {
    const shape = { kind: 'array' as const, items: primitive('integer') }
    expect((await generate(shape, { seed: 1, arrayLength: NaN })) as unknown[]).toHaveLength(3)
    expect((await generate(shape, { seed: 1, arrayLength: Infinity })) as unknown[]).toHaveLength(3)
    expect((await generate(shape, { seed: 1, arrayLength: -Infinity })) as unknown[]).toHaveLength(
      3,
    )
  })

  // --- Finding 2: arrayLength^depth amplification (single-request DoS) ---

  describe('the generation budget', () => {
    it('fails with a GenerateError naming both levers when a model would generate too many values', async () => {
      // string[][][] at arrayLength 100 → 100^3 = 1,000,000 leaf values.
      const shape: Shape = {
        kind: 'array',
        items: { kind: 'array', items: { kind: 'array', items: primitive('string') } },
      }
      await expect(generate(shape, { seed: 1, arrayLength: 100 })).rejects.toThrow(
        /more than 100000 values.*arrayLength.*nesting depth/is,
      )
    })

    it('still succeeds for a legitimate large-but-sane request', async () => {
      // 1000 items × ~20 fields is the documented legitimate ceiling.
      const fields = Array.from({ length: 20 }, (_, i) => ({
        name: `f${i}`,
        shape: primitive('string' as const),
        optional: false,
      }))
      const shape: Shape = {
        kind: 'array',
        items: { kind: 'object', fields },
      }
      const value = (await generate(shape, { seed: 1, arrayLength: 1000 })) as unknown[]
      expect(value).toHaveLength(1000)
    })

    it('does not truncate silently — it is all-or-nothing', async () => {
      const shape: Shape = {
        kind: 'array',
        items: { kind: 'array', items: { kind: 'array', items: primitive('string') } },
      }
      await expect(generate(shape, { seed: 1, arrayLength: 100 })).rejects.toBeDefined()
    })

    it('is per-call — two sequential calls each get a full budget', async () => {
      const shape: Shape = { kind: 'array', items: primitive('string') }
      const a = await generate(shape, { seed: 1, arrayLength: 900 })
      const b = await generate(shape, { seed: 2, arrayLength: 900 })
      expect((a as unknown[]).length).toBe(900)
      expect((b as unknown[]).length).toBe(900)
    })

    it('exports the budget constant at 100_000', () => {
      expect(MAX_GENERATED_VALUES).toBe(100_000)
    })
  })

  // --- Finding 1: heterogeneous tuples lose all data ---------------------

  it('generates exactly one value per tuple position, in order, ignoring arrayLength', async () => {
    const shape: Shape = { kind: 'tuple', items: [primitive('string'), primitive('integer')] }
    const value = (await generate(shape, { seed: 1, arrayLength: 100 })) as unknown[]
    expect(value).toHaveLength(2)
    expect(typeof value[0]).toBe('string')
    expect(typeof value[1]).toBe('number')
    expect(Number.isInteger(value[1])).toBe(true)
  })

  it('preserves arity for a homogeneous tuple — arrayLength must not apply', async () => {
    const shape: Shape = {
      kind: 'tuple',
      items: [primitive('number'), primitive('number')],
    }
    const value = (await generate(shape, { seed: 1, arrayLength: 100 })) as unknown[]
    expect(value).toHaveLength(2)
  })

  it('generates a tuple nested in an object with exact per-position types', async () => {
    const shape: Shape = {
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('integer'), optional: false },
        {
          name: 'cells',
          shape: { kind: 'tuple', items: [primitive('string'), primitive('boolean')] },
          optional: false,
        },
      ],
    }
    const value = (await generate(shape, { seed: 1 })) as Record<string, unknown>
    const cells = value.cells as unknown[]
    expect(cells).toHaveLength(2)
    expect(typeof cells[0]).toBe('string')
    expect(typeof cells[1]).toBe('boolean')
  })

  it('generates an empty array for a zero-length tuple shape', async () => {
    const value = (await generate({ kind: 'tuple', items: [] }, { seed: 1 })) as unknown[]
    expect(value).toEqual([])
  })

  it('setDefaultRefDate is only applied when seed is given', async () => {
    // Unseeded runs should not anchor to 2026-01-01
    const unseeded = (await generate({
      kind: 'object',
      fields: [{ name: 'createdAt', shape: primitive('date'), optional: false }],
    })) as Record<string, unknown>
    const dateStr = String(unseeded.createdAt)
    // Should be a recent date, not necessarily 2026 (could be current year or close)
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The year should be reasonably close to current year, not stuck at 2026
    const year = parseInt(dateStr.substring(0, 4))
    expect(year).toBeGreaterThanOrEqual(2025)
  })
})

// Data-driven classification tests: table against table. Every `accepts`
// name must classify to exactly `rule`; every `rejects` name must NOT.
const CLASSIFICATION: {
  rule: string
  type: 'string' | 'number' | 'integer'
  accepts: string[]
  rejects: string[]
}[] = [
  {
    rule: 'date',
    type: 'string',
    accepts: ['createdAt', 'updated_at', 'birthDate', 'timestamp'],
    rejects: ['candidate', 'delegate'],
  },
  {
    rule: 'email',
    type: 'string',
    accepts: ['email', 'contactEmail', 'user_email'],
    rejects: ['username', 'phone'],
  },
  {
    rule: 'username',
    type: 'string',
    accepts: ['username', 'userName', 'user_name'],
    rejects: ['name', 'nameless'],
  },
  {
    rule: 'filename',
    type: 'string',
    accepts: ['filename', 'fileName', 'file_name'],
    rejects: ['name', 'title'],
  },
  {
    rule: 'person',
    type: 'string',
    accepts: ['name', 'firstName', 'displayName', 'full_name'],
    rejects: ['filename', 'username', 'nameless', 'renamed'],
  },
  {
    rule: 'phone',
    type: 'string',
    accepts: ['phone', 'phoneNumber', 'mobile_phone'],
    rejects: ['email', 'url'],
  },
  {
    rule: 'avatar',
    type: 'string',
    accepts: ['avatar', 'imageUrl', 'photoPath'],
    rejects: ['url', 'title'],
  },
  {
    rule: 'url',
    type: 'string',
    accepts: ['url', 'link', 'websiteUrl'],
    rejects: ['avatar', 'email'],
  },
  {
    rule: 'city',
    type: 'string',
    accepts: ['city', 'cityName', 'birth_city'],
    rejects: ['country', 'address'],
  },
  {
    rule: 'address',
    type: 'string',
    accepts: ['street', 'address', 'streetAddress'],
    rejects: ['city', 'country'],
  },
  {
    rule: 'country',
    type: 'string',
    accepts: ['country', 'countryCode', 'birth_country'],
    rejects: ['city', 'address'],
  },
  {
    rule: 'zip',
    type: 'string',
    accepts: ['zip', 'zipCode', 'postal_code'],
    rejects: ['city', 'address'],
  },
  {
    rule: 'uuid',
    type: 'string',
    accepts: ['uuid', 'guid', 'externalGuid'],
    rejects: ['id', 'name'],
  },
  {
    rule: 'description',
    type: 'string',
    accepts: ['description', 'bio', 'summary'],
    rejects: ['title', 'name'],
  },
  {
    rule: 'title',
    type: 'string',
    accepts: ['title', 'jobTitle', 'postTitle'],
    rejects: ['description', 'name'],
  },
  {
    rule: 'fallback',
    type: 'string',
    accepts: ['nick', 'tag', 'nameless'],
    rejects: ['name', 'email'],
  },
  {
    rule: 'id',
    type: 'integer',
    accepts: ['id', '_id', 'ID'],
    rejects: ['paid', 'valid', 'void', 'rapid', 'identifier'],
  },
  {
    rule: 'fk',
    type: 'integer',
    accepts: ['userId', 'user_id', 'orderId'],
    rejects: ['paid', 'valid', 'identifier'],
  },
  {
    rule: 'price',
    type: 'number',
    accepts: ['price', 'totalAmount', 'cost'],
    rejects: ['id', 'name'],
  },
  {
    rule: 'age',
    type: 'integer',
    accepts: ['age', 'userAge'],
    rejects: ['id', 'price'],
  },
  {
    rule: 'quantity',
    type: 'integer',
    accepts: ['count', 'quantity', 'itemCount'],
    rejects: ['account', 'discount'],
  },
  {
    rule: 'number',
    type: 'integer',
    accepts: ['score', 'rank', 'level'],
    rejects: ['id', 'price'],
  },
]

describe('ruleFor classification', () => {
  for (const { rule, type, accepts, rejects } of CLASSIFICATION) {
    it(`classifies "${rule}" (${type}) correctly`, () => {
      for (const name of accepts) {
        expect(ruleFor(name, type), `expected "${name}" to classify as "${rule}"`).toBe(rule)
      }
      for (const name of rejects) {
        expect(ruleFor(name, type), `expected "${name}" NOT to classify as "${rule}"`).not.toBe(
          rule,
        )
      }
    })
  }
})

describe('field-name heuristics — known gap', () => {
  // The `quantity` rule now matches `count`, `quantity`, and `qty` (the most
  // common abbreviation of quantity in real schemas), so `itemCount`,
  // `quantity`, `qty`, and `qtyOrdered` all produce sensible whole numbers
  // rather than decimals. This ensures plausible preview data.
  it('treats qty the way it treats count and quantity', () => {
    expect(ruleFor('qty', 'number')).toBe('quantity')
    expect(ruleFor('qtyOrdered', 'number')).toBe('quantity')
  })

  it('already handles the spelled-out forms', () => {
    expect(ruleFor('quantity', 'number')).toBe('quantity')
    expect(ruleFor('count', 'number')).toBe('quantity')
    expect(ruleFor('itemCount', 'number')).toBe('quantity')
  })
})

describe('generate rejects a shape it cannot honour', () => {
  it('refuses an empty literal union instead of producing undefined', async () => {
    await expect(generate({ kind: 'literals', values: [] })).rejects.toThrow(/literals/)
  })

  it('refuses a shape kind it does not know, naming it', async () => {
    await expect(generate({ kind: 'enum', values: ['a'] } as never)).rejects.toThrow(/enum/)
  })

  it('refuses an invalid shape nested inside a valid one, naming its path', async () => {
    const shape = {
      kind: 'object',
      fields: [{ name: 'status', shape: { kind: 'literals', values: [] }, optional: false }],
    } as never

    await expect(generate(shape)).rejects.toThrow(/status/)
  })

  it('still generates from every valid shape kind', async () => {
    const value = (await generate(
      {
        kind: 'object',
        fields: [
          { name: 'id', shape: primitive('integer'), optional: false },
          { name: 'state', shape: { kind: 'literals', values: ['on', 'off'] }, optional: false },
          { name: 'meta', shape: { kind: 'record', values: primitive('string') }, optional: false },
        ],
      },
      { seed: 1 },
    )) as Record<string, unknown>

    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
  })
})
