// apps/cli/src/init/run.ts
//
// The impure half: turns a resolved InitOptions into files on disk and a
// rendered summary. Everything decidable without touching the filesystem
// lives in options.ts and scaffold.ts instead, so those stay unit-testable
// as pure functions.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EndpointSchema,
  ScenariosSchema,
  formatEndpointId,
  parseEndpointKey,
  type EndpointDefinition,
  type HttpMethod,
  type Scenarios,
} from '@laqi/schema'
import { plural, renderFailure, type Failure, type Level } from '@laqi/tui'
import { outputLevel } from '../output'
import { parseInitArgs, type RawInitFlags } from './args'
import { resolveInitOptions, type InitOptions } from './options'
import { openBrowser as defaultOpenBrowser, type OpenResult } from '../open-browser'
import { defaultPromptIO, promptForFlags, type PromptIO } from './prompt'
import { README_CONTENT } from './readme'
import { emptyScaffold, exampleScaffold } from './scaffold'
import { renderInitSummary, type InitChange } from './summary'

/** Unix convention for "interrupted" — there is no shared exit-code table
 *  entry for a cancelled prompt (the table in terminal-output.md covers
 *  failures, and a cancellation is not one: nothing broke). */
const CANCELLED_EXIT_CODE = 130

/** Matches ConfigSchema's own default — not re-imported to keep this module
 *  from depending on the full config surface for one string. */
const HOST = '127.0.0.1'

export const INIT_USAGE = `
laqi init — scaffold ./laqi/ with a mock API and scenarios

  laqi init                 example scaffold, defaults for everything else
  laqi init --yes           identical result, no prompts (also implied by a non-TTY stdout)

Options:
  --dir <path>          mocks folder                          (default laqi)
  --from <kind>          example | empty | openapi              (default example)
  --spec <path>          OpenAPI document — JSON only today      (required with --from openapi)
  --port <number>        port baked into the npm script          (default 8000)
  --script[=name]        add an npm script that runs laqi start  (default off; name defaults to "mock")
  --open                 open the panel in a browser once it is running
  --force                overwrite an existing mocks folder
`.trim()

export type RunInitDeps = {
  openBrowser?: (url: string) => Promise<OpenResult>
  /** Overrides TTY auto-detection. Real invocations always let `runInit`
   *  detect interactivity itself from `process.stdout`/`process.stdin`;
   *  tests use this to drive the prompt path without a real terminal. */
  interactive?: boolean
  /** Where the wizard reads keys from and writes its screen. Defaults to
   *  the real terminal; tests inject scripted streams here. */
  promptIO?: PromptIO
}

