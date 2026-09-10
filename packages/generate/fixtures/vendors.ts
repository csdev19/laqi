// packages/generate/fixtures/vendors.ts
//
// Real schemas from real libraries, at the versions in this repo's lockfile.
// Hand-written stand-ins would only prove that laqi agrees with itself; what
// has to hold is that laqi reads what these libraries actually emit.
//
// This file is loaded by a CHILD PROCESS in the module-loading tests, by
// path, so it is a fixture rather than a test: it must be importable on its
// own and must not import vitest.
import { type } from 'arktype'
import * as v from 'valibot'
import { z } from 'zod'

/** Zod 4. Emits `additionalProperties: false`, which laqi stores as given. */
export const ZodInvoice = z.object({
  id: z.string(),
  total: z.number(),
  status: z.enum(['draft', 'issued', 'paid']),
  note: z.string().optional(),
})

/** ArkType 2. Emits no `additionalProperties`, which laqi also stores as given. */
export const ArkInvoice = type({
  id: 'string',
  total: 'number',
  'note?': 'string',
})

/**
 * Valibot 1.5 implements Standard Schema validation but NOT the JSON Schema
 * extension: its `~standard` has no `jsonSchema`. It is here as the real
 * example of an object laqi must refuse for lack of capability, rather than
 * a fake one built to fail.
 */
export const ValibotInvoice = v.object({
  id: v.string(),
  total: v.number(),
})

/** Not a schema at all: the ordinary mistake of naming the wrong export. */
export const notASchema = { id: 'inv_1' }

/** A converter that throws, so the vendor's own message is what surfaces. */
export const ThrowsOnConvert = {
  '~standard': {
    version: 1,
    vendor: 'pretend',
    validate: () => ({ value: undefined }),
    jsonSchema: {
      input: () => {
        throw new Error('cannot convert a transform to JSON Schema')
      },
      output: () => {
        throw new Error('cannot convert a transform to JSON Schema')
      },
    },
  },
}
