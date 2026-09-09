/**
 * Field-name heuristics: the tables that make a generated body look like a
 * real one. They read a property's name and nothing else, so they are the
 * same whether the generation plan came from a TypeScript model or a JSON
 * Schema document.
 */
type Faker = import('@faker-js/faker').Faker

/**
 * One entry in a field-name → fake-value dispatch table. `when` decides
 * whether a field name matches this rule (it receives the ORIGINAL field
 * name, before any lowercasing, so camelCase/snake_case boundaries are still
 * visible); `use` produces the value once matched. Order in the owning array
 * is precedence: the first matching rule wins.
 */
export type FieldRule = {
  name: string
  when: (fieldName: string) => boolean
  use: (faker: Faker) => unknown
}

/** Splits a field name into lowercase words across camelCase and snake/kebab-case boundaries. */
function words(fieldName: string): string[] {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

/**
 * True when some word of the field name starts with one of the given
 * prefixes. Word-based (not raw substring) so `timestamp` matches `time`
 * while `candidate` does not match `date` — "date" is buried mid-word there,
 * not a word of its own.
 */
function hasWordStartingWith(fieldName: string, ...prefixes: string[]): boolean {
  const fieldWords = words(fieldName)
  return fieldWords.some((word) => prefixes.some((prefix) => word.startsWith(prefix)))
}

/** Field name collapsed to one lowercase token, separators stripped — for exact-name rules. */
function normalize(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[_\-\s]/g, '')
}

/**
 * String field rules, in precedence order. Date-ness runs first so fields
 * like `emailVerifiedAt` produce a date rather than an email; username and
 * filename run before the generic person-name rule so `userName`/`fileName`
 * (which contain the word "name") aren't mistaken for a person's name.
 */
export const STRING_RULES: FieldRule[] = [
  {
    name: 'date',
    when: (n) => n.endsWith('_at') || n.endsWith('At') || hasWordStartingWith(n, 'date', 'time'),
    use: (faker) => faker.date.recent({ days: 90 }).toISOString(),
  },
  {
    name: 'email',
    when: (n) => hasWordStartingWith(n, 'email'),
    use: (faker) => faker.internet.email(),
  },
  {
    name: 'username',
    when: (n) => normalize(n) === 'username',
    use: (faker) => faker.internet.username(),
  },
  {
    name: 'filename',
    when: (n) => normalize(n) === 'filename',
    use: (faker) => `${faker.lorem.slug()}.txt`,
  },
  {
    name: 'person',
    when: (n) =>
      ['name', 'firstname', 'lastname', 'fullname', 'displayname'].includes(normalize(n)),
    use: (faker) => faker.person.fullName(),
  },
  {
    name: 'phone',
    when: (n) => hasWordStartingWith(n, 'phone'),
    use: (faker) => faker.phone.number(),
  },
  {
    name: 'avatar',
    when: (n) => hasWordStartingWith(n, 'avatar', 'image', 'photo'),
    use: (faker) => faker.image.url(),
  },
  {
    name: 'url',
    when: (n) => hasWordStartingWith(n, 'url', 'link'),
    use: (faker) => faker.internet.url(),
  },
  {
    name: 'city',
    when: (n) => hasWordStartingWith(n, 'city'),
    use: (faker) => faker.location.city(),
  },
  {
    name: 'address',
    when: (n) => hasWordStartingWith(n, 'street', 'address'),
    use: (faker) => faker.location.streetAddress(),
  },
  {
    name: 'country',
    when: (n) => hasWordStartingWith(n, 'country'),
    use: (faker) => faker.location.country(),
  },
  {
    name: 'zip',
    when: (n) => hasWordStartingWith(n, 'zip', 'postal'),
    use: (faker) => faker.location.zipCode(),
  },
  {
    name: 'uuid',
    when: (n) => hasWordStartingWith(n, 'uuid', 'guid'),
    use: (faker) => faker.string.uuid(),
  },
  {
    name: 'description',
    when: (n) => hasWordStartingWith(n, 'description', 'bio', 'summary'),
    use: (faker) => faker.lorem.sentence(),
  },
  {
    name: 'title',
    when: (n) => hasWordStartingWith(n, 'title'),
    use: (faker) => faker.lorem.words(3),
  },
  {
    name: 'fallback',
    when: () => true,
    use: (faker) => faker.lorem.words(2),
  },
]

/**
 * Number/integer field rules, in precedence order. `id` and `fk` are tested
 * against the field's ORIGINAL casing: `/[a-z0-9]Id$/` (no `i` flag) matches
 * `userId`/`orderId` but not `paid`/`valid`/`void`/`rapid`/`identifier` —
 * those end in a lowercase "id", not a capital-I "Id" boundary.
 *
 * `counters` tracks per-field sequential ids across the whole generate()
 * call (so repeated `id` fields in an array stay 1, 2, 3, …); the key is the
 * normalized field name, so `id` and `_id` are treated as the same field and
 * share one sequence.
 */
export function numberRules(
  counters: Map<string, number>,
  fieldName: string,
  type: 'number' | 'integer',
): FieldRule[] {
  return [
    {
      name: 'id',
      when: (n) => /^_?id$/i.test(n),
      use: () => {
        const key = normalize(fieldName)
        const current = counters.get(key) ?? 1
        counters.set(key, current + 1)
        return current
      },
    },
    {
      name: 'fk',
      when: (n) => /_id$/i.test(n) || /[a-z0-9]Id$/.test(n),
      use: (faker) => faker.number.int({ min: 1, max: 1000 }),
    },
    {
      name: 'price',
      when: (n) => hasWordStartingWith(n, 'price', 'total', 'amount', 'cost'),
      use: (faker) => Number(faker.commerce.price()),
    },
    {
      name: 'age',
      when: (n) => hasWordStartingWith(n, 'age'),
      use: (faker) => faker.number.int({ min: 18, max: 80 }),
    },
    {
      name: 'quantity',
      // Matches count, quantity, qty and their compounds. `qty` is the most
      // common abbreviation in real schemas; `qtyOrdered` will also match because
      // its first word is `qty`, which starts with `qty`. We do NOT match `num`
      // prefixes (numItems, etc.) — that would risk false positives on `number`
      // and `numeric` fields, which are not quantities.
      when: (n) => hasWordStartingWith(n, 'count', 'quantity', 'qty'),
      use: (faker) => faker.number.int({ min: 0, max: 100 }),
    },
    {
      name: 'number',
      when: () => true,
      use: (faker) =>
        type === 'integer'
          ? faker.number.int({ min: 0, max: 1000 })
          : faker.number.float({ min: 0, max: 1000, fractionDigits: 2 }),
    },
  ]
}

/**
 * Classifies a field name against the string/number/integer rule tables
 * without generating a value. Returns the winning rule's stable `name`.
 * Used by tests to interrogate classification directly; `'boolean' |
 * 'null' | 'date'` shape types have no rules and aren't accepted here.
 */
export function ruleFor(fieldName: string, type: 'string' | 'number' | 'integer'): string {
  const rules = type === 'string' ? STRING_RULES : numberRules(new Map(), fieldName, type)
  const rule = rules.find((r) => r.when(fieldName))
  return rule?.name ?? 'fallback'
}
