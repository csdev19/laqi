import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { startScreen } from '@laqi/tui'
import { laqiVersion } from './output'

describe('laqiVersion', () => {
  // Works from source and from the bundle: tsdown replaces the global, and the
  // fallback reads the package.json that sits one level above either location.
  it('reports a semver-shaped version', () => {
    expect(laqiVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('the start screen as the CLI renders it', () => {
  it('names both URLs', () => {
    const out = startScreen(
      {
        version: laqiVersion(),
        servingUrl: 'http://127.0.0.1:8000',
        panelUrl: 'http://127.0.0.1:8000/__laqi',
        watching: './laqi/',
        endpoints: 7,
        responses: 19,
        scenarios: 4,
        bootMs: 84,
      },
      'none',
      72,
    )
    expect(out).toContain('http://127.0.0.1:8000')
    expect(out).toContain('/__laqi')
  })
})

// `readFileSync` from node:fs, not `Bun.file`: vitest runs these under the
// node environment, where the Bun global is not defined. Import it at the
// top of the file.
describe('the MCP protocol channel', () => {
  // stdout carries the MCP protocol. A screen printed there corrupts it, and
  // the failure mode is a client that silently disconnects.
  it('keeps every screen off stdout in mcp mode', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const mcpBlock = source.slice(source.indexOf("positionals[0] === 'mcp'"))
    const untilReturn = mcpBlock.slice(0, mcpBlock.indexOf('return'))
    expect(untilReturn).not.toContain('console.log')
  })
})
