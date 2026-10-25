import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { supportedLanguages } from '@laqi/generate'
import { ConfigSchema } from '@laqi/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMcpServer } from './server'

/**
 * THE PUBLIC SURFACES THAT LIST THE MCP TOOLS MUST MATCH THIS SERVER.
 *
 * Three public surfaces transcribe the tool list by hand, and all three had
 * drifted: two claimed eleven tools, one claimed twelve, and the server
 * registered fifteen. `ai-agents.md` additionally promised the list was kept
 * in sync with the implementation. An agent verifies that claim in one
 * `tools/list` call, which makes it the worst place in the product to be
 * wrong.
 *
 * The stronger fix would be to generate the list at build time, and that is
 * not what this does. It was not taken because the prose beside each name on
 * `ai-agents.md` is written for a person and is deliberately shorter and
 * plainer than the agent-facing description in `server.ts` — generating it
 * would mean either shipping the agent's wording to a human reader or
 * maintaining a second description table, which is the problem again. So the
 * names and the counts are checked here instead, and the prose stays
 * hand-written.
 *
 * What this guarantees: registering or removing a tool in `server.ts` fails
 * CI until every surface below is updated. What it does not: that the prose
 * describes the tool correctly. Nothing automatic can check that.
 *
 * The same reasoning covers two more things the docs transcribe by hand and
 * that drifted the same way: the root README's list of control plane routes
 * (it listed nine; `control-plane-app.ts` mounts twenty-two) and the number
 * of languages the type generator targets (the site said twenty-five, the
 * generator reports twenty-seven). They live in this file because it is
 * already the one place that compares the docs with the code.
 */

const REPO = new URL('../../../', import.meta.url)
const SITE = new URL('../../../apps/site/', import.meta.url)

const README = 'README.md'
const CONTROL_PLANE_SOURCE = 'packages/server/src/control-plane-app.ts'
const DATA_GENERATORS_PAGE = 'apps/site/src/content/docs/docs/data-generators.md'
const PANEL_PAGE = 'apps/site/src/content/docs/docs/panel.md'

const AI_AGENTS_PAGE = 'apps/site/src/content/docs/docs/ai-agents.md'
const DOCS_INDEX = 'apps/site/src/content/docs/docs/index.md'
const LLMS_TXT = 'apps/site/public/llms.txt'

// Each surface spells the count as an English word. Covering well past the
// current fifteen means adding a tool fails on the assertion that names the
// stale surface, not on a lookup miss here.
const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'twenty-one',
  'twenty-two',
  'twenty-three',
  'twenty-four',
  'twenty-five',
  'twenty-six',
  'twenty-seven',
  'twenty-eight',
  'twenty-nine',
  'thirty',
]

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative.replace('apps/site/', ''), SITE)), 'utf8')
}

function readRepo(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, REPO)), 'utf8')
}

/** The body of one `## ` section of a Markdown file, up to the next one. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`)
  if (start === -1) throw new Error(`no "## ${heading}" section`)
  const body = markdown.slice(start + 1)
  const next = body.indexOf('\n## ', 1)
  return next === -1 ? body : body.slice(0, next)
}

/** Spells a count the way the prose does: "seven", "twenty-seven". */
function numberWord(count: number): string {
  const word = NUMBER_WORDS[count]
  if (!word) throw new Error(`no English word for ${count}; extend NUMBER_WORDS`)
  return word
}

/** The first cell of every table row that opens with a backticked identifier. */
function toolNamesInTable(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => /^\|\s*`([a-z_]+)`\s*\|/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name))
}

/** Every backticked identifier inside one region of prose. */
function backtickedNames(text: string): string[] {
  return [...text.matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
}

let client: Client
let registered: string[]
let languageCount: number
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'laqi-documented-tools-'))
  const server = createMcpServer({ root, config: ConfigSchema.parse({}) })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  const listed = await client.listTools()
  registered = listed.tools.map((tool) => tool.name).sort()

  languageCount = (await supportedLanguages()).length
})

afterAll(async () => {
  await client?.close().catch(() => {})
  rmSync(root, { recursive: true, force: true })
})

