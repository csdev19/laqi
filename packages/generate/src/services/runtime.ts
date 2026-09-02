import { Layer, ManagedRuntime } from 'effect'
import { TypeScriptCompilerLive } from './compiler'

/** Every service the package's own programs need. */
export const GenerateServicesLive = Layer.mergeAll(TypeScriptCompilerLive)

type Runtime = ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof GenerateServicesLive>,
  never
>

let instance: Runtime | undefined

/**
 * The runtime the Promise facades run on, created on first use and never
 * disposed.
 *
 * That is only defensible because of what these layers contain: lazy
 * dynamic imports and nothing else — no file handles, no workers, no
 * telemetry exporter, nothing with a finalizer worth running. The moment a
 * layer here acquires a real resource, this stops being the right owner and
 * the process owner (the CLI, or the MCP server) has to create and dispose
 * a `ManagedRuntime` instead, providing it to the Effect programs directly.
 *
 * Lazy on purpose, too: nothing about importing `@laqi/generate` should
 * build a runtime, and `lazy-deps.test.ts` fails if that ever changes.
 */
export const generateRuntime = (): Runtime =>
  (instance ??= ManagedRuntime.make(GenerateServicesLive))
