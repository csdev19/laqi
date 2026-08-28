// apps/cli/src/init/options.ts
//
// A pure function from flags to a fully-resolved plan — no I/O. This is what
// makes the two audiences (a person answering prompts, an agent passing
// flags) testable against the same target: the resolver does not know or
// care which one produced its input, and the interactive prompts due in a
// later pass only need to translate answers into this same `RawInitFlags`
// shape and call this function, same as the agent path already does.
import type { RawInitFlags } from './args'

export type InitFrom = 'example' | 'empty' | 'openapi'

export type InitOptions = {
  dir: string
  from: InitFrom
  /** Only meaningful when `from === 'openapi'`; the resolver enforces that. */
  spec?: string
  port: number
  /** `false` means "no script" — the default, since it is the one flag that
   *  reaches outside the mocks folder. */
  script: string | false
  open: boolean
  force: boolean
}

export type ResolveInitOptionsResult =
  | { ok: true; options: InitOptions }
  | { ok: false; error: string }

const ALLOWED_FROM: readonly InitFrom[] = ['example', 'empty', 'openapi']
const DEFAULT_SCRIPT_NAME = 'mock'
export const DEFAULT_PORT = 8000
export const DEFAULT_DIR = 'laqi'

export function resolveInitOptions(flags: RawInitFlags): ResolveInitOptionsResult {
  const dir = normaliseDir(flags.dir)

  const from = flags.from ?? 'example'
  if (from === 'scan') {
    return {
      ok: false,
      error:
        '--from scan is not implemented yet. laqi init ships with example, empty and openapi — reading fetch calls out of your source is its own spec.',
    }
  }
  if (!isInitFrom(from)) {
    return {
      ok: false,
      error: `--from must be one of ${ALLOWED_FROM.join(', ')}, got ${JSON.stringify(from)}.`,
    }
  }
  if (from === 'openapi' && flags.spec === undefined) {
    return {
      ok: false,
      error: '--from openapi needs --spec <path>, pointing at a JSON OpenAPI document.',
    }
  }

  const port = resolvePort(flags.port)
  if (port === null) {
    return {
      ok: false,
      error: `--port must be a whole number between 0 and 65535, got ${JSON.stringify(flags.port)}.`,
    }
  }

  const script = resolveScript(flags.script)
  if (script === undefined) {
    return { ok: false, error: '--script needs a non-empty name, e.g. --script=mock.' }
  }

  return {
    ok: true,
    options: {
      dir,
      from,
      spec: flags.spec,
      port,
      script,
      open: flags.open === true,
      force: flags.force === true,
    },
  }
}

function normaliseDir(raw: string | undefined): string {
  const trimmed = raw?.trim()
  if (trimmed === undefined || trimmed.length === 0) return DEFAULT_DIR
  const stripped = trimmed.replace(/\/+$/, '')
  return stripped.length > 0 ? stripped : DEFAULT_DIR
}

function isInitFrom(value: string): value is InitFrom {
  return (ALLOWED_FROM as readonly string[]).includes(value)
}

function resolvePort(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null
  return port
}

/** `undefined` is the error sentinel — distinct from the valid `false`. */
function resolveScript(raw: RawInitFlags['script']): string | false | undefined {
  if (raw === undefined) return false
  if (raw === true) return DEFAULT_SCRIPT_NAME
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