export async function runInit(
  argv: string[],
  root: string,
  deps: RunInitDeps = {},
): Promise<number | undefined> {
  const level = outputLevel()
  const startedAt = Date.now()
  const openBrowser = deps.openBrowser ?? defaultOpenBrowser

  const parsedArgs = parseInitArgs(argv)
  if (!parsedArgs.ok) {
    fail(level, {
      headline: 'unrecognised init flag',
      cause: parsedArgs.error,
      remedy: ['laqi init --help'],
      outcome: 'nothing was written · exit 5',
    })
    return 5
  }

  if (parsedArgs.flags.help === true) {
    console.log(INIT_USAGE)
    return undefined
  }

  // Non-interactive is detected, not requested: a non-TTY stdout — CI, a
  // pipe, an agent — behaves as though --yes were passed, with no prompt and
  // nothing blocking. `deps.interactive` exists only so tests can drive the
  // prompt path without a real terminal; a real invocation never sets it.
  const interactive =
    deps.interactive ??
    (parsedArgs.flags.yes !== true && process.stdout.isTTY === true && process.stdin.isTTY === true)

  let flags: RawInitFlags = parsedArgs.flags
  if (interactive) {
    const io = deps.promptIO ?? defaultPromptIO()
    const answered = await promptForFlags(flags, level, io)
    if (answered === null) {
      console.error(
        renderFailure(
          {
            severity: 'notice',
            headline: 'init cancelled',
            cause: 'The prompt was cancelled before every question was answered.',
            outcome: `nothing was written · exit ${CANCELLED_EXIT_CODE}`,
          },
          level,
        ),
      )
      return CANCELLED_EXIT_CODE
    }
    flags = answered
  }

  const resolved = resolveInitOptions(flags)
  if (!resolved.ok) {
    fail(level, {
      headline: 'laqi init could not resolve its options',
      cause: resolved.error,
      remedy: ['laqi init --help'],
      outcome: 'nothing was written · exit 5',
    })
    return 5
  }

  const options = resolved.options
  const targetDir = join(root, options.dir)

  if (existsSync(targetDir)) {
    if (!statSync(targetDir).isDirectory()) {
      fail(level, {
        headline: `${options.dir} already exists and is not a folder`,
        cause: `laqi init writes into ${options.dir}/, but a file already sits at that path.`,
        remedy: [`mv ${options.dir} ${options.dir}.bak`],
        outcome: 'nothing was written · exit 2',
      })
      return 2
    }
    if (!options.force) {
      fail(level, {
        headline: `${options.dir}/ already exists`,
        cause: describeExisting(targetDir),
        remedy: ['laqi init --force'],
        outcome: 'nothing was written · exit 2',
      })
      return 2
    }
  }

  const built = await buildScaffold(options, root, level)
  if (built === null) return 5

  const invalid = validateScaffold(built.api, built.scenarios)
  if (invalid !== null) {
    fail(level, {
      headline: 'the generated scaffold is invalid',
      cause: invalid,
      outcome: 'nothing was written · exit 1',
    })
    return 1
  }

  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, 'api.json'), `${JSON.stringify(built.api, null, 2)}\n`, 'utf8')
  writeFileSync(
    join(targetDir, 'scenarios.json'),
    `${JSON.stringify(built.scenarios, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(join(targetDir, 'README.md'), README_CONTENT, 'utf8')

  const routeCount = Object.keys(built.api).length
  const responseCount = Object.values(built.api).reduce(
    (sum, definition) => sum + Object.keys(definition.responses).length,
    0,
  )
  const scenarioNames = Object.keys(built.scenarios)

  const changes: InitChange[] = [
    {
      marker: '+',
      path: `${options.dir}/api.json`,
      detail: `${plural(routeCount, 'route')} · ${plural(responseCount, 'response')}`,
    },
    {
      marker: '+',
      path: `${options.dir}/scenarios.json`,
      detail: scenarioNames.length > 0 ? scenarioNames.join(' · ') : 'no scenarios yet',
    },
    {
      marker: '+',
      path: `${options.dir}/README.md`,
      detail: 'how to read and edit this folder',
    },
  ]

  const command = serveCommand(options)
  let scriptAdded = false

  if (options.script !== false) {
    const outcome = addNpmScript(root, options.script, command)
    if (outcome.ok) {
      changes.push({
        marker: '~',
        path: 'package.json',
        detail: `scripts.${options.script} = ${JSON.stringify(command)}`,
      })
      scriptAdded = true
    } else {
      console.error(
        renderFailure(
          {
            severity: 'notice',
            headline: '--script had nothing to modify',
            cause: outcome.reason,
            outcome: `${options.dir}/ was still written · run ${JSON.stringify(command)} yourself when ready`,
          },
          level,
        ),
      )
    }
  }

  if (options.open) {
    const panelUrl = `http://${HOST}:${options.port}/__laqi`
    const result = await openBrowser(panelUrl)
    if (!result.opened) {
      console.error(
        renderFailure(
          {
            severity: 'notice',
            headline: 'could not open a browser here',
            cause: result.reason,
            outcome: `open ${panelUrl} yourself once ${command} is running`,
          },
          level,
        ),
      )
    }
  }

  const next = scriptAdded ? `npm run ${options.script}` : command
  const afterCommand = `point your app at http://${HOST}:${options.port}`

  console.log(
    renderInitSummary(
      { bootMs: Date.now() - startedAt, changes, next, afterCommand },
      level,
      process.stdout.columns,
    ),
  )

  if (built.skipped > 0) {
    console.error(
      renderFailure(
        {
          severity: 'notice',
          headline: `${built.skipped} item${built.skipped === 1 ? '' : 's'} skipped from the OpenAPI import`,
          cause: 'Some paths or responses in the spec had no usable shape and were left out.',
          outcome: 'the rest imported fine',
        },
        level,
      ),
    )
  }

  return undefined
}

function describeExisting(targetDir: string): string {
  const entries = readdirSync(targetDir).sort()
  if (entries.length === 0) return 'It already exists.'
  const shown = entries.slice(0, 6)
  const rest = entries.length - shown.length
  const list = rest > 0 ? `${shown.join(', ')}, and ${rest} more` : shown.join(', ')
  return `It already has ${entries.length === 1 ? 'an entry' : `${entries.length} entries`}: ${list}.`
}

