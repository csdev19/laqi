import { describe, expect, it } from 'vitest'
import { renderInitSummary } from './summary'

const baseInfo = {
  bootMs: 18_000,
  changes: [
    { marker: '+' as const, path: 'laqi/api.json', detail: '4 routes · 11 responses' },
    {
      marker: '+' as const,
      path: 'laqi/scenarios.json',
      detail: 'offline · logged-out · empty-state',
    },
  ],
  next: 'laqi',
  afterCommand: 'point your app at http://127.0.0.1:8000',
}

describe('renderInitSummary', () => {
  it('shows a + line for every created file', () => {
    const out = renderInitSummary(baseInfo, 'none', 80)
    expect(out).toContain('+ laqi/api.json')
    expect(out).toContain('4 routes · 11 responses')
    expect(out).toContain('+ laqi/scenarios.json')
    expect(out).toContain('offline · logged-out · empty-state')
  })

  it('shows a ~ line only when a change carries that marker', () => {
    const withoutScript = renderInitSummary(baseInfo, 'none', 80)
    expect(withoutScript).not.toContain('~')

    const withScript = renderInitSummary(
      {
        ...baseInfo,
        changes: [
          ...baseInfo.changes,
          { marker: '~' as const, path: 'package.json', detail: 'scripts.mock = "laqi"' },
        ],
      },
      'none',
      80,
    )
    expect(withScript).toContain('~ package.json')
    expect(withScript).toContain('scripts.mock = "laqi"')
  })

  it('shows the next and then lines', () => {
    const out = renderInitSummary(baseInfo, 'none', 80)
    expect(out).toContain('next')
    expect(out).toContain('laqi')
    expect(out).toContain('then')
    expect(out).toContain('point your app at http://127.0.0.1:8000')
  })

  it('renders the boot duration in the rule', () => {
    expect(renderInitSummary(baseInfo, 'none', 80)).toContain('18.0s')
  })

  it('aligns every change line on the same column, wide enough for the longest path', () => {
    const out = renderInitSummary(baseInfo, 'none', 80)
    const lines = out.split('\n').filter((line) => line.startsWith('+'))
    const detailStarts = lines.map((line) =>
      line.indexOf('4 routes') !== -1 ? line.indexOf('4 routes') : line.indexOf('offline'),
    )
    expect(new Set(detailStarts).size).toBe(1)
  })

  it('produces no colour codes at level "none"', () => {
    // eslint-disable-next-line no-control-regex
    expect(renderInitSummary(baseInfo, 'none', 80)).not.toMatch(/\x1b\[/)
  })
})
