import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { DependencyLoadError } from '../errors'
import { parseTypes, parseTypesEffect } from '../parse-types'
import { TypeScriptCompiler, TypeScriptCompilerLive } from './compiler'

/** The compiler failing to load, without touching the module loader. */
const BrokenCompiler = Layer.succeed(
  TypeScriptCompiler,
  Effect.fail(new DependencyLoadError({ dependency: 'typescript', message: 'disk on fire' })),
)

describe('TypeScriptCompiler service', () => {
  it('parses when the live layer provides the real compiler', async () => {
    const result = await Effect.runPromise(
      parseTypesEffect('export interface User { id: number }', 'User').pipe(
        Effect.provide(TypeScriptCompilerLive),
      ),
    )

    expect(result.typeName).toBe('User')
    expect(result.shape.kind).toBe('object')
  })

  it('surfaces a compiler that cannot load as a ParseError, not a defect', async () => {
    const caught = await Effect.runPromise(
      parseTypesEffect('export interface User { id: number }', 'User').pipe(
        Effect.provide(BrokenCompiler),
        Effect.catchTag('ParseError', (e) => Effect.succeed(e.message)),
      ),
    )

    expect(caught).toContain('disk on fire')
  })

  it('loads the compiler once and reuses it across parses', async () => {
    let loads = 0
    const Counting = Layer.effect(
      TypeScriptCompiler,
      Effect.cached(
        Effect.promise(async () => {
          loads++
          return (await import('typescript')).default
        }),
      ),
    )

    const program = Effect.all([
      parseTypesEffect('export interface A { a: string }', 'A'),
      parseTypesEffect('export interface B { b: string }', 'B'),
    ]).pipe(Effect.provide(Counting))
    const [a, b] = await Effect.runPromise(program)

    expect([a.typeName, b.typeName]).toEqual(['A', 'B'])
    expect(loads).toBe(1)
  })

  it('keeps the Promise facade working without the caller providing anything', async () => {
    const result = await parseTypes('export interface User { id: number }', 'User')

    expect(result.ok).toBe(true)
  })
})
