export type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'plain'

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
