import { Effect } from 'effect'
import { ParseError } from './errors'
import { TypeScriptCompiler } from './services/compiler'
import { generateRuntime } from './services/runtime'
import { primitive, type Shape, type ShapeField } from './shape'

export type ParsedModel =
  | { ok: true; shape: Shape; typeName: string; warnings: string[] }
  | { ok: false; error: string }

const VIRTUAL_FILE = '__laqi_pasted__.ts'
const MAX_DEPTH = 10

/**
 * Ceiling on the pasted source handed to the compiler. `createProgram` plus
 * a full checker walk is superlinear in source size, and this runs on the
 * same single thread as the mock server — a multi-megabyte paste (or an
 * agent looping a file into `generate_data`) would stall every other
 * request. 200k characters is far past any hand-pasted model (a large API
 * model file is tens of KB) and cheap to reject before the 23 MB compiler
 * is even loaded.
 */
export const MAX_SOURCE_LENGTH = 200_000

/** The readable half of an unknown thrown value, for a user-facing message. */
const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

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
): Effect.Effect<
  { shape: Shape; typeName: string; warnings: string[] },
  ParseError,
  TypeScriptCompiler
> =>
  Effect.gen(function* () {
    if (source.length > MAX_SOURCE_LENGTH) {
      return yield* Effect.fail(
        new ParseError({
          message:
            `the pasted source is ${source.length} characters; ` +
            `the limit is ${MAX_SOURCE_LENGTH} — paste just the model you want to generate`,
        }),
      )
    }

    // The compiler arrives as a service now, not a bare import: a test can
    // hand this program a stub or a failing loader without reaching for the
    // module loader. Its load failure is mapped here, so this program's
    // error channel stays exactly `ParseError`.
    const loadCompiler = yield* TypeScriptCompiler
    const ts = yield* Effect.mapError(
      loadCompiler,
      (cause) =>
        new ParseError({ message: `could not load the TypeScript compiler: ${cause.message}` }),
    )

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

    // Syntactic diagnostics only, and BEFORE any declaration is inspected.
    // The compiler recovers an AST from broken source — a truncated
    // interface still yields declarations — so without this a corrupt or
    // half-pasted model would silently generate mocks from whatever the
    // recovery happened to salvage. Semantic diagnostics are deliberately
    // NOT consulted: an import we cannot resolve is the normal case here
    // and degrades to `unknown` plus a warning further down.
    const syntaxErrors = program.getSyntacticDiagnostics(file)
    const firstSyntaxError = syntaxErrors[0]
    if (firstSyntaxError) {
      const { line } = file.getLineAndCharacterOfPosition(firstSyntaxError.start ?? 0)
      const detail = ts.flattenDiagnosticMessageText(firstSyntaxError.messageText, ' ')
      return yield* Effect.fail(
        new ParseError({ message: `syntax error at line ${line + 1}: ${detail}` }),
      )
    }

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
        // A real tuple, not an approximation: each position keeps its own
        // type and the arity is preserved (see Shape's `tuple` kind).
        const itemShapes = elements.map((element, index) =>
          toShape(element, `${path}[${index}]`, depth + 1),
        )
        return { kind: 'tuple', items: itemShapes }
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
  }).pipe(
    // Everything between the import and the returned shape is plain
    // synchronous compiler work: `createProgram`, the checker, and the
    // `toShape` recursion. A throw from any of it is an Effect *defect* —
    // invisible to `catchTag('ParseError')` and surfacing to the caller as
    // a raw FiberFailure, which would make the declared `ParseError` error
    // channel a lie. Failing to parse is exactly what this function is for,
    // so a defect here is converted into the one error it is allowed to
    // have rather than left to escape.
    Effect.catchAllDefect((defect) =>
      Effect.fail(
        new ParseError({ message: `could not parse the pasted source: ${reason(defect)}` }),
      ),
    ),
  )

/**
 * Promise facade preserving today's exact contract: `{ok:true,...}` on
 * success, `{ok:false,error}` on failure — never a rejected promise for an
 * expected parse failure.
 */
export async function parseTypes(source: string, typeName?: string): Promise<ParsedModel> {
  return generateRuntime().runPromise(
    parseTypesEffect(source, typeName).pipe(
      Effect.map((value) => ({ ok: true as const, ...value })),
      Effect.catchTag('ParseError', (e) =>
        Effect.succeed({ ok: false as const, error: e.message }),
      ),
    ),
  )
}