describe('the documented MCP tool list matches the registered one', () => {
  it(`${AI_AGENTS_PAGE} tabulates exactly the registered tools`, () => {
    const documented = toolNamesInTable(read(AI_AGENTS_PAGE)).sort()
    expect(documented).toEqual(registered)
  })

  it(`${AI_AGENTS_PAGE} states the right count in its heading and its description`, () => {
    const page = read(AI_AGENTS_PAGE)
    const word = numberWord(registered.length)
    expect(page).toContain(`## The ${word} tools`)
    expect(page).toContain(`an MCP server with ${word} tools`)
  })

  it(`${DOCS_INDEX} states the right count`, () => {
    expect(read(DOCS_INDEX)).toContain(`its ${numberWord(registered.length)} tools`)
  })

  it(`${LLMS_TXT} states the right count and lists exactly the registered tools`, () => {
    const llms = read(LLMS_TXT)
    const word = numberWord(registered.length)
    expect(llms).toContain(`with ${word} typed`)

    // The names sit between the count and the sentence that closes the
    // bullet; taking the whole file would also match tool names used in
    // prose elsewhere in it.
    const start = llms.indexOf(`with ${word} typed`)
    const end = llms.indexOf('Prefer a tool call', start)
    expect(end, 'the AI-agents bullet in llms.txt no longer ends as expected').toBeGreaterThan(
      start,
    )

    expect(backtickedNames(llms.slice(start, end)).sort()).toEqual(registered)
  })
})

describe('the README lists the MCP tools the server registers', () => {
  it(`${README} names exactly the registered tools`, () => {
    const paragraph = /\nTools: ([^]*?)\n\n/.exec(
      section(readRepo(README), 'Using it from a coding agent (MCP)'),
    )
    expect(paragraph, 'the README no longer has a "Tools:" paragraph').not.toBeNull()
    expect(backtickedNames(paragraph?.[1] ?? '').sort()).toEqual(registered)
  })
})

describe('the README lists the control plane routes the server mounts', () => {
  /** `GET /__laqi/api/state` for every `app.get('/api/state', …)` in the source. */
  function mountedRoutes(): string[] {
    const source = readRepo(CONTROL_PLANE_SOURCE)
    return [...source.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)]
      .map((match) => `${(match[1] ?? '').toUpperCase()} /__laqi${match[2]}`)
      .sort()
  }

  /** Every `METHOD /__laqi/…` line of the README's "Control plane API" block. */
  function documentedRoutes(): string[] {
    return section(readRepo(README), 'Control plane API')
      .split('\n')
      .map((line) => /^(GET|POST|PUT|PATCH|DELETE)\s+(\/__laqi\/\S+)/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => `${match[1]} ${match[2]}`)
      .sort()
  }

  it(`${README} lists exactly the routes ${CONTROL_PLANE_SOURCE} mounts`, () => {
    // Guards the extraction itself: a refactor that mounts routes some other
    // way would otherwise turn this into two empty lists comparing equal.
    expect(mountedRoutes().length).toBeGreaterThan(0)
    expect(documentedRoutes()).toEqual(mountedRoutes())
  })
})

describe('the documented language count matches the type generator', () => {
  it(`${DATA_GENERATORS_PAGE} states the count and lists that many languages`, () => {
    const page = readRepo(DATA_GENERATORS_PAGE)
    expect(page).toContain(`covers ${languageCount} languages:`)

    const list = /covers \d+ languages:\n\n([^]*?)\n\n/.exec(page)?.[1] ?? ''
    expect(list.replace(/\s+/g, ' ').split(', ')).toHaveLength(languageCount)
  })

  it.each([PANEL_PAGE, DOCS_INDEX, LLMS_TXT])('%s spells the count in words', (surface) => {
    const text = readRepo(surface).replace(/\s+/g, ' ')
    expect(text).toContain(`in ${numberWord(languageCount)} languages`)
  })

  it(`${README} counts the languages it does not name`, () => {
    // "TypeScript, Zod, Swift, Kotlin, Dart, Python, Go and twenty more":
    // seven named plus the spelled-out remainder must add up to the total.
    const text = readRepo(README).replace(/\s+/g, ' ')
    const match = /language dropdown — (.+?) and (\S+) more/.exec(text)
    expect(match, 'the README no longer says "<names> and N more"').not.toBeNull()
    const named = (match?.[1] ?? '').split(', ').length
    expect(match?.[2]).toBe(numberWord(languageCount - named))
  })
})
