import { z } from 'zod'

/**
 * What a diagnostic is about.
 *
 * `loss` means the document does not say what the source said. `information`
 * means laqi did something worth telling the user that changed no meaning.
 * A rejected import is `loss` too: nothing of the source survived it.
 */
export type DiagnosticKind = 'loss' | 'information'

/**
 * Whether the import can proceed at all. `error` is never bypassable;
 * `warning` blocks under the strict default and may be acknowledged when the
 * code says so.
 */
export type DiagnosticSeverity = 'warning' | 'error'

export type DiagnosticEntry = {
  kind: DiagnosticKind
  severity: DiagnosticSeverity
  /**
   * Whether `allowLoss: true` may store this approximation. Not derivable
   * from severity: `loss.depth` is a warning that still refuses, because the
   * fix is to raise the budget or trim the source, not to accept a truncated
   * document.
   */
  acknowledgeable: boolean
  /** The one-line rule, kept beside the code so the table is the documentation. */
  raisedWhen: string
}

/**
 * Every diagnostic laqi can raise. Codes are part of the persisted contract:
 * they are written into a mock file, read back after a restart, and shown in
 * the panel, so they are stable once shipped.
 */
export const DIAGNOSTIC_CODES = {
  'loss.unresolved-type': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: true,
    raisedWhen: 'a TypeScript type resolved to any or unknown, usually an absent import',
  },
  'loss.union-narrowed': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: true,
    raisedWhen: 'a mixed union was narrowed to one member',
  },
  'loss.function': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: true,
    raisedWhen: 'a callable type has no data form',
  },
  'loss.index-signature': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: true,
    raisedWhen: 'named properties and a string index existed together; the index was dropped',
  },
  'loss.depth': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: false,
    raisedWhen: 'nesting exceeded the budget',
  },
  'loss.circular': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: true,
    raisedWhen: 'a self-reference was cut',
  },
  'loss.approximated': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: true,
    raisedWhen: 'an acknowledged generation approximation was applied',
  },
  'unsupported.keyword': {
    kind: 'loss',
    severity: 'error',
    acknowledgeable: false,
    raisedWhen: 'a keyword outside the supported vocabulary',
  },
  'unsupported.combination': {
    kind: 'loss',
    severity: 'error',
    acknowledgeable: false,
    raisedWhen: 'an anyOf, oneOf or allOf case outside the supported set',
  },
  'invalid.document': {
    kind: 'loss',
    severity: 'error',
    acknowledgeable: false,
    raisedWhen: 'not a JSON Schema, or it fails the meta-schema',
  },
  unsatisfiable: {
    kind: 'loss',
    severity: 'error',
    acknowledgeable: false,
    raisedWhen: 'no JSON value can satisfy the document',
  },
  'dialect.unknown': {
    kind: 'loss',
    severity: 'error',
    acknowledgeable: false,
    raisedWhen: '$schema names a dialect laqi does not normalize',
  },
  'dialect.normalized': {
    kind: 'information',
    severity: 'warning',
    acknowledgeable: false,
    raisedWhen: 'draft-07 or OpenAPI 3.0 forms were rewritten to 2020-12',
  },
  'budget.exceeded': {
    kind: 'loss',
    severity: 'error',
    acknowledgeable: false,
    raisedWhen: 'bytes, nodes, references or output values exceeded a limit',
  },
  'side.selected': {
    kind: 'information',
    severity: 'warning',
    acknowledgeable: false,
    raisedWhen: 'which Standard JSON Schema side was used',
  },
  'adapter.unknown': {
    kind: 'loss',
    severity: 'error',
    acknowledgeable: false,
    raisedWhen: 'the request names a source kind no adapter serves',
  },
  'export.tuple-approximated': {
    kind: 'loss',
    severity: 'warning',
    acknowledgeable: true,
    raisedWhen: 'an exporter rendered a tuple as a union-typed array',
  },
} as const satisfies Record<string, DiagnosticEntry>

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES

export type Diagnostic = {
  code: DiagnosticCode
  severity: DiagnosticSeverity
  kind: DiagnosticKind
  /** JSON Pointer into the source where one exists; '' otherwise. */
  pointer: string
  message: string
}

/**
 * The only way to build a diagnostic. Kind and severity come from the code,
 * so a call site cannot quietly disagree with the table — which matters,
 * because the strict loss policy reads `kind` to decide whether to refuse.
 */
export function diagnostic(code: DiagnosticCode, message: string, pointer = ''): Diagnostic {
  const entry = DIAGNOSTIC_CODES[code]
  return { code, kind: entry.kind, severity: entry.severity, pointer, message }
}

/** Whether `allowLoss: true` is permitted to store this diagnostic's approximation. */
export function isAcknowledgeable(code: DiagnosticCode): boolean {
  return DIAGNOSTIC_CODES[code].acknowledgeable
}

const isDiagnosticCode = (code: string): code is DiagnosticCode => code in DIAGNOSTIC_CODES

/**
 * Validation for a diagnostic read back from disk. Beyond the shape it
 * checks the code against the table: a stored diagnostic whose kind or
 * severity was edited no longer means what the loss policy would read it to
 * mean, so it is refused rather than trusted.
 *
 * The code is validated by hand rather than with `z.enum` so the message can
 * name the code the file actually carried. A reader looking at a rejected
 * mock file needs to see their own typo, not a list of sixteen alternatives.
 */
export const DiagnosticSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['warning', 'error']),
    kind: z.enum(['loss', 'information']),
    pointer: z.string(),
    message: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (!isDiagnosticCode(value.code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: `${JSON.stringify(value.code)} is not a diagnostic laqi raises`,
      })
      return
    }
    const entry = DIAGNOSTIC_CODES[value.code]
    if (value.kind !== entry.kind) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: `${value.code} is always kind "${entry.kind}", not "${value.kind}"`,
      })
    }
    if (value.severity !== entry.severity) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: `${value.code} is always severity "${entry.severity}", not "${value.severity}"`,
      })
    }
  })
  // Identity at run time. It exists so the parsed value carries
  // `DiagnosticCode` rather than `string`: the refinement above already
  // proved it, and every consumer indexes the table with it.
  .transform((value): Diagnostic => value as Diagnostic)
