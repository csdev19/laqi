import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
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
 */

const SITE = new URL('../../../apps/site/', import.meta.url)

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
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'laqi-documented-tools-'))
  const server = createMcpServer({ root, config: ConfigSchema.parse({}), version: '0.0.0-test' })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  const listed = await client.listTools()
  registered = listed.tools.map((tool) => tool.name).sort()
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
