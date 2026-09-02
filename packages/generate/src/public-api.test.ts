import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import * as pkg from './index'
import { primitive } from './shape'

/**
 * Everything here imports from the package barrel and nothing else — the
 * view an external consumer gets from `import { … } from '@laqi/generate'`.
 *
 * The Effect programs declare their dependencies in `R`. Publishing them
 * while keeping the tags and layers internal would make the published type
 * impossible to satisfy: a consumer could hold a
 * `Effect<A, ParseError, TypeScriptCompiler>` and have no legitimate way to
 * provide `TypeScriptCompiler`. These tests are the contract that the
 * exported programs are actually runnable.
 */
describe('the barrel exports enough to run the Effect programs', () => {
  it('exports a tag and a live layer for every service a program requires', () => {
    expect(Object.keys(pkg)).toEqual(
      expect.arrayContaining([
        'TypeScriptCompiler',
        'TypeScriptCompilerLive',
        'FakerFactory',
        'FakerFactoryLive',
        'Quicktype',
        'QuicktypeLive',
        'GenerateServicesLive',
      ]),
    )
  })

  it('lets a consumer run parseTypesEffect with the exported layer', async () => {
    const result = await Effect.runPromise(
      pkg
        .parseTypesEffect('export interface User { id: number }', 'User')
        .pipe(Effect.provide(pkg.TypeScriptCompilerLive)),
    )

    expect(result.typeName).toBe('User')
  })

  it('lets a consumer build one runtime that satisfies every program', async () => {
    const runtime = ManagedRuntime.make(pkg.GenerateServicesLive)

    const [parsed, generated, printed, languages] = await Promise.all([
      runtime.runPromise(pkg.parseTypesEffect('export interface A { a: string }', 'A')),
      runtime.runPromise(pkg.generateEffect(primitive('string'), { seed: 1 })),
      runtime.runPromise(pkg.printTypesEffect(primitive('string'), { typeName: 'Thing' })),
      runtime.runPromise(pkg.supportedLanguagesEffect),
    ])
    await runtime.dispose()

    expect(parsed.typeName).toBe('A')
    expect(typeof generated).toBe('string')
    expect(printed.language).toBe('typescript')
    expect(languages.map((l) => l.name)).toContain('typescript')
  })

  it('lets a consumer substitute a service without touching the module loader', async () => {
    const Broken = Layer.succeed(
      pkg.Quicktype,
      Effect.fail(new pkg.DependencyLoadError({ dependency: 'quicktype-core', message: 'nope' })),
    )

    const caught = await Effect.runPromise(
      pkg.supportedLanguagesEffect.pipe(
        Effect.provide(Broken),
        Effect.catchTag('PrintError', (e) => Effect.succeed(e.message)),
      ),
    )

    expect(caught).toContain('nope')
  })
})
