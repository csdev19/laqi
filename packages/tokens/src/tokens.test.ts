import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf-8')

// Every consumer (the CLI's control panel, the public site) trusts these
// exact values. A change here is a design decision, never a typo — this
// test exists so one never slips in by accident.
describe('design tokens', () => {
  const colors: Array<[string, string]> = [
    ['--bg', '#0b0a0f'],
    ['--panel', '#121019'],
    ['--panel2', '#171522'],
    ['--line', '#241f35'],
    ['--line2', '#332a4a'],
    ['--fg', '#eae7f2'],
    ['--dim', '#8e88a8'],
    ['--dim2', '#5c5678'],
    ['--vio', '#7a00ff'],
    ['--viol', '#a366ff'],
    ['--mag', '#ff00a0'],
    ['--magl', '#ff7ac8'],
    ['--mint', '#00ffc2'],
    ['--red', '#ff0058'],
    ['--warn', '#ffb020'],
    ['--palev', '#c9a6ff'],
    ['--palem', '#7fefd8'],
  ]

  it.each(colors)('%s is %s', (name, value) => {
    const re = new RegExp(`${name}:\\s*${value};`)
    expect(css).toMatch(re)
  })

  it('declares the serif display font with Source Serif 4 first', () => {
    expect(css).toContain("--serif: 'Source Serif 4', 'Source Serif Pro', Georgia")
  })

  it('declares the mono font with JetBrains Mono first', () => {
    expect(css).toContain("--mono: 'JetBrains Mono', ui-monospace")
  })
})
