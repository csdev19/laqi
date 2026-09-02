import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { DependencyLoadError } from '../errors'
import { generate, generateEffect } from '../generate'
import { primitive, type Shape } from '../shape'
import { FakerFactory, FakerFactoryLive } from './faker'

const user: Shape = {
  kind: 'object',
  fields: [
    { name: 'id', shape: primitive('integer'), optional: false },
    { name: 'name', shape: primitive('string'), optional: false },
  ],
}

const BrokenFaker = Layer.succeed(
  FakerFactory,
  Effect.fail(new DependencyLoadError({ dependency: '@faker-js/faker', message: 'ENOENT' })),
)

describe('FakerFactory service', () => {
  it('generates when the live layer provides the real faker', async () => {
    const value = (await Effect.runPromise(
      generateEffect(user, { seed: 42 }).pipe(Effect.provide(FakerFactoryLive)),
    )) as Record<string, unknown>

    expect(Object.keys(value)).toEqual(['id', 'name'])
  })

  it('surfaces a faker that cannot load as a GenerateError, not a defect', async () => {
    const caught = await Effect.runPromise(
      generateEffect(user).pipe(
        Effect.provide(BrokenFaker),
        Effect.catchTag('GenerateError', (e) => Effect.succeed(e.message)),
      ),
    )

    expect(caught).toContain('ENOENT')
  })

  it('loads the faker module once but builds a fresh instance per generation', async () => {
    let loads = 0
    let instances = 0
    const Counting = Layer.effect(
      FakerFactory,
      Effect.cached(
        Effect.promise(async () => {
          loads++
          const { Faker, en } = await import('@faker-js/faker')
          return () => {
            instances++
            return new Faker({ locale: [en] })
          }
        }),
      ),
    )

    await Effect.runPromise(
      Effect.all([generateEffect(user, { seed: 1 }), generateEffect(user, { seed: 2 })]).pipe(
        Effect.provide(Counting),
      ),
    )

    expect(loads).toBe(1)
    expect(instances).toBe(2)
  })

  it('stays byte-reproducible under a seed through the service', async () => {
    const run = () =>
      Effect.runPromise(generateEffect(user, { seed: 42 }).pipe(Effect.provide(FakerFactoryLive)))

    expect(await run()).toEqual(await run())
  })

  it('keeps the Promise facade working without the caller providing anything', async () => {
    expect(await generate(user, { seed: 42 })).toEqual(await generate(user, { seed: 42 }))
  })
})
