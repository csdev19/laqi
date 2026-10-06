import { describe, expect, it } from 'vitest'
import { findLossyNumbers } from './lossy-numbers'

/**
 * JSON numbers have no size limit; JavaScript's have 53 bits of precision.
 * A mock file is the source of truth, so a number laqi cannot carry has to
 * be found in the TEXT, before JSON.parse has already changed it.
 */
describe('findLossyNumbers', () => {
  it('reports an integer beyond 2^53, and what JavaScript reads it as', () => {
    const [found, ...rest] = findLossyNumbers('{"id": 1234567890123456789}')
    expect(rest).toEqual([])
    expect(found).toMatchObject({
      written: '1234567890123456789',
      becomes: '1234567890123456800',
      line: 1,
      col: 8,
    })
  })

  it('reports the first integer past the safe range', () => {
    expect(findLossyNumbers('[9007199254740991, 9007199254740993]').map((f) => f.written)).toEqual([
      '9007199254740993',
    ])
  })

  it('reports a decimal with more digits than a double holds', () => {
    expect(findLossyNumbers('{"x": 0.12345678901234567890}')[0]).toMatchObject({
      written: '0.12345678901234567890',
      becomes: '0.12345678901234568',
    })
  })

  it('reports a number too large for a double, which JSON then serves as null', () => {
    expect(findLossyNumbers('{"x": 1e400}')[0]).toMatchObject({ written: '1e400', becomes: 'null' })
  })

  it('does not report a number whose value survives, however it is spelled', () => {
    const source =
      '[0, -0, 1.0, 1.50, 0.1, 19.99, -42, 1e21, 1E+21, 5e-324, 9007199254740991, -9007199254740991, 0.30000000000000004]'
    expect(findLossyNumbers(source)).toEqual([])
  })

  it('ignores digits inside strings, including after an escaped quote', () => {
    expect(findLossyNumbers('{"a": "9007199254740993", "b": "x\\" 1234567890123456789"}')).toEqual(
      [],
    )
  })

  it('places each number on its own line and column', () => {
    const source = '{\n  "a": 1,\n  "b": {\n    "id": 9007199254740993\n  }\n}'
    expect(findLossyNumbers(source)[0]).toMatchObject({ line: 4, col: 11 })
  })
})
