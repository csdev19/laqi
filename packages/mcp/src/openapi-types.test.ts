import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { importOpenapi } from './openapi'

/**
 * What a team's real OpenAPI spec looks like: numbers carry `int64`/`int32`/
 * `double`/`float`, dates carry `date`/`date-time`, ids are `uuid`, and some
 * fields are `nullable`. Every one of them has to come out of the import as a
 * generated body that a validator sharing no code with laqi accepts — a
 * response that silently loses its body is the failure this file exists for.
 */
const spec = {
  openapi: '3.0.3',
  info: { title: 'Orders', version: '1.0.0' },
  paths: {
    '/orders/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'one order',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
        },
      },
    },
    '/orders': {
      get: {
        responses: {
          '200': {
            description: 'the orders',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Order: {
        type: 'object',
        required: ['id', 'quantity', 'total', 'ratio', 'createdAt', 'shipOn', 'reference'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          quantity: { type: 'integer', format: 'int32', minimum: 1 },
          total: { type: 'number', format: 'double', minimum: 0 },
          ratio: { type: 'number', format: 'float' },
          createdAt: { type: 'string', format: 'date-time' },
          shipOn: { type: 'string', format: 'date' },
          reference: { type: 'string', format: 'uuid' },
          contact: { type: 'string', format: 'email' },
          receipt: { type: 'string', format: 'uri' },
          status: { type: 'string', enum: ['pending', 'paid', 'shipped'] },
          note: { type: 'string', nullable: true },
          paid: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
          attributes: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
  },
}

const ajv = addFormats(new Ajv2020({ strict: true, strictRequired: false, allErrors: true }))

async function importedOrder() {
  const result = await importOpenapi(spec)
  const one = result.endpoints.find((e) => e.method === 'GET' && e.path === '/orders/:id')!
  return { result, response: one.definition.responses.ok! }
}

describe('an OpenAPI spec with the types real APIs use', () => {
  it('skips nothing', async () => {
    const { result } = await importedOpenapiResult()
    expect(result.skipped).toEqual([])
  })

  it('generates a body for every response, including the ones whose numbers carry a format', async () => {
    const { result } = await importedOpenapiResult()
    for (const endpoint of result.endpoints) {
      for (const [name, response] of Object.entries(endpoint.definition.responses)) {
        expect(response.body, `${endpoint.method} ${endpoint.path} → ${name}`).toBeDefined()
      }
    }
  })

  it('generates bodies an independent validator accepts against the recorded schema', async () => {
    const { result } = await importedOpenapiResult()
    for (const endpoint of result.endpoints) {
      for (const [name, response] of Object.entries(endpoint.definition.responses)) {
        const validate = ajv.compile(response.schema!.document as object)
        const valid = validate(response.body)
        expect(
          valid,
          `${endpoint.method} ${endpoint.path} → ${name}: ${ajv.errorsText(validate.errors)}`,
        ).toBe(true)
      }
    }
  })

  it('gives each field a value a client would parse as the declared type', async () => {
    const { response } = await importedOrder()
    const order = response.body as Record<string, unknown>

    // int64 ids must survive JSON.parse on a JavaScript client unchanged.
    expect(Number.isSafeInteger(order['id'])).toBe(true)
    expect(Number.isInteger(order['quantity'])).toBe(true)
    expect(order['quantity']).toBeGreaterThanOrEqual(1)
    expect(typeof order['total']).toBe('number')
    expect(order['total']).toBeGreaterThanOrEqual(0)
    expect(typeof order['ratio']).toBe('number')

    // Dates travel as strings in JSON; they have to be strings a Date accepts.
    expect(order['createdAt']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    )
    expect(Number.isNaN(new Date(order['createdAt'] as string).getTime())).toBe(false)
    expect(order['shipOn']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isNaN(new Date(order['shipOn'] as string).getTime())).toBe(false)

    expect(order['reference']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(['pending', 'paid', 'shipped']).toContain(order['status'])
  })

  it('lets a nullable field be null or its type, never anything else', async () => {
    const { response } = await importedOrder()
    const note = (response.body as Record<string, unknown>)['note']
    expect(note === undefined || note === null || typeof note === 'string').toBe(true)
  })
})

async function importedOpenapiResult() {
  return { result: await importOpenapi(spec) }
}
