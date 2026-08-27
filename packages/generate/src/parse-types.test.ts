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

  // --- Fix round 1 -----------------------------------------------------

  it('keeps the real type on a T | null union instead of collapsing to null', async () => {
    const result = await parseTypes(
      'export interface WithNull { a: string | null; b: number | null }',
      'WithNull',
    )
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'a').shape).toEqual(primitive('string'))
    expect(field(result.shape as never, 'b').shape).toEqual(primitive('number'))
  })

  it('treats a tuple as a tuple shape preserving each element type and arity, not an object full of prototype members', async () => {
    const result = await parseTypes('export interface Box { pair: [string, number] }', 'Box')
    if (!result.ok) throw new Error(result.error)
    const pair = field(result.shape as never, 'pair')
    expect(pair.shape).toEqual({
      kind: 'tuple',
      items: [primitive('string'), primitive('number')],
    })
    expect(result.warnings.length).toBeLessThan(5)
  })

  // --- Finding 1: heterogeneous tuples lose all data --------------------

  it('preserves a heterogeneous tuple as a top-level type', async () => {
    const result = await parseTypes('export type Pair = [string, number]', 'Pair')
    if (!result.ok) throw new Error(result.error)
    expect(result.shape).toEqual({
      kind: 'tuple',
      items: [primitive('string'), primitive('number')],
    })
  })

  it('preserves a homogeneous tuple\'s arity instead of collapsing to a variable-length array', async () => {
    const result = await parseTypes('export type Pair = [number, number]', 'Pair')
    if (!result.ok) throw new Error(result.error)
    expect(result.shape).toEqual({
      kind: 'tuple',
      items: [primitive('number'), primitive('number')],
    })
  })

  it('preserves a tuple nested inside an object', async () => {
    const result = await parseTypes(
      'export interface Row { id: number; cells: [string, boolean] }',
      'Row',
    )
    if (!result.ok) throw new Error(result.error)
    const cells = field(result.shape as never, 'cells')
    expect(cells.shape).toEqual({
      kind: 'tuple',
      items: [primitive('string'), primitive('boolean')],
    })
  })

  it('preserves a tuple of literal types', async () => {
    const result = await parseTypes(
      "export type Coord = ['x' | 'y', 1 | 2]",
      'Coord',
    )
    if (!result.ok) throw new Error(result.error)
    // The checker does not preserve union member source order (documented
    // above at the mixed-union branch), so compare each position's values
    // as a set rather than pinning an order.
    expect(result.shape.kind).toBe('tuple')
    const shape = result.shape as Shape & { kind: 'tuple' }
    expect(shape.items).toHaveLength(2)
    expect(shape.items[0]!.kind).toBe('literals')
    expect(shape.items[1]!.kind).toBe('literals')
    expect(new Set((shape.items[0] as Shape & { kind: 'literals' }).values)).toEqual(
      new Set(['x', 'y']),
    )
    expect(new Set((shape.items[1] as Shape & { kind: 'literals' }).values)).toEqual(
      new Set([1, 2]),
    )
  })

  it('keeps an empty tuple as an array of unknown', async () => {
    const result = await parseTypes('export type Empty = []', 'Empty')
    if (!result.ok) throw new Error(result.error)
    expect(result.shape).toEqual({ kind: 'array', items: { kind: 'unknown' } })
  })

  it('does not warn that a tuple was approximated as an array — it is no longer an approximation', async () => {
    const result = await parseTypes('export type Pair = [string, number]', 'Pair')
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings.some((w) => w.includes('approximated'))).toBe(false)
  })

  it('keeps a single boolean literal as a literal value', async () => {
    const result = await parseTypes('export interface Flag { active: true }', 'Flag')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'active').shape).toEqual({
      kind: 'literals',
      values: [true],
    })
  })

  it('keeps plain boolean as primitive boolean, not a two-member literal union', async () => {
    const result = await parseTypes('export interface Flag { active: boolean }', 'Flag')
    if (!result.ok) throw new Error(result.error)
    expect(field(result.shape as never, 'active').shape).toEqual(primitive('boolean'))
  })

  it('warns when named properties coexist with a string index signature that gets dropped', async () => {
    const result = await parseTypes(
      'export interface Loose { id: number; [key: string]: unknown }',
      'Loose',
    )
    if (!result.ok) throw new Error(result.error)
    const shape = result.shape as Shape & { kind: 'object' }
    expect(shape.fields.map((f) => f.name)).toEqual(['id'])
    expect(result.warnings.some((w) => w.includes('Loose') && w.includes('index'))).toBe(true)
  })
})
