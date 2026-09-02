import { Data } from 'effect'

/** Parsing the pasted TypeScript failed before any shape was produced. */
export class ParseError extends Data.TaggedError('ParseError')<{
  readonly message: string
}> {}

/** Generation could not run (e.g. faker failed to load). */
export class GenerateError extends Data.TaggedError('GenerateError')<{
  readonly message: string
}> {}

/** Printing types failed — unknown language or quicktype itself failed. */
export class PrintError extends Data.TaggedError('PrintError')<{
  readonly message: string
}> {}

/**
 * A heavy dependency behind a dynamic `import()` failed to load. Distinct
 * from the domain errors above: nothing about the caller's input caused it.
 * Each program maps it to its own domain error at the point of use, so the
 * public error contracts stay exactly as narrow as they were.
 */
export class DependencyLoadError extends Data.TaggedError('DependencyLoadError')<{
  readonly dependency: string
  readonly message: string
}> {}
