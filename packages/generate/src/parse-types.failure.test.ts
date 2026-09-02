import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { DependencyLoadError } from './errors'
import { parseTypesEffect } from './parse-types'
import { TypeScriptCompiler } from './services/compiler'

/**
 * The compiler is a service, and everything it does afterwards is plain
 * synchronous JavaScript. Neither is covered by the `ParseError` channel
 * unless it is explicitly wired there — a failed load or a throwing checker
 * would otherwise escape as an Effect defect, invisible to
 * `catchTag('ParseError')` and surfacing as a raw FiberFailure.
 *
 * These used to mock the Node module loader with `vi.doMock`, which meant
 * the tests exercised vitest's interception rather than the package's own
 * seams. A test layer says the same thing with none of that.
 */
const compilerThatFailsToLoad = Layer.succeed(
  TypeScriptCompiler,
  Effect.fail(new DependencyLoadError({ dependency: 'typescript', message: 'ENOENT' })),
)

/** The real compiler with one function replaced by a throw. */
const compilerThrowingFrom = (method: 'createProgram' | 'createSourceFile') =>
  Layer.effect(
    TypeScriptCompiler,
    Effect.cached(
      Effect.promise(async () => {
        const actual = (await import('typescript')).default
        return {
          ...actual,
          [method]: () => {
            throw new Error(`${method} exploded`)
          },
        } as typeof actual
      }),
    ),
  )

const messageOf = (layer: Layer.Layer<TypeScriptCompiler>) =>
  Effect.runPromise(
    parseTypesEffect('export interface User { name: string }', 'User').pipe(
      Effect.provide(layer),
      Effect.catchTag('ParseError', (e) => Effect.succeed(e.message)),
    ),
  )

describe('parseTypes when the compiler itself fails', () => {
  it('reports a compiler that cannot load through the typed ParseError channel', async () => {
    expect(await messageOf(compilerThatFailsToLoad)).toMatch(
      /could not load the TypeScript compiler/,
    )
  })

  it('names the underlying load failure rather than swallowing it', async () => {
    expect(await messageOf(compilerThatFailsToLoad)).toContain('ENOENT')
  })

  it('reports a throwing createProgram as a parse failure, not an unhandled defect', async () => {
    expect(await messageOf(compilerThrowingFrom('createProgram'))).toContain(
      'createProgram exploded',
    )
  })

  it('reports a throw from deeper inside the compiler the same way', async () => {
    expect(await messageOf(compilerThrowingFrom('createSourceFile'))).toContain(
      'createSourceFile exploded',
    )
  })
})
