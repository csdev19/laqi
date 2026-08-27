import { Effect } from 'effect'
import { ParseError } from './errors'
import { mergeShapes } from './infer'
import { primitive, type Shape, type ShapeField } from './shape'

export type ParsedModel =
  | { ok: true; shape: Shape; typeName: string; warnings: string[] }
  | { ok: false; error: string }

const VIRTUAL_FILE = '__laqi_pasted__.ts'
const MAX_DEPTH = 10

/**
 * Pasted TS source → Shape, using the real TypeScript checker.
 *
 * The real compiler and not a hand-rolled parser, on purpose: real-world
 * models arrive dirty — `extends`, `Pick<...> & {...}`, imports from
 * libraries that are not present here. The checker flattens all of that
 * (spike-verified), and an unresolvable import degrades the property to
 * `any`, which we surface as `unknown` plus a warning instead of failing.
 *
 * Dynamic import: the compiler is 23 MB and startup must not pay for it.
 */
export const parseTypesEffect = (
  source: string,
  typeName?: string,
): Effect.Effect<{ shape: Shape; typeName: string; warnings: string[] }, ParseError> =>
  Effect.gen(function* () {
    const ts = yield* Effect.promise(() => import('typescript').then((m) => m.default))

    const options: import('typescript').CompilerOptions = {
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    }

    // An in-memory host: serves the pasted source for one virtual filename
    // and delegates lib resolution to the real filesystem, so `Date` and
    // friends resolve instead of collapsing to `any`.
    const host = ts.createCompilerHost(options)
    const readFile = host.readFile.bind(host)
    const fileExists = host.fileExists.bind(host)
    const getSourceFile = host.getSourceFile.bind(host)
    host.readFile = (name) => (name === VIRTUAL_FILE ? source : readFile(name))
    host.fileExists = (name) => name === VIRTUAL_FILE || fileExists(name)
    host.getSourceFile = (name, lang, onError, create) =>
      name === VIRTUAL_FILE
        ? ts.createSourceFile(VIRTUAL_FILE, source, lang, true)
        : getSourceFile(name, lang, onError, create)

    const program = ts.createProgram([VIRTUAL_FILE], options, host)
    const checker = program.getTypeChecker()
    const file = program.getSourceFile(VIRTUAL_FILE)
    if (!file)
      return yield* Effect.fail(new ParseError({ message: 'could not parse the pasted source' }))

    type Declaration =
      | import('typescript').InterfaceDeclaration
      | import('typescript').TypeAliasDeclaration
    const declarations: Declaration[] = []
    for (const statement of file.statements) {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        declarations.push(statement)
      }
    }
    if (declarations.length === 0) {
      return yield* Effect.fail(
        new ParseError({ message: 'no interface or type alias found in the pasted source' }),
      )
    }

    const isExported = (d: Declaration) =>
      d.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
    const target = typeName
      ? declarations.find((d) => d.name.text === typeName)
      : (declarations.find(isExported) ?? declarations[0])
    if (!target) {
      const known = declarations.map((d) => d.name.text).join(', ')
      return yield* Effect.fail(
        new ParseError({ message: `no type named ${JSON.stringify(typeName)} — found: ${known}` }),
      )
    }

    const warnings: string[] = []
    const seen = new Set<import('typescript').Type>()

    function toShape(type: import('typescript').Type, path: string, depth: number): Shape {
      if (depth > MAX_DEPTH) {
        warnings.push(`${path}: nesting deeper than ${MAX_DEPTH} levels — cut off as unknown`)
        return { kind: 'unknown' }
      }
      if (seen.has(type)) {
        warnings.push(`${path}: circular reference — generated as unknown`)
        return { kind: 'unknown' }
      }

      if (type.flags & ts.TypeFlags.Any || type.flags & ts.TypeFlags.Unknown) {
        warnings.push(
          `${path}: unresolvable type (likely an import that is not present) — generated as unknown`,
        )
        return { kind: 'unknown' }
      }
      if (type.flags & ts.TypeFlags.Null) return primitive('null')
      // The plain `boolean` type is internally the union `true | false`, but it
      // carries this specific flag (distinct from the `BooleanLiteral` flag a
      // lone `true`/`false` carries) so it can be recognised before the union
      // branch below would otherwise shred it into a two-member literal union.
      if (type.flags & ts.TypeFlags.Boolean) return primitive('boolean')

      // Literals and unions come BEFORE the broad string/number flags: a
      // string literal also carries StringLike, a boolean literal also
      // carries BooleanLike.
      if (type.isStringLiteral()) return { kind: 'literals', values: [type.value] }
      if (type.isNumberLiteral()) return { kind: 'literals', values: [type.value] }
      if (type.flags & ts.TypeFlags.BooleanLiteral) {
        return { kind: 'literals', values: [checker.typeToString(type) === 'true'] }
      }
      if (type.isUnion()) {
        // `undefined` is how optional properties are modelled; `null` defers
        // to the other side the same way `mergeShapes` treats it (there is
        // nothing to generate from a null). The checker does not preserve
        // source order once these are stripped.
        const members = type.types.filter(
          (t) => !(t.flags & ts.TypeFlags.Undefined) && !(t.flags & ts.TypeFlags.Null),
        )
        if (members.length === 0) return primitive('null')
        if (members.length === 1) return toShape(members[0]!, path, depth)
        const literals: (string | number | boolean)[] = []
        for (const member of members) {
          if (member.isStringLiteral() || member.isNumberLiteral()) literals.push(member.value)
          else if (member.flags & ts.TypeFlags.BooleanLiteral)
            literals.push(checker.typeToString(member) === 'true')
        }
        if (literals.length === members.length) return { kind: 'literals', values: literals }
        warnings.push(
          `${path}: mixed union — narrowed to ${checker.typeToString(members[0]!)} ` +
            `(the checker does not preserve source order, so this is not necessarily the first member as written)`,
        )
        return toShape(members[0]!, path, depth)
      }

      if (type.flags & ts.TypeFlags.StringLike) return primitive('string')
      if (type.flags & ts.TypeFlags.NumberLike) return primitive('number')
      if (type.symbol?.name === 'Date') return primitive('date')

      // Tuples must be checked before the object branch: a tuple type also
      // exposes `Array.prototype` members through `getProperties()`, which
      // would otherwise be enumerated as object fields.
      if (checker.isTupleType(type)) {
        const elements = checker.getTypeArguments(type as import('typescript').TypeReference)
        if (elements.length === 0) return { kind: 'array', items: { kind: 'unknown' } }
        warnings.push(`${path}: tuple type approximated as an array of its widened element type`)
        const itemShapes = elements.map((element, index) =>
          toShape(element, `${path}[${index}]`, depth + 1),
        )
        return { kind: 'array', items: itemShapes.reduce((a, b) => mergeShapes(a, b)) }
      }

      if (checker.isArrayType(type)) {
        const [items] = checker.getTypeArguments(type as import('typescript').TypeReference)
        return {
          kind: 'array',
          items: items ? toShape(items, `${path}[]`, depth + 1) : { kind: 'unknown' },
        }
      }

      if (type.getCallSignatures().length > 0) {
        warnings.push(`${path}: functions cannot be generated — unknown`)
        return { kind: 'unknown' }
      }

      const stringIndex = type.getStringIndexType()
      const properties = type.getProperties()
      if (stringIndex && properties.length === 0) {
        return { kind: 'record', values: toShape(stringIndex, `${path}{}`, depth + 1) }
      }
      if (stringIndex && properties.length > 0) {
        warnings.push(
          `${path}: has both named properties and a string index signature — the index signature is not represented`,
        )
      }

      if (properties.length > 0 || type.flags & ts.TypeFlags.Object) {
        seen.add(type)
        const fields: ShapeField[] = properties.map((prop) => {
          const propType = checker.getTypeOfSymbolAtLocation(prop, file!)
          const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0
          return {
            name: prop.name,
            shape: toShape(propType, `${path}.${prop.name}`, depth + 1),
            optional,
          }
        })
        seen.delete(type)
        return { kind: 'object', fields }
      }

      warnings.push(`${path}: unsupported construct (${checker.typeToString(type)}) — unknown`)
      return { kind: 'unknown' }
    }

    const rootType = checker.getTypeAtLocation(target.name)
    const shape = toShape(rootType, target.name.text, 0)
    return { shape, typeName: target.name.text, warnings }
  })

/**
 * Promise facade preserving today's exact contract: `{ok:true,...}` on
 * success, `{ok:false,error}` on failure — never a rejected promise for an
 * expected parse failure.
 */
export async function parseTypes(source: string, typeName?: string): Promise<ParsedModel> {
  return Effect.runPromise(
    parseTypesEffect(source, typeName).pipe(
      Effect.map((value) => ({ ok: true as const, ...value })),
      Effect.catchTag('ParseError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
    ),
  )
}
