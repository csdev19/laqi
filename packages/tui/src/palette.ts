/**
 * Colour for the terminal, taken from the panel's palette so the two surfaces
 * agree. Written by hand rather than pulled from a dependency: it is a dozen
 * lines, and `apps/cli/src/package.test.ts` pins the published dependency list.
 */

export type Level = 'truecolor' | 'ansi256' | 'none'

export type Token =
  | 'bolt'
  | 'label'
  | 'value'
  | 'accent'
  | 'fatal'
  | 'degraded'
  | 'notice'
  | 'recovered'
  | 'dim'

/** The panel's values, so both surfaces read as one product. */
const RGB: Record<Token, readonly [number, number, number]> = {
  bolt: [0x8b, 0x5c, 0xf6],
  label: [0x6b, 0x66, 0x80],
  value: [0xea, 0xe7, 0xf2],
  accent: [0x00, 0xff, 0xc2],
  fatal: [0xff, 0x00, 0x58],
  degraded: [0xff, 0x7a, 0xc8],
  notice: [0x8b, 0x5c, 0xf6],
  recovered: [0x00, 0xff, 0xc2],
  dim: [0x6b, 0x66, 0x80],
}

export function detectLevel(env: Record<string, string | undefined>, isTTY: boolean): Level {
  // Presence is the signal, not the value — an empty NO_COLOR still means off.
  if (env.NO_COLOR !== undefined) return 'none'
  if (env.TERM === 'dumb') return 'none'
  if (!isTTY) return 'none'
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'truecolor'
  return 'ansi256'
}

/** Quantize a colour channel to 6 levels for the ANSI 256-colour cube. */
function quantize(v: number): number {
  return Math.round((v / 255) * 5)
}

/** The 6x6x6 cube plus the grey ramp, which is what 256-colour terminals have. */
function toAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16
    if (r > 248) return 231
    return Math.round(((r - 8) / 247) * 24) + 232
  }
  return 16 + 36 * quantize(r) + 6 * quantize(g) + quantize(b)
}

export function paint(text: string, token: Token, level: Level): string {
  if (level === 'none') return text
  const [r, g, b] = RGB[token]
  const prefix =
    level === 'truecolor' ? `\u001b[38;2;${r};${g};${b}m` : `\u001b[38;5;${toAnsi256(r, g, b)}m`
  return `${prefix}${text}\u001b[0m`
}
