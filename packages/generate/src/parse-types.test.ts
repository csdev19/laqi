import { describe, expect, it } from 'vitest'
import { parseTypes } from './parse-types'
import { primitive, type Shape } from './shape'

/** The MGM-style fixture: extends, Pick & intersection, absent import. */
const DIRTY = `
import { Money } from '@mgm/currency'

interface Base { id: number; createdAt: Date }
type Tag = 'vip' | 'regular' | 'banned'

export interface User extends Base {
  name: string
  email?: string
  tags: Tag[]
  balance: Money
  metadata: Record<string, string>
  address: { street: string; zip?: string }
}

export type UserSummary = Pick<User, 'id' | 'name'> & { active: boolean }
`

function field(shape: Shape & { kind: 'object' }, name: string) {
  const found = shape.fields.find((f) => f.name === name)
  if (!found) throw new Error(`no field ${name} in ${shape.fields.map((f) => f.name).join(',')}`)
  return found
}

describe('parseTypes', () => {
  it('flattens extends into a plain object shape', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(result.shape.kind).toBe('object')
    const shape = result.shape as Shape & { kind: 'object' }
    expect(field(shape, 'id').shape).toEqual(primitive('number'))
    expect(field(shape, 'createdAt').shape).toEqual(primitive('date'))
  })

  it('keeps literal unions as literals, and arrays of them as arrays', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'tags').shape).toEqual({
      kind: 'array',
      items: { kind: 'literals', values: ['vip', 'regular', 'banned'] },
    })
  })

  it('marks optional properties and strips the undefined branch', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    const email = field(result.shape as never, 'email')
    expect(email.optional).toBe(true)
    expect(email.shape).toEqual(primitive('string'))
  })

  it('degrades an unresolvable import to unknown, with a warning naming the property', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'balance').shape).toEqual({ kind: 'unknown' })
    expect(result.warnings.some((w) => w.includes('balance'))).toBe(true)
  })

  it('maps Record<string, T> and nested object literals', async () => {
    const result = await parseTypes(DIRTY, 'User')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'metadata').shape).toEqual({
      kind: 'record',
      values: primitive('string'),
    })
    const address = field(result.shape as never, 'address').shape as Shape & { kind: 'object' }
    expect(field(address, 'zip').optional).toBe(true)
  })

  it('resolves Pick & intersection into a flat shape', async () => {
    const result = await parseTypes(DIRTY, 'UserSummary')
    if (!result.ok) throw new Error(result.error)
    const shape = result.shape as Shape & { kind: 'object' }
    expect(shape.fields.map((f) => f.name).sort()).toEqual(['active', 'id', 'name'])
  })

  it('defaults to the first exported type when no name is given', async () => {
    const result = await parseTypes(DIRTY)
    if (!result.ok) throw new Error(result.error)
    expect(result.typeName).toBe('User')
  })

  it('fails clearly on an unknown type name and on source with no types', async () => {
    const missing = await parseTypes(DIRTY, 'Nope')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('Nope')

    const empty = await parseTypes('const x = 1')
    expect(empty.ok).toBe(false)
  })

  it('survives a self-referencing type instead of recursing forever', async () => {
    const result = await parseTypes('export interface Node { id: number; next: Node }', 'Node')
    if (!result.ok) throw new Error(result.error)
    const next = (result.shape as Shape & { kind: 'object' }).fields.find((f) => f.name === 'next')!
    expect(next.shape).toEqual({ kind: 'unknown' })
    expect(result.warnings.some((w) => w.includes('circular'))).toBe(true)
  })
})
