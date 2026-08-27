import { Data } from 'effect'

/** Parsing the pasted TypeScript failed before any shape was produced. */
export class ParseError extends Data.TaggedError('ParseError')<{
  readonly message: string
}> {}

/** Generation could not run (e.g. faker failed to load). */
export class GenerateError extends Data.TaggedError('GenerateError')<{
  readonly message: string
}> {}
