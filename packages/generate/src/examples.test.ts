import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_MODELS, exampleModel } from './examples'

// These strings are offered in the panel as a starting point and pasted
// into real projects, so "it is valid TypeScript" cannot be an assumption.
// Compiling each one here checks the exact text that ships — stronger than
// `tsc` over a fixture file, which would only prove that a copy compiled.

const VIRTUAL = '__laqi_example__.ts'

function compile(source: string): { syntactic: string[]; semantic: string[] } {
  const options: ts.CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    noUnusedLocals: false,
    target: ts.ScriptTarget.ES2022,
  }

  const host = ts.createCompilerHost(options)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  host.readFile = (name) => (name === VIRTUAL ? source : readFile(name))
  host.fileExists = (name) => name === VIRTUAL || fileExists(name)
  host.getSourceFile = (name, lang, onError, create) =>
    name === VIRTUAL
      ? ts.createSourceFile(VIRTUAL, source, lang, true)
      : getSourceFile(name, lang, onError, create)

  const program = ts.createProgram([VIRTUAL], options, host)
  const file = program.getSourceFile(VIRTUAL)!
  const text = (diagnostics: readonly ts.Diagnostic[]) =>
    diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))

  return {
    syntactic: text(program.getSyntacticDiagnostics(file)),
    semantic: text(program.getSemanticDiagnostics(file)),
  }
}

describe('the example models', () => {
  it.each(EXAMPLE_MODELS.map((model) => [model.id, model.source] as const))(
    'compiles %s with nothing to report',
    (_id, source) => {
      expect(compile(source)).toEqual({ syntactic: [], semantic: [] })
    },
  )

  it('names a type each source actually declares', () => {
    for (const model of EXAMPLE_MODELS) {
      expect(model.source, model.id).toContain(model.typeName)
    }
  })

  it('offers three models, each with a title and a blurb', () => {
    expect(EXAMPLE_MODELS.map((m) => m.id)).toEqual(['simple', 'medium', 'complex'])
    for (const model of EXAMPLE_MODELS) {
      expect(model.title.length, model.id).toBeGreaterThan(0)
      expect(model.blurb.length, model.id).toBeGreaterThan(0)
    }
  })

  // The panel pastes `source` straight into an editor, where a missing
  // trailing newline leaves the caret on the closing brace's line.
  it('ends every source with exactly one newline', () => {
    for (const model of EXAMPLE_MODELS) {
      expect(model.source.endsWith('}\n'), model.id).toBe(true)
    }
  })

  it('finds a model by id and refuses an unknown one', () => {
    expect(exampleModel('complex').typeName).toBe('Order')
    // @ts-expect-error the id is a union; this is the runtime guard
    expect(() => exampleModel('nope')).toThrow(/nope/)
  })
})
