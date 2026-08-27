import type { Shape } from './shape'

/** Fixed reference date: with a seed, output must be byte-reproducible. */
const REF_DATE = '2026-01-01T00:00:00.000Z'
const DEFAULT_ARRAY_LENGTH = 3

/**
 * Helper: check if name ends with 'id' or '_id' at word boundary.
 * Matches: id, userId, user_id, orderId, order_id
 * Excludes: paid, valid, void, rapid, etc.
 */
function isIdField(name: string): boolean {
  return name === 'id' || name === '_id' || /([A-Z_][a-z]*_)?id$/.test(name)
}

/**
 * Helper: check if name is a date-related field (high priority).
 * Should be checked before email/name/city checks.
 */
function isDateField(name: string): boolean {
  return name.endsWith('at') || name.includes('date') || name.includes('time')
}

/**
 * Helper: check if name is a person name field.
 * Matches: name, firstName, lastName, fullName, displayName
 * Excludes: filename, username, etc.
 */
function isPersonNameField(name: string): boolean {
  return name === 'name' || name.includes('firstname') || name.includes('lastname') || name.includes('fullname') || name.includes('displayname')
}

/**
 * Shape → data. faker (seeded) provides the values; a small field-name
 * dictionary makes them look real — `email` fields get emails, `createdAt`
 * gets an ISO date, `price` gets a decimal. `id` fields are sequential per
 * field per generate() call so lists look stable.
 */
export async function generate(
  shape: Shape,
  options: { seed?: number; arrayLength?: number } = {},
): Promise<unknown> {
  const { Faker, en } = await import('@faker-js/faker')
  const faker = new Faker({ locale: [en] })
  if (options.seed !== undefined) {
    faker.seed(options.seed)
    faker.setDefaultRefDate(REF_DATE)
  }

  const clampedArrayLength = Math.max(1, Math.min(options.arrayLength ?? DEFAULT_ARRAY_LENGTH, 1000))
  const idCounters = new Map<string, number>()

  function valueFor(shape: Shape, fieldName: string): unknown {
    switch (shape.kind) {
      case 'object':
        return Object.fromEntries(shape.fields.map((f) => [f.name, valueFor(f.shape, f.name)]))
      case 'array':
        return Array.from({ length: clampedArrayLength }, () => valueFor(shape.items, fieldName))
      case 'record':
        return Object.fromEntries(
          Array.from({ length: 2 }, () => [faker.lorem.word(), valueFor(shape.values, '')]),
        )
      case 'literals':
        return faker.helpers.arrayElement(shape.values)
      case 'unknown':
        return null
      case 'primitive':
        return primitiveFor(shape.type, fieldName)
    }
  }

  function primitiveFor(type: string, fieldName: string): unknown {
    const name = fieldName.toLowerCase()

    if (type === 'null') return null
    if (type === 'boolean') return faker.datatype.boolean()
    if (type === 'date') return faker.date.recent({ days: 90 }).toISOString()

    if (type === 'integer' || type === 'number') {
      // Exact id/_id: sequential with per-field counter
      if (name === 'id' || name === '_id') {
        const counter = idCounters.get(name) ?? 1
        idCounters.set(name, counter + 1)
        return counter
      }
      // Foreign key patterns (*Id, *_id): plausible random values, not sequential
      if (isIdField(name)) {
        return faker.number.int({ min: 1, max: 1000 })
      }
      if (name.includes('price') || name.includes('total') || name.includes('amount') || name.includes('cost')) {
        return Number(faker.commerce.price())
      }
      if (name.includes('age')) return faker.number.int({ min: 18, max: 80 })
      if (name.includes('count') || name.includes('quantity')) {
        return faker.number.int({ min: 0, max: 100 })
      }
      return type === 'integer' ? faker.number.int({ min: 0, max: 1000 }) : faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })
    }

    // string: check date-ness FIRST (before email/name/city)
    if (isDateField(name)) return faker.date.recent({ days: 90 }).toISOString()
    if (name.includes('email')) return faker.internet.email()
    if (isPersonNameField(name)) return faker.person.fullName()
    if (name.includes('username') || name.includes('user_name')) return faker.internet.username()
    if (name.includes('filename') || name.includes('file_name')) return `${faker.lorem.slug()}.txt`
    if (name.includes('phone')) return faker.phone.number()
    if (name.includes('avatar') || name.includes('image') || name.includes('photo')) return faker.image.url()
    if (name.includes('url') || name.includes('link')) return faker.internet.url()
    if (name.includes('city')) return faker.location.city()
    if (name.includes('street') || name.includes('address')) return faker.location.streetAddress()
    if (name.includes('country')) return faker.location.country()
    if (name.includes('zip') || name.includes('postal')) return faker.location.zipCode()
    if (name.includes('uuid') || name.includes('guid')) return faker.string.uuid()
    if (name.includes('description') || name.includes('bio') || name.includes('summary')) return faker.lorem.sentence()
    if (name.includes('title')) return faker.lorem.words(3)
    return faker.lorem.words(2)
  }

  return valueFor(shape, '')
}