async function buildScaffold(
  options: InitOptions,
  root: string,
  level: Level,
): Promise<{
  api: Record<string, EndpointDefinition>
  scenarios: Scenarios
  skipped: number
} | null> {
  if (options.from === 'example') return { ...exampleScaffold(), skipped: 0 }
  if (options.from === 'empty') return { ...emptyScaffold(), skipped: 0 }

  // The resolver guarantees `spec` is set whenever `from === 'openapi'`.
  const specPath = options.spec!
  const absolute = join(root, specPath)

  if (!existsSync(absolute)) {
    fail(level, {
      headline: 'the OpenAPI spec was not found',
      cause: `No file at ${specPath}.`,
      outcome: 'nothing was written · exit 5',
    })
    return null
  }

  if (/\.ya?ml$/i.test(specPath)) {
    fail(level, {
      headline: 'YAML specs are not supported yet',
      cause: 'laqi can only parse JSON OpenAPI documents today — the importer has no YAML parser.',
      remedy: [`laqi init --from openapi --spec ${specPath.replace(/\.ya?ml$/i, '.json')}`],
      outcome: 'nothing was written · exit 5',
    })
    return null
  }

  let document: unknown
  try {
    document = JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    fail(level, {
      headline: `${specPath} is not valid JSON`,
      cause: error instanceof Error ? error.message : String(error),
      outcome: 'nothing was written · exit 5',
    })
    return null
  }

  // Dynamic import: @laqi/mcp's entry chunk statically imports the MCP SDK,
  // which the "lazy loading" guard in package.test.ts forbids in the CLI's
  // own entry chunk. `laqi mcp` already does this for the same reason.
  const { importOpenapi } = await import('@laqi/mcp')
  const imported = importOpenapi(document)

  if (imported.endpoints.length === 0) {
    fail(level, {
      headline: 'nothing importable in that spec',
      cause: imported.skipped[0]?.reason ?? 'No paths with a usable response were found.',
      outcome: 'nothing was written · exit 5',
    })
    return null
  }

  const api: Record<string, EndpointDefinition> = {}
  for (const endpoint of imported.endpoints) {
    api[formatEndpointId(endpoint.method as HttpMethod, endpoint.path)] = endpoint.definition
  }

  return { api, scenarios: {}, skipped: imported.skipped.length }
}

/** Defence against a bug in our own scaffold, or an unexpected OpenAPI
 *  shape `importOpenapi` let through: nothing gets written unless it would
 *  also load, per the spec's own testing rule. */
function validateScaffold(
  api: Record<string, EndpointDefinition>,
  scenarios: Scenarios,
): string | null {
  for (const [key, definition] of Object.entries(api)) {
    const parsedKey = parseEndpointKey(key)
    if (!parsedKey.ok) return `${key}: ${parsedKey.error}`

    const validated = EndpointSchema.safeParse(definition)
    if (!validated.success) {
      return `${key}: ${validated.error.issues.map((issue) => issue.message).join('; ')}`
    }
  }

  const scenariosResult = ScenariosSchema.safeParse(scenarios)
  if (!scenariosResult.success) {
    return scenariosResult.error.issues.map((issue) => issue.message).join('; ')
  }

  return null
}

function serveCommand(options: InitOptions): string {
  const parts = ['laqi', 'start']
  if (options.dir !== 'laqi') parts.push('--dir', options.dir)
  if (options.port !== 8000) parts.push('--port', String(options.port))
  return parts.join(' ')
}

type AddScriptResult = { ok: true } | { ok: false; reason: string }

function addNpmScript(root: string, name: string, command: string): AddScriptResult {
  const path = join(root, 'package.json')
  if (!existsSync(path)) {
    return { ok: false, reason: 'No package.json was found at the project root.' }
  }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch (error) {
    return {
      ok: false,
      reason: `package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    return { ok: false, reason: 'package.json is not a JSON object.' }
  }

  const existingScripts = pkg.scripts
  const scripts: Record<string, unknown> =
    typeof existingScripts === 'object' &&
    existingScripts !== null &&
    !Array.isArray(existingScripts)
      ? { ...existingScripts }
      : {}

  scripts[name] = command
  pkg.scripts = scripts

  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  return { ok: true }
}

function fail(level: Level, failure: Omit<Failure, 'severity'>): void {
  console.error(renderFailure({ severity: 'fatal', ...failure }, level))
}
