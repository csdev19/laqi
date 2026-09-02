/**
 * The service layer of the package, exported because the `*Effect` programs
 * are public API: each declares what it needs in `R`, and a consumer that
 * cannot reach the tags and layers has no legitimate way to satisfy that.
 *
 * `generateRuntime` is deliberately NOT re-exported. It is the runtime the
 * package's own Promise facades run on — a consumer building Effect programs
 * should own its runtime, per the note in `runtime.ts`.
 */
export { TypeScriptCompiler, TypeScriptCompilerLive } from './compiler'
export { FakerFactory, FakerFactoryLive } from './faker'
export { Quicktype, QuicktypeLive } from './quicktype'
export { GenerateServicesLive } from './runtime'
