import { describe, expect, it } from 'vitest'
import { importSchema, previewBody } from './import-schema'
import { inferShape } from './infer'
import { printShapeTypeScript } from './print-shape'

/** The body that prompted this: keys in the order the API wrote them. */
const INVOICE = {
  id: 'inv_1',
  number: 'A-1',
  status: 'issued',
  issuedAt: '2026-06-29T18:03:34.307Z',
  currency: 'USD',
  customer: {
    id: 1,
    name: 'Ada',
    email: 'ada@example.com',
    billing: { street: '914 Isle', city: 'Alainaborough', coordinates: [980.78, 887.15] },
  },
  lines: [{ sku: 'x', quantity: 2 }],
  tags: ['a', 'b'],
}

const keysOf = (code: string, name: string): string[] => {
  const block = code.split(`export interface ${name} {`)[1]?.split('}')[0] ?? ''
  return [...block.matchAll(/^\s+"?([\w$]+)"?\??:/gm)].map((match) => match[1]!)
}

describe('printing a shape as TypeScript', () => {
  it('keeps the keys where the body had them, at every depth', () => {
    const code = printShapeTypeScript(inferShape(INVOICE), 'Invoice')

    expect(keysOf(code, 'Invoice')).toEqual([
      'id',
      'number',
      'status',
      'issuedAt',
      'currency',
      'customer',
      'lines',
      'tags',
    ])
    expect(keysOf(code, 'Customer')).toEqual(['id', 'name', 'email', 'billing'])
    expect(keysOf(code, 'Billing')).toEqual(['street', 'city', 'coordinates'])
  })

  it('declares the root first and nested objects where they are met', () => {
    const code = printShapeTypeScript(inferShape(INVOICE), 'Invoice')
    const order = [...code.matchAll(/export interface (\w+)/g)].map((match) => match[1])

    expect(order).toEqual(['Invoice', 'Customer', 'Billing', 'Line'])
  })

  it('prints every kind the shape can hold', () => {
    const code = printShapeTypeScript(
      {
        kind: 'object',
        fields: [
          { name: 'when', shape: { kind: 'primitive', type: 'date' }, optional: true },
          { name: 'count', shape: { kind: 'primitive', type: 'integer' }, optional: false },
          {
            name: 'mode',
            shape: { kind: 'literals', values: ['draft', 'paid'] },
            optional: false,
          },
          {
            name: 'modes',
            shape: { kind: 'array', items: { kind: 'literals', values: ['a', 'b'] } },
            optional: false,
          },
          {
            name: 'point',
            shape: {
              kind: 'tuple',
              items: [
                { kind: 'primitive', type: 'number' },
                { kind: 'primitive', type: 'number' },
              ],
            },
            optional: false,
          },
          {
            name: 'byId',
            shape: { kind: 'record', values: { kind: 'primitive', type: 'string' } },
            optional: false,
          },
          { name: 'anything', shape: { kind: 'unknown' }, optional: false },
          { name: 'kebab-key', shape: { kind: 'primitive', type: 'null' }, optional: false },
        ],
      },
      'Everything',
    )

    expect(code).toContain('when?: Date;')
    expect(code).toContain('count: number;')
    expect(code).toContain('mode: "draft" | "paid";')
    expect(code).toContain('modes: ("a" | "b")[];')
    expect(code).toContain('point: [number, number];')
    expect(code).toContain('byId: Record<string, string>;')
    expect(code).toContain('anything: unknown;')
    expect(code).toContain('"kebab-key": null;')
  })

  it('names a root that is not an object, so it can still be imported by name', () => {
    const code = printShapeTypeScript(inferShape([{ id: 1 }]), 'Users')

    expect(code).toContain('export type Users = User[];')
    expect(code).toContain('export interface User {')
  })

  it('does not hand two objects the same name', () => {
    const code = printShapeTypeScript(inferShape({ item: { a: 1 }, items: [{ b: 2 }] }), 'Root')

    expect(code).toContain('export interface Item {')
    expect(code).toContain('export interface Item2 {')
  })
})

describe('the round trip that makes order a contract', () => {
  // Print → parse → schema → generate. If any step reordered, this is where
  // the person would have found out, comparing two bodies.
  it('survives into the schema and into every generated body', async () => {
    const code = printShapeTypeScript(inferShape(INVOICE), 'Invoice')

    const { snapshot } = await importSchema({
      kind: 'typescript-paste',
      source: code,
      typeName: 'Invoice',
    })
    const properties = snapshot.document['properties'] as Record<string, unknown>
    expect(Object.keys(properties)).toEqual(Object.keys(INVOICE))

    const { body } = await previewBody(snapshot, { seed: 3 })
    expect(Object.keys(body as object)).toEqual(Object.keys(INVOICE))
    const customer = (body as Record<string, Record<string, unknown>>)['customer']!
    expect(Object.keys(customer)).toEqual(Object.keys(INVOICE.customer))
  }, 30_000)
})
