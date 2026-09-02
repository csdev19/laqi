import { EndpointSchema } from '@laqi/schema'
import { describe, expect, it } from 'vitest'
import { README_CONTENT } from './readme'

// This file is scaffolded into the user's repo and read by two audiences
// from the same words: a person who opens laqi/, and a coding agent with no
// MCP tools that reads the folder instead. Both act on what it says, so the
// format it teaches has to be the format the loader accepts, and the
// precedence it teaches has to be the precedence the resolver applies.
// Prose drifts silently; these are the two claims worth pinning.

function fencedJsonBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1] ?? '')
}

describe('the scaffolded README', () => {
  it('teaches at least one worked example', () => {
    expect(fencedJsonBlocks(README_CONTENT).length).toBeGreaterThan(0)
  })

  // If the example stops validating, every reader is being taught a format
  // laqi would reject — including an agent that will write more of it.
  it('only shows endpoints the loader would accept', () => {
    for (const block of fencedJsonBlocks(README_CONTENT)) {
      const parsed = JSON.parse(block) as Record<string, unknown>
      for (const [id, endpoint] of Object.entries(parsed)) {
        const result = EndpointSchema.safeParse(endpoint)
        expect(
          result.success,
          `${id} in the README does not validate: ${result.error?.message}`,
        ).toBe(true)
      }
    }
  })

  // The resolver checks header, then state, then scenario, then default
  // (packages/core/src/resolve.ts). The README lists them lowest-first, so
  // it must read in exactly the reverse order.
  it('teaches the precedence the resolver actually applies', () => {
    const lowestFirst = ['default', 'scenario', 'override', 'X-Laqi-Response']
    // Bold, optionally wrapped in code ticks — the header layer is written
    // as **`X-Laqi-Response` header**.
    const positions = lowestFirst.map((layer) =>
      README_CONTENT.search(new RegExp(`\\*\\*\`?${layer}`)),
    )

    expect(
      positions.every((at) => at !== -1),
      'a layer is missing from the README',
    ).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('warns against the one usage that silently overrides a person', () => {
    expect(README_CONTENT).toMatch(/Don't send \S*X-Laqi-Response/)
  })

  it('points at the panel where the frequent action happens', () => {
    expect(README_CONTENT).toContain('/__laqi')
  })
})
