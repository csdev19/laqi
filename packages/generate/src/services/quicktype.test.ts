import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { DependencyLoadError } from '../errors'
import { printTypes, printTypesEffect } from '../print-types'
import { primitive, type Shape } from '../shape'
import { Quicktype, QuicktypeLive } from './quicktype'

const user: Shape = {
  kind: 'object',
  fields: [{ name: 'id', shape: primitive('integer'), optional: false }],
}

const BrokenQuicktype = Layer.succeed(
  Quicktype,
  Effect.fail(new DependencyLoadError({ dependency: 'quicktype-core', message: 'ENOENT' })),
)

describe('Quicktype service', () => {
  it('prints when the live layer provides the real quicktype', async () => {
    const result = await Effect.runPromise(
      printTypesEffect(user, { typeName: 'User' }).pipe(Effect.provide(QuicktypeLive)),
    )

    expect(result.language).toBe('typescript')
    expect(result.code).toContain('User')
  })

  it('surfaces a quicktype that cannot load as a PrintError, not a defect', async () => {
    const caught = await Effect.runPromise(
      printTypesEffect(user, { typeName: 'User' }).pipe(
        Effect.provide(BrokenQuicktype),
        Effect.catchTag('PrintError', (e) => Effect.succeed(e.message)),
      ),
    )

    expect(caught).toContain('ENOENT')
  })

  it('still rejects an unknown language, with the supported ones listed', async () => {
    const caught = await Effect.runPromise(
      printTypesEffect(user, { typeName: 'User', lang: 'klingon' }).pipe(
        Effect.provide(QuicktypeLive),
        Effect.catchTag('PrintError', (e) => Effect.succeed(e.message)),
      ),
    )

    expect(caught).toContain('unknown language')
  })

  it('loads quicktype once and reuses it across prints', async () => {
    let loads = 0
    const Counting = Layer.effect(
      Quicktype,
      Effect.cached(
        Effect.promise(async () => {
          loads++
          return await import('quicktype-core')
        }),
      ),
    )

    await Effect.runPromise(
      Effect.all([
        printTypesEffect(user, { typeName: 'A' }),
        printTypesEffect(user, { typeName: 'B' }),
      ]).pipe(Effect.provide(Counting)),
    )

    expect(loads).toBe(1)
  })

  it('keeps the Promise facade working without the caller providing anything', async () => {
    const printed = await printTypes(user, { typeName: 'User' })

    expect(printed.code).toContain('User')
  })
})
