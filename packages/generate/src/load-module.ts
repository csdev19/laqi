import { spawn } from 'node:child_process'
import { DIALECT_2020_12 } from '@laqi/schema'

/** How long a module gets to import itself and convert. Then the child dies. */
export const MODULE_LOAD_TIMEOUT_MS = 10_000

export type ModuleLoadRequest = {
  /** An already-resolved absolute path. Confinement is the caller's job. */
  resolvedPath: string
  exportName: string
  side: 'input' | 'output'
}

export type ModuleLoadResult =
  | { ok: true; document: Record<string, unknown> }
  | { ok: false; error: string; code: ModuleLoadFailure }

/**
 * Why a load failed, so a transport can say something better than "it broke".
 *
 * - `not-found`   the module has no such export
 * - `capability`  the export is not a Standard JSON Schema source
 * - `conversion`  the vendor's converter threw; the message is theirs
 * - `crashed`     the module itself threw, or the child died
 * - `timeout`     the module never finished; the child was killed
 */
export type ModuleLoadFailure = 'not-found' | 'capability' | 'conversion' | 'crashed' | 'timeout'

/**
 * The program the child runs. A string rather than a file on disk because
 * laqi ships as one bundle: a sibling script would have to survive bundling,
 * installation and every packaging change, and the first time it did not the
 * failure would be a module loader that silently could not find itself.
 *
 * The request arrives through the environment, not argv, so nothing has to
 * survive a shell's idea of quoting.
 */
const CHILD = `
const { pathToFileURL } = require('node:url')
const request = JSON.parse(process.env.LAQI_MODULE_REQUEST)

function say(result) {
  process.stdout.write(JSON.stringify(result))
}

import(pathToFileURL(request.resolvedPath).href).then((module) => {
  const value = module[request.exportName]
  if (value === undefined) {
    const named = Object.keys(module).filter((key) => key !== 'default')
    say({
      ok: false,
      code: 'not-found',
      error:
        'no export named ' + JSON.stringify(request.exportName) +
        (named.length > 0 ? '. This module exports: ' + named.join(', ') : '. This module exports nothing'),
    })
    return
  }

  // Capability is discovered, never assumed from a vendor name: any object
  // that offers the conversion is a source, and one that does not is not,
  // whichever library it came from.
  const standard = value === null ? undefined : value['~standard']
  const convert = standard && standard.jsonSchema && standard.jsonSchema[request.side]
  if (typeof convert !== 'function') {
    const vendor = standard && standard.vendor ? ' (' + standard.vendor + ')' : ''
    say({
      ok: false,
      code: 'capability',
      error:
        JSON.stringify(request.exportName) + vendor +
        ' does not offer Standard JSON Schema conversion, so laqi cannot read a schema from it',
    })
    return
  }

  let document
  try {
    document = convert({ target: 'draft-2020-12' })
  } catch (cause) {
    say({
      ok: false,
      code: 'conversion',
      error: cause && cause.message ? cause.message : String(cause),
    })
    return
  }

  say({ ok: true, document })
}).catch((cause) => {
  say({ ok: false, code: 'crashed', error: cause && cause.message ? cause.message : String(cause) })
})
`

/**
 * Imports one of the user's modules and converts the named export to a JSON
 * Schema document.
 *
 * In a child process, because loading a module runs it and everything it
 * imports: a module that throws on import, opens a listener, or never
 * settles would otherwise take the mock server down with it. The child is a
 * LIFECYCLE boundary, not a sandbox — the code runs with the same
 * permissions laqi has, and nothing here contains it. What bounds the damage
 * is who may ask for a load, which is decided before this is ever called.
 *
 * The conversion happens in the child too, because a runtime object cannot
 * cross a process boundary — and because a vendor converter that hangs is
 * then killed by the same timeout as everything else.
 */
export async function loadModuleSchema(request: ModuleLoadRequest): Promise<ModuleLoadResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', CHILD], {
      env: { ...process.env, LAQI_MODULE_REQUEST: JSON.stringify(request) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    let err = ''
    let settled = false

    const finish = (result: ModuleLoadResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({
        ok: false,
        code: 'timeout',
        error: `loading ${request.exportName} took longer than ${MODULE_LOAD_TIMEOUT_MS / 1000} seconds, so laqi stopped it`,
      })
    }, MODULE_LOAD_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8')
    })

    child.on('error', (cause) => {
      finish({ ok: false, code: 'crashed', error: cause.message })
    })

    child.on('close', (code) => {
      if (settled) return
      const parsed = readResult(out)
      if (parsed !== undefined) {
        finish(parsed.ok ? withDialect(parsed) : parsed)
        return
      }
      // No verdict on stdout: the child died before it could say anything.
      // The user's own stderr is the useful part, not our exit code.
      finish({
        ok: false,
        code: 'crashed',
        error:
          err.trim() ||
          `loading ${request.exportName} ended with exit code ${code ?? 'unknown'} and said nothing`,
      })
    })
  })
}

/**
 * The child's verdict, or undefined when stdout holds no verdict at all.
 *
 * A loaded module may print whatever it likes, so the JSON is looked for at
 * the END of the stream rather than assumed to be all of it. A module that
 * logs on import is ordinary, and having that turn into "the loader broke"
 * would be a bug report about the wrong thing.
 */
function readResult(out: string): ModuleLoadResult | undefined {
  const start = out.lastIndexOf('{"ok":')
  if (start === -1) return undefined
  try {
    return JSON.parse(out.slice(start)) as ModuleLoadResult
  } catch {
    return undefined
  }
}

/**
 * A converted document always declares 2020-12, because that is what was
 * asked for and what laqi stores. A vendor that omits `$schema` is not
 * disagreeing about the dialect, it just did not write it down.
 */
function withDialect(result: { ok: true; document: Record<string, unknown> }): ModuleLoadResult {
  return { ok: true, document: { $schema: DIALECT_2020_12, ...result.document } }
}
