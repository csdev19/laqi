import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_ARGS_CONFIG, CLI_COMMANDS, INIT_FLAGS } from '../../apps/cli/src/cli-surface'

// The published docs tell people what to type. Nothing checked that the CLI
// would accept it, and it did not: the installation page shipped
// `laqi --version` — a flag the parser rejects with exit 5 — as the very
// first command a new user runs. Prose is not verifiable, so this reads
// only command positions inside the docs and asserts every one of them
// against the vocabulary index.ts actually parses.

const ROOTS = [
  'apps/site/src/content/docs',
  'apps/site/src/components',
  'apps/site/public/llms.txt',
]

function filesUnder(path: string): string[] {
  if (statSync(path).isFile()) return [path]
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return filesUnder(child)
    return ['.md', '.mdx', '.astro', '.txt'].includes(extname(child)) ? [child] : []
  })
}

const KNOWN_OPTIONS = new Set(Object.keys(CLI_ARGS_CONFIG.options).map((name) => `--${name}`))
const SHORT_OPTIONS = new Set(['-h'])
const KNOWN_COMMANDS = new Set<string>(CLI_COMMANDS)
const KNOWN_INIT_FLAGS = new Set<string>(INIT_FLAGS)

/**
 * `laqi` in a command position only: the start of a line, or after a shell
 * prompt or a runner. Anywhere else it is a path (`laqi/`), a filename
 * (`laqi.json`), a package spec (`laqi@2`) or prose.
 */
const INVOCATION = /(?:^|\$\s+|(?:npx|bunx|npm exec)\s+)laqi(?![\w./@-])(.*)$/gm

const FENCED = /```[^\n]*\n([\s\S]*?)```/g
const BACKTICKED = /`([^`]+)`/g

/**
 * Only code counts. A paragraph opening with "laqi infers a shape…" is
 * prose, and reading it as an invocation would make the suite cry wolf.
 * Fenced blocks cover markdown; the backtick pass then covers inline code
 * and the template literals the Astro components hold their samples in.
 */
function codeRegionsOf(text: string): string {
  const fenced: string[] = []
  const withoutFences = text.replace(FENCED, (_, body: string) => {
    fenced.push(body)
    return '\n'
  })
  const inline = [...withoutFences.matchAll(BACKTICKED)].map((m) => m[1] ?? '')
  return [...fenced, ...inline].join('\n')
}

interface Invocation {
  file: string
  line: string
  args: string[]
}

function invocationsIn(file: string): Invocation[] {
  const text = codeRegionsOf(readFileSync(file, 'utf-8'))
  const found: Invocation[] = []
  for (const match of text.matchAll(INVOCATION)) {
    const rest = (match[1] ?? '').trim()
    if (rest === '') continue
    found.push({ file, line: `laqi ${rest}`, args: rest.split(/\s+/) })
  }
  return found
}

describe('commands documented on the public site', () => {
  const invocations = ROOTS.flatMap(filesUnder).flatMap(invocationsIn)

  it('finds invocations to check (a silent zero would pass vacuously)', () => {
    expect(invocations.length).toBeGreaterThan(3)
  })

  it('only uses flags the CLI parses', () => {
    const unknown: string[] = []
    for (const { file, line, args } of invocations) {
      const isInit = args[0] === 'init'
      for (const arg of args) {
        if (!arg.startsWith('-')) continue
        const flag = arg.split('=')[0]
        const known = isInit
          ? KNOWN_INIT_FLAGS.has(flag) || KNOWN_OPTIONS.has(flag)
          : KNOWN_OPTIONS.has(flag) || SHORT_OPTIONS.has(flag)
        if (!known) unknown.push(`${file}: ${line} → ${flag}`)
      }
    }
    expect(unknown, `documented flags the CLI would reject:\n${unknown.join('\n')}`).toEqual([])
  })

  it('only uses commands the CLI dispatches', () => {
    const unknown: string[] = []
    for (const { file, line, args } of invocations) {
      const first = args[0]
      if (first === undefined || first.startsWith('-')) continue
      if (!KNOWN_COMMANDS.has(first)) unknown.push(`${file}: ${line} → ${first}`)
    }
    expect(unknown, `documented commands the CLI would reject:\n${unknown.join('\n')}`).toEqual([])
  })
})
