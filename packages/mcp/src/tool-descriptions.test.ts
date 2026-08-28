import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ConfigSchema } from '@laqi/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMcpServer } from './server'

/**
 * CONTRACT TESTS, NOT AN EVALUATION.
 *
 * An MCP client never sees this repo's source. What it gets, at
 * `tools/list` time, is exactly what these tests read: a name, a prose
 * description, and a JSON Schema. That makes the description part of the
 * interface — but these tests can only check that it is a well-formed
 * interface, the way a linter checks that types line up. They assert that a
 * given concept (the precedence rule, the rejection behaviour, a
 * description at all) is textually present where the agent will read it.
 *
 * None of this proves an agent that reads the text forms the right mental
 * model, picks the right tool, or produces a working mock. That is a
 * comprehension question, and a string match cannot answer it — it needs a
 * real agent, a fixed task, and a rubric on the result. See the "semantic
 * layer" section of testing-mcp.md for that evaluation and why it is a
 * manual check rather than part of this suite. A test in this file that
 * were named as if it proved understanding would be lying about what it
 * does, so keep every assertion here honest: presence of text, not
 * comprehension of it.
 */

// Only tools that mutate resolution state — the layer a response is served
// from — need to teach the precedence rule; a read-only tool like
// list_endpoints has nothing for the rule to go wrong on.
const PRECEDENCE_AWARE_TOOLS = ['set_response', 'set_scenario']

// set_response and set_scenario both take a name that can be wrong (a
// response name, a scenario name). This became a checked-and-listed
// rejection recently (see project.ts's "Available: …" messages) — a
// description that still promised silence on an unknown name would now be
// describing behaviour the tool no longer has.
const NAME_VALIDATING_TOOLS = ['set_response', 'set_scenario']

// A human reads roughly 200-250 words/minute; 500 characters is on the
// order of 80-90 words, a paragraph read in a few seconds — long enough for
// the "when to reach for this, and its one caveat" descriptions already in
// server.ts (the longest today, set_response, is 451), short enough that it
// stays something an agent actually reads before every call rather than
// skims once and ignores.
const MAX_DESCRIPTION_LENGTH = 500

type ToolInfo = {
  name: string
  description?: string
  inputSchema: { properties?: Record<string, { description?: string }> }
}

let client: Client
let tools: ToolInfo[]
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'laqi-tool-desc-'))
  const server = createMcpServer({ root, config: ConfigSchema.parse({}) })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

  const listed = await client.listTools()
  tools = listed.tools as ToolInfo[]
})

afterAll(async () => {
  await client?.close().catch(() => {})
  rmSync(root, { recursive: true, force: true })
})

function toolNamed(name: string): ToolInfo {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} is not registered`)
  return tool
}

describe('MCP tool descriptions (lint, not an evaluation)', () => {
  it('gives every tool a non-empty description', () => {
    for (const tool of tools) {
      expect(tool.description?.trim().length, `${tool.name} has no description`).toBeGreaterThan(0)
    }
  })

  it('keeps every description short enough that an agent actually reads it', () => {
    for (const tool of tools) {
      expect(
        tool.description?.length ?? 0,
        `${tool.name}'s description is ${tool.description?.length} chars, over the ${MAX_DESCRIPTION_LENGTH} cap`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH)
    }
  })

  it.each(PRECEDENCE_AWARE_TOOLS)(
    '%s names the precedence rule, since acting without it surprises the caller',
    (name) => {
      const description = toolNamed(name).description ?? ''
      // The instructions block teaches the rule once; a tool that changes
      // what wins should point back at it rather than assume it was read.
      expect(description).toMatch(/beats the active scenario/i)
    },
  )

  it.each(NAME_VALIDATING_TOOLS)(
    '%s says an invalid name is rejected with the valid options listed',
    (name) => {
      const description = toolNamed(name).description ?? ''
      expect(description).toMatch(/rejected with the (declared|valid) .* listed/i)
    },
  )

  it('gives every parameter in every tool schema its own description', () => {
    const missing: string[] = []
    for (const tool of tools) {
      const properties = tool.inputSchema.properties ?? {}
      for (const [param, schema] of Object.entries(properties)) {
        if (!schema.description || schema.description.trim().length === 0) {
          missing.push(`${tool.name}.${param}`)
        }
      }
    }
    // Every parameter reaches the agent as a bare JSON Schema property; the
    // only place it can say what it is for is its own `description`. A
    // parameter with none teaches the agent nothing about what to pass and
    // makes it guess from the name alone.
    expect(missing, `parameters with no description: ${missing.join(', ')}`).toEqual([])
  })
})
