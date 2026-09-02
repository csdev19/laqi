import { Context, Effect, Layer } from 'effect'
import { DependencyLoadError } from '../errors'

type QuicktypeCore = typeof import('quicktype-core')

/**
 * quicktype-core, the only dependency the printing arrow has. Same
 * lazy-loader shape as the other two services: an effect that yields the
 * module, so nothing is imported until something actually prints and the
 * layer itself cannot fail.
 */
export class Quicktype extends Context.Tag('@laqi/generate/Quicktype')<
  Quicktype,
  Effect.Effect<QuicktypeCore, DependencyLoadError>
>() {}

export const QuicktypeLive = Layer.effect(
  Quicktype,
  Effect.cached(
    Effect.tryPromise({
      try: () => import('quicktype-core'),
      catch: (cause) =>
        new DependencyLoadError({
          dependency: 'quicktype-core',
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
  ),
)
