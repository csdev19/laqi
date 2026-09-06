import { describe, expect, it } from 'vitest'
import { readModel } from './fixtures/models'
import { generate } from './generate'
import { parseTypes } from './parse-types'
import { primitive, type Shape } from './shape'

// The three example models under fixtures/models are what a developer
// pastes into the panel to try laqi, and what these tests parse. If a
// checker upgrade or a parser change alters how one of them comes out, this
// is where it shows — at the depth and construct that changed, not as a
// vague "the preview looks different".

type ObjectShape = Shape & { kind: 'object' }

async function parsed(name: 'simple' | 'medium' | 'complex', typeName?: string) {
  const result = await parseTypes(readModel(name), typeName)
  if (!result.ok) throw new Error(result.error)
  return result
}

/** Follow `a.b.c` through object fields, `[]` through arrays. */
function at(shape: Shape, path: string): Shape {
  let current = shape
  for (const step of path.split('.')) {
    const [name, ...brackets] = step.split('[]')
    if (name) {
      if (current.kind !== 'object') throw new Error(`${path}: ${name} is not on an object`)
      const field = current.fields.find((f) => f.name === name)
      if (!field) throw new Error(`${path}: no field ${name}`)
      current = field.shape
    }
    for (const _ of brackets) {
      if (current.kind !== 'array') throw new Error(`${path}: ${name} is not an array`)
      current = current.items
    }
  }
  return current
}

function fieldNames(shape: Shape): string[] {
  if (shape.kind !== 'object') throw new Error(`expected an object, got ${shape.kind}`)
  return shape.fields.map((f) => f.name).sort()
}

function fieldFlag(shape: Shape, name: string): boolean {
  const field = (shape as ObjectShape).fields.find((f) => f.name === name)
  if (!field) throw new Error(`no field ${name}`)
  return field.optional
}

describe('the simple model', () => {
  it('parses into a flat object with the exact fields, and no warnings', async () => {
    const { shape, typeName, warnings } = await parsed('simple')

    expect(typeName).toBe('Todo')
    expect(warnings).toEqual([])
    expect(shape).toEqual({
      kind: 'object',
      fields: [
        { name: 'id', shape: primitive('number'), optional: false },
        { name: 'title', shape: primitive('string'), optional: false },
        { name: 'completed', shape: primitive('boolean'), optional: false },
        {
          name: 'priority',
          shape: { kind: 'literals', values: ['low', 'medium', 'high'] },
          optional: false,
        },
        { name: 'dueDate', shape: primitive('date'), optional: true },
      ],
    })
  })

  it('generates a preview that matches the model', async () => {
    const { shape } = await parsed('simple')
    const todo = (await generate(shape, { seed: 1 })) as Record<string, unknown>

    expect(typeof todo.id).toBe('number')
    expect(typeof todo.title).toBe('string')
    expect(typeof todo.completed).toBe('boolean')
    expect(['low', 'medium', 'high']).toContain(todo.priority)
  })
})

describe('the medium model', () => {
  it('picks the first exported type, which is an alias, unless told otherwise', async () => {
    const alias = await parsed('medium')
    expect(alias.typeName).toBe('Role')
    expect(alias.shape).toEqual({ kind: 'literals', values: ['owner', 'editor', 'viewer'] })
  })

  it('flattens extends across two levels and keeps the references as nested objects', async () => {
    const { shape, warnings } = await parsed('medium', 'Project')

    expect(warnings).toEqual([])
    expect(fieldNames(shape)).toEqual([
      'archived',
      'createdAt',
      'description',
      'id',
      'labels',
      'members',
      'name',
      'owner',
      'settings',
      'stars',
      'updatedAt',
      'visibility',
    ])
    expect(fieldNames(at(shape, 'members[]'))).toEqual([
      'active',
      'createdAt',
      'role',
      'updatedAt',
      'user',
    ])
    expect(at(shape, 'members[].user.email')).toEqual(primitive('string'))
    expect(at(shape, 'members[].role')).toEqual({
      kind: 'literals',
      values: ['owner', 'editor', 'viewer'],
    })
  })

  it('maps null unions, records and the inline settings object', async () => {
    const { shape } = await parsed('medium', 'Project')

    expect(at(shape, 'description')).toEqual(primitive('string'))
    expect(at(shape, 'updatedAt')).toEqual(primitive('date'))
    expect(at(shape, 'labels')).toEqual({ kind: 'record', values: primitive('string') })
    expect(fieldFlag(at(shape, 'settings'), 'retentionDays')).toBe(true)
    expect(fieldFlag(at(shape, 'owner'), 'avatarUrl')).toBe(true)
  })

  it('generates a preview whose members carry a user each', async () => {
    const { shape } = await parsed('medium', 'Project')
    const project = (await generate(shape, { seed: 7, arrayLength: 2 })) as {
      members: Array<{ user: { email: string }; role: string }>
      labels: Record<string, string>
    }

    expect(project.members).toHaveLength(2)
    expect(project.members[0]?.user.email).toMatch(/@/)
    expect(['owner', 'editor', 'viewer']).toContain(project.members[0]?.role)
    expect(typeof project.labels).toBe('object')
  })
})

