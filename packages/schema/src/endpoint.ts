import { z } from 'zod'
import { ResponseSchema } from './response'

export const EndpointSchema = z
  .object({
    description: z.string().optional(),
    default: z.string().min(1),
    responses: z.record(z.string(), ResponseSchema),
  })
  .superRefine((endpoint, ctx) => {
    const names = Object.keys(endpoint.responses)

    if (names.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['responses'],
        message: 'an endpoint needs at least one response',
      })
      return
    }

    if (!names.includes(endpoint.default)) {
      ctx.addIssue({
        code: 'custom',
        path: ['default'],
        message: `default ${JSON.stringify(endpoint.default)} is not a declared response. Available: ${names.join(', ')}`,
      })
    }
  })

export type EndpointDefinition = z.infer<typeof EndpointSchema>
