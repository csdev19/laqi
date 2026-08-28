import { describe, expect, it } from 'vitest'
import { SessionCounters } from './counters'

describe('SessionCounters', () => {
  it('starts at zero', () => {
    expect(new SessionCounters().snapshot()).toEqual({
      requests: 0,
      unmatched: 0,
      flips: 0,
      filesWritten: [],
    })
  })

  it('counts every request, and unmatched ones twice over', () => {
    const c = new SessionCounters()
    c.recordRequest(true)
    c.recordRequest(false)
    c.recordRequest(true)
    expect(c.snapshot()).toMatchObject({ requests: 3, unmatched: 1 })
  })

  it('counts flips', () => {
    const c = new SessionCounters()
    c.recordFlip()
    c.recordFlip()
    expect(c.snapshot().flips).toBe(2)
  })

  // The goodbye line reads "laqi/api.json written 3 times", so the file is
  // named once however often it changed.
  it('counts how many times each file was written', () => {
    const c = new SessionCounters()
    c.recordWrite('laqi/api.json')
    c.recordWrite('laqi/api.json')
    c.recordWrite('laqi/extra.json')
    expect(c.snapshot().filesWritten).toEqual([
      { file: 'laqi/api.json', times: 2 },
      { file: 'laqi/extra.json', times: 1 },
    ])
  })

  it('hands out a copy, so a caller cannot mutate the counters', () => {
    const c = new SessionCounters()
    c.recordWrite('laqi/api.json')
    const snap = c.snapshot()
    snap.filesWritten.push({ file: 'nope', times: 1 })
    expect(c.snapshot().filesWritten).toEqual([{ file: 'laqi/api.json', times: 1 }])
  })
})
