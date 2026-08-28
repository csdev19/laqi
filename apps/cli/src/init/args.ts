// apps/cli/src/init/args.ts

export type RawInitFlags = {
  dir?: string
  from?: string
  spec?: string
  port?: string
  /** `true` for bare `--script`, a string for `--script=name`. */
  script?: string | true
  open?: boolean
  force?: boolean
  yes?: boolean
  help?: boolean
}

export type ParseInitArgsResult = { ok: true; flags: RawInitFlags } | { ok: false; error: string }

const VALUE_FLAGS = ['--dir', '--from', '--spec', '--port'] as const
type ValueFlagKey = 'dir' | 'from' | 'spec' | 'port'
type BooleanFlagKey = 'open' | 'force' | 'yes' | 'help'

const BOOLEAN_FLAGS: Record<string, BooleanFlagKey> = {
  '--open': 'open',
  '--force': 'force',
  '--yes': 'yes',
  '--help': 'help',
  '-h': 'help',
}

/**
 * `laqi init` owns a flag vocabulary the shared `parseArgs` config in
 * index.ts does not declare (`--from`, `--spec`, `--script[=name]`, ...),
 * and `--script`'s optional value is not something node's `parseArgs` can
 * express — it always consumes the next token as the value once a `string`
 * option is declared. A small hand-written parser here is simpler than
 * fighting that API, and keeps `init`'s flags from ever colliding with the
 * top-level command's.
 */
export function parseInitArgs(argv: string[]): ParseInitArgsResult {
  const flags: RawInitFlags = {}

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!

    if (token === '--script') {
      flags.script = true
      continue
    }
    if (token.startsWith('--script=')) {
      const value = token.slice('--script='.length)
      if (value.length === 0) {
        return { ok: false, error: '--script needs a non-empty name, e.g. --script=mock.' }
      }
      flags.script = value
      continue
    }

    const booleanKey = BOOLEAN_FLAGS[token]
    if (booleanKey !== undefined) {
      flags[booleanKey] = true
      continue
    }

    const eq = token.indexOf('=')
    const name = eq === -1 ? token : token.slice(0, eq)

    if ((VALUE_FLAGS as readonly string[]).includes(name)) {
      const key = name.slice(2) as ValueFlagKey
      const value = eq === -1 ? argv[++i] : token.slice(eq + 1)
      if (value === undefined) return { ok: false, error: `${name} needs a value.` }
      flags[key] = value
      continue
    }

    return { ok: false, error: `laqi does not recognise the ${token} flag.` }
  }

  return { ok: true, flags }
}