describe('the complex model', () => {
  it('reaches the fourth level of nesting with the right primitive', async () => {
    const { shape } = await parsed('complex', 'Order')

    expect(at(shape, 'customer.address.geo.lat')).toEqual(primitive('number'))
    expect(fieldFlag(at(shape, 'customer.address.geo'), 'accuracy')).toBe(true)
    expect(at(shape, 'history[].by.role')).toEqual({
      kind: 'literals',
      values: ['system', 'agent'],
    })
  })

  it('flattens two extends clauses plus readonly into plain fields', async () => {
    const { shape } = await parsed('complex', 'Order')

    expect(fieldNames(shape)).toEqual([
      'createdAt',
      'customer',
      'history',
      'id',
      'items',
      'metadata',
      'notes',
      'payment',
      'placedOn',
      'shipment',
      'status',
      'totals',
      'updatedAt',
    ])
    expect(fieldFlag(shape, 'shipment')).toBe(true)
    expect(at(shape, 'id')).toEqual(primitive('string'))
  })

  it('resolves Pick & intersection and Omit & intersection into flat objects', async () => {
    const { shape } = await parsed('complex', 'Order')

    expect(fieldNames(at(shape, 'items[].product'))).toEqual(['id', 'name', 'variant'])
    expect(fieldFlag(at(shape, 'items[].product'), 'variant')).toBe(true)

    const shipment = fieldNames(at(shape, 'shipment'))
    expect(shipment).toContain('carrier')
    expect(shipment).toContain('street')
    expect(shipment).not.toContain('geo')
    expect(at(shape, 'shipment.tracking')).toEqual({ kind: 'array', items: primitive('string') })
  })

  it('keeps tuples, including a tuple inside an array', async () => {
    const { shape } = await parsed('complex', 'Order')

    expect(at(shape, 'items[].product')).toBeDefined()
    expect(at(shape, 'totals.breakdown[]')).toEqual({
      kind: 'tuple',
      items: [{ kind: 'literals', values: ['USD', 'EUR', 'PEN'] }, primitive('number')],
    })
  })

  it('maps Partial, template literal strings, null unions and literal aliases', async () => {
    const { shape } = await parsed('complex', 'Order')

    expect(fieldFlag(at(shape, 'customer.preferences'), 'newsletter')).toBe(true)
    expect(at(shape, 'customer.preferences.locale')).toEqual({
      kind: 'literals',
      values: ['en', 'es'],
    })
    expect(at(shape, 'placedOn')).toEqual(primitive('string'))
    expect(at(shape, 'customer.phone')).toEqual(primitive('string'))
    expect(at(shape, 'status')).toEqual({
      kind: 'literals',
      values: ['draft', 'paid', 'shipped', 'delivered', 'cancelled'],
    })
    expect(at(shape, 'items[].unitPrice.currency')).toEqual({
      kind: 'literals',
      values: ['USD', 'EUR', 'PEN'],
    })
  })

  it('narrows the two mixed unions and warns about exactly those', async () => {
    const { shape, warnings } = await parsed('complex', 'Order')

    expect(warnings.map((w) => w.split(':')[0]).sort()).toEqual([
      'Order.metadata{}',
      'Order.payment',
    ])
    expect(at(shape, 'payment').kind).toBe('object')
    expect(at(shape, 'metadata').kind).toBe('record')
  })

  it('generates a preview that round-trips through JSON and reaches the fourth level', async () => {
    const { shape } = await parsed('complex', 'Order')
    const order = (await generate(shape, { seed: 3, arrayLength: 2 })) as {
      customer: { address: { geo: { lat: number; lng: number } } }
      items: Array<{ product: { id: string }; discounts: Array<{ percent: number }> }>
      totals: { breakdown: Array<[string, number]> }
    }

    expect(JSON.parse(JSON.stringify(order))).toEqual(order)
    expect(typeof order.customer.address.geo.lat).toBe('number')
    expect(order.items).toHaveLength(2)
    expect(typeof order.items[0]?.discounts[0]?.percent).toBe('number')
    expect(order.totals.breakdown[0]).toHaveLength(2)
  })
})
