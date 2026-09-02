import { Context, Effect, Layer } from 'effect'
import { DependencyLoadError } from '../errors'

type Faker = import('@faker-js/faker').Faker

/**
 * A source of fresh `Faker` instances.
 *
 * The service yields a *factory*, not one shared instance, because
 * `generate` seeds the faker it is handed: sharing one across calls would
 * let a seeded run and an unseeded one interfere. Same lazy-loader shape as
 * `TypeScriptCompiler` — an effect that yields the factory — so the module
 * is imported on first use and the layer itself cannot fail.
 */
export class FakerFactory extends Context.Tag('@laqi/generate/FakerFactory')<
  FakerFactory,
  Effect.Effect<() => Faker, DependencyLoadError>
>() {}

export const FakerFactoryLive = Layer.effect(
  FakerFactory,
  Effect.cached(
    Effect.tryPromise({
      try: async () => {
        const { Faker, en } = await import('@faker-js/faker')
        return () => new Faker({ locale: [en] })
      },
      catch: (cause) =>
        new DependencyLoadError({
          dependency: '@faker-js/faker',
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
  ),
)
