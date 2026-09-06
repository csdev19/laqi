import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { EXAMPLE_BODIES, EXAMPLE_MODELS, exampleBody, exampleModel } from './examples'
import { inferShape } from './infer'
import { parseTypes } from './parse-types'
import { printTypes } from './print-types'
import type { Shape } from './shape'

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

  it('offers four models, each with a title and a blurb', () => {
    expect(EXAMPLE_MODELS.map((m) => m.id)).toEqual(['simple', 'medium', 'complex', 'flat'])
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

describe('the flat model', () => {
  // Its whole point is having nothing to flatten: one declaration, no
  // extends, no aliases. If a helper type ever creeps in, the model stops
  // testing what it was written to test.
  it('declares exactly one type, and inherits from nothing', () => {
    const source = exampleModel('flat').source

    expect(source.match(/^(export )?(interface|type) /gm)).toHaveLength(1)
    expect(source).not.toContain('extends')
    expect(source).not.toContain('import')
  })

  it('parses without a warning, four levels down', async () => {
    const result = await parseTypes(exampleModel('flat').source, 'Invoice')
    if (!result.ok) throw new Error(result.error)

    expect(result.warnings).toEqual([])
    const at = (shape: Shape, path: string): Shape => {
      let current = shape
      for (const step of path.split('.')) {
        if (current.kind === 'array') current = current.items
        if (current.kind !== 'object') throw new Error(`${path}: ${step} is not on an object`)
        const field = current.fields.find((f) => f.name === step)
        if (!field) throw new Error(`${path}: no field ${step}`)
        current = field.shape
      }
      return current
    }

    expect(at(result.shape, 'customer.billing.contact.preferred')).toEqual({
      kind: 'literals',
      values: ['email', 'phone', 'none'],
    })
    expect(at(result.shape, 'customer.billing.coordinates')).toEqual({
      kind: 'tuple',
      items: [
        { kind: 'primitive', type: 'number' },
        { kind: 'primitive', type: 'number' },
      ],
    })
    expect(at(result.shape, 'lines.discount.percent')).toEqual({
      kind: 'primitive',
      type: 'number',
    })
  })
})

describe('the example bodies', () => {
  it.each(EXAMPLE_BODIES.map((body) => [body.id, body.source] as const))(
    '%s is valid JSON',
    (_id, source) => {
      expect(() => JSON.parse(source)).not.toThrow()
    },
  )

  it('finds a body by id and refuses an unknown one', () => {
    expect(exampleBody('invoice').title).toBe('invoice')
    // @ts-expect-error the id is a union; this is the runtime guard
    expect(() => exampleBody('nope')).toThrow(/nope/)
  })

  // The round trip the JSON flow is for: paste a body, and the endpoint can
  // hand back the model behind it.
  it('turns the invoice body back into the interface the flat model declares', async () => {
    const body: unknown = JSON.parse(exampleBody('invoice').source)
    const { code } = await printTypes(inferShape(body), { typeName: 'Invoice' })

    expect(code).toContain('Invoice')
    for (const field of ['number', 'status', 'customer', 'lines', 'totals', 'payments']) {
      expect(code, field).toContain(field)
    }
  })

  it('describes the same fields the flat model does', async () => {
    const parsed = await parseTypes(exampleModel('flat').source, 'Invoice')
    if (!parsed.ok) throw new Error(parsed.error)
    if (parsed.shape.kind !== 'object') throw new Error('the flat model is not an object')

    const inferred = inferShape(JSON.parse(exampleBody('invoice').source))
    if (inferred.kind !== 'object') throw new Error('the invoice body is not an object')

    const declared = parsed.shape.fields.map((f) => f.name).sort()
    expect(inferred.fields.map((f) => f.name).sort()).toEqual(declared)
  })
})
