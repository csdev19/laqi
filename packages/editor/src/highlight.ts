export type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'plain'

export type Token = { kind: TokenKind; text: string }

const STRING = /^"(?:[^"\\]|\\.)*"/
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/
const LITERAL = /^(?:true|false|null)\b/
const PUNCT = /^[{}[\],:]/

/**
 * Un tokenizer de JSON del tamaño justo para colorear. No valida ni parsea:
 * lo que no reconoce sale como `plain`, así que un archivo a medio escribir
 * se sigue pintando en vez de romper el editor.
 *
 * Un string es `key` sólo si lo sigue un `:` (saltando espacios) — es la
 * única diferencia que el ojo necesita entre la clave y el valor.
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

    // Nada reconocido: consumir un carácter para no colgarse nunca.
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

/** El readout bajo el editor: `valid JSON · 412 B`, o el error de parseo. */
export function checkJson(source: string): JsonCheck {
  try {
    JSON.parse(source)
    return { valid: true, bytes: new TextEncoder().encode(source).length }
  } catch (error) {
    return { valid: false, message: error instanceof Error ? error.message : String(error) }
  }
}
