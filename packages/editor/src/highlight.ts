export type TokenKind =
  | 'key'
  | 'string'
  | 'number'
  | 'literal'
  | 'punct'
  | 'plain'
  | 'keyword'
  | 'type'
  | 'comment'

export type Token = { kind: TokenKind; text: string }

const STRING = /^"(?:[^"\\]|\\.)*"/
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/
const LITERAL = /^(?:true|false|null)\b/
const PUNCT = /^[{}[\],:]/

/**
 * A JSON tokenizer just big enough to colorize. It neither validates nor
 * parses: whatever it doesn't recognize comes out as `plain`, so a
 * half-written file still paints instead of breaking the editor.
 *
 * A string is `key` only if it's followed by a `:` (skipping whitespace) —
 * that's the only difference the eye needs between a key and a value.
 */
export function tokenizeJson(source: string): Token[] {
  const tokens: Token[] = []
  let rest = source

  while (rest.length > 0) {
    const whitespace = /^\s+/.exec(rest)
    if (whitespace) {
      push('plain', whitespace[0])
      continue
    }

    const string = STRING.exec(rest)
    if (string) {
      const after = rest.slice(string[0].length)
      push(/^\s*:/.test(after) ? 'key' : 'string', string[0])
      continue
    }

    const literal = LITERAL.exec(rest)
    if (literal) {
      push('literal', literal[0])
      continue
    }

    const number = NUMBER.exec(rest)
    if (number) {
      push('number', number[0])
      continue
    }

    const punct = PUNCT.exec(rest)
    if (punct) {
      push('punct', punct[0])
      continue
    }

    // Nothing recognized: consume one character so it never hangs.
    push('plain', rest[0]!)
  }

  return tokens

  function push(kind: TokenKind, text: string): void {
    const last = tokens[tokens.length - 1]
    if (last && last.kind === kind) last.text += text
    else tokens.push({ kind, text })
    rest = rest.slice(text.length)
  }
}

const TS_COMMENT = /^(?:\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/
const TS_STRING = /^(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/
const TS_WORD = /^[A-Za-z_$][\w$]*/
const TS_PUNCT = /^[{}[\]()<>,:;|&=?.!]/

const TS_KEYWORDS = new Set([
  'interface',
  'type',
  'export',
  'import',
  'from',
  'extends',
  'implements',
  'readonly',
  'keyof',
  'typeof',
  'in',
  'as',
  'declare',
  'namespace',
  'enum',
  'const',
  'let',
  'var',
  'function',
  'class',
  'abstract',
  'infer',
  'unique',
  'satisfies',
  'default',
])
const TS_BUILTIN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'any',
  'unknown',
  'never',
  'void',
  'object',
])
const TS_LITERALS = new Set(['true', 'false', 'null', 'undefined'])

/**
 * A TypeScript tokenizer just big enough to colorize a pasted model. Same
 * contract as `tokenizeJson`: never validates, never drops a character, and
 * half-written source still paints. A word is a `type` when it is a builtin
 * or starts with a capital, and a `key` when a `:` (optionally `?:`) follows —
 * that is what distinguishes a property from a reference on screen.
 */
export function tokenizeTypeScript(source: string): Token[] {
  const tokens: Token[] = []
  let rest = source

  while (rest.length > 0) {
    const whitespace = /^\s+/.exec(rest)
    if (whitespace) {
      push('plain', whitespace[0])
      continue
    }

    const comment = TS_COMMENT.exec(rest)
    if (comment) {
      push('comment', comment[0])
      continue
    }

    const string = TS_STRING.exec(rest)
    if (string) {
      push('string', string[0])
      continue
    }

    const word = TS_WORD.exec(rest)
    if (word) {
      const text = word[0]
      const after = rest.slice(text.length)
      if (TS_KEYWORDS.has(text)) push('keyword', text)
      else if (TS_LITERALS.has(text)) push('literal', text)
      else if (TS_BUILTIN_TYPES.has(text) || /^[A-Z]/.test(text)) push('type', text)
      else if (/^\s*\??\s*:/.test(after)) push('key', text)
      else push('plain', text)
      continue
    }

    const number = NUMBER.exec(rest)
    if (number) {
      push('number', number[0])
      continue
    }

    const punct = TS_PUNCT.exec(rest)
    if (punct) {
      push('punct', punct[0])
      continue
    }

    push('plain', rest[0]!)
  }

  return tokens

  function push(kind: TokenKind, text: string): void {
    const last = tokens[tokens.length - 1]
    // Adjacent tokens of one kind merge, except keys and types: two
    // capitalised words are two names, not one.
    if (last && last.kind === kind && kind !== 'type' && kind !== 'key') last.text += text
    else tokens.push({ kind, text })
    rest = rest.slice(text.length)
  }
}

export type JsonCheck = { valid: true; bytes: number } | { valid: false; message: string }

/** The readout under the editor: `valid JSON · 412 B`, or the parse error. */
export function checkJson(source: string): JsonCheck {
  try {
    JSON.parse(source)
    return { valid: true, bytes: new TextEncoder().encode(source).length }
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : String(error) }
  }
}
