import { Context, Effect, Layer } from 'effect'
import { DependencyLoadError } from '../errors'

type TypeScript = typeof import('typescript')

/**
 * The TypeScript compiler, as a service rather than a bare `import()`.
 *
 * The service value is an *effect that yields* the compiler, not the
 * compiler itself. That is what keeps the 23 MB load lazy: building the
 * layer only prepares the loader, and nothing is imported until a program
 * actually asks for the compiler. It also keeps the layer's own error
 * channel empty, so a runtime built from it cannot fail on construction —
 * a load failure surfaces where it is used, and the program maps it to its
 * own domain error there.
 */
export class TypeScriptCompiler extends Context.Tag('@laqi/generate/TypeScriptCompiler')<
  TypeScriptCompiler,
  Effect.Effect<TypeScript, DependencyLoadError>
>() {}

/**
 * `Effect.cached` memoises the load per layer build, so one runtime imports
 * the compiler once no matter how many parses run through it. That is the
 * layer's whole caching claim: the *module* is shared. A `ts.Program` and
 * its `CompilerHost` are NOT — both depend on the specific source and
 * compiler options of one parse, so they stay per-call.
 */
export const TypeScriptCompilerLive = Layer.effect(
  TypeScriptCompiler,
  Effect.cached(
    Effect.tryPromise({
      try: () => import('typescript').then((m) => m.default),
      catch: (cause) =>
        new DependencyLoadError({
          dependency: 'typescript',
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
  ),
)
