import type { Shape } from './shape'

/** Fixed reference date: with a seed, output must be byte-reproducible. */
const REF_DATE = '2026-01-01T00:00:00.000Z'
const DEFAULT_ARRAY_LENGTH = 3

/**
 * Shape → data. faker (seeded) provides the values; a small field-name
 * dictionary makes them look real — `email` fields get emails, `createdAt`
 * gets an ISO date, `price` gets a decimal. `id` fields are sequential per
 * generate() call so lists look stable.
 */
export async function generate(
  shape: Shape,
  options: { seed?: number; arrayLength?: number } = {},
): Promise<unknown> {
  const { Faker, en } = await import('@faker-js/faker')
  const faker = new Faker({ locale: [en] })
  if (options.seed !== undefined) faker.seed(options.seed)
  faker.setDefaultRefDate(REF_DATE)

  const arrayLength = options.arrayLength ?? DEFAULT_ARRAY_LENGTH
  let nextId = 1

  function valueFor(shape: Shape, fieldName: string): unknown {
    switch (shape.kind) {
      case 'object':
        return Object.fromEntries(shape.fields.map((f) => [f.name, valueFor(f.shape, f.name)]))
      case 'array':
        return Array.from({ length: arrayLength }, () => valueFor(shape.items, fieldName))
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
      if (name === 'id' || name.endsWith('id')) return nextId++
      if (name.includes('price') || name.includes('total') || name.includes('amount') || name.includes('cost')) {
        return Number(faker.commerce.price())
      }
      if (name.includes('age')) return faker.number.int({ min: 18, max: 80 })
      if (name.includes('count') || name.includes('quantity') || name.includes('total')) {
        return faker.number.int({ min: 0, max: 100 })
      }
      return type === 'integer' ? faker.number.int({ min: 0, max: 1000 }) : faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })
    }

    // string
    if (name.includes('email')) return faker.internet.email()
    if (name === 'name' || name.endsWith('name')) return faker.person.fullName()
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
    if (name.includes('date') || name.endsWith('at')) return faker.date.recent({ days: 90 }).toISOString()
    return faker.lorem.words(2)
  }

  return valueFor(shape, '')
}
