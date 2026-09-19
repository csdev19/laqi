import { describe, expect, it } from 'vitest'
import { undeclaredResponseMessage } from './undeclared-response'

describe('undeclaredResponseMessage', () => {
  it('names the response, the endpoint and what is declared', () => {
    const message = undeclaredResponseMessage({
      name: 'empty',
      id: 'GET /test3',
      declared: ['ok', 'boom'],
    })

    expect(message).toContain('"empty" is not declared on GET /test3')
    expect(message).toContain('Available: ok, boom.')
  })

  it('says how to fix it, not only what is wrong', () => {
    // The list alone reads as a closed set. Without this sentence the reader
    // has no way to know the name is missing because it was never saved.
    const message = undeclaredResponseMessage({
      name: 'empty',
      id: 'GET /test3',
      declared: ['ok'],
    })

    expect(message).toContain('saved to the mock file before it can be served')
    expect(message).toContain('save the endpoint first')
  })

  it('quotes the name so an empty or padded one is still visible', () => {
    const message = undeclaredResponseMessage({ name: ' ok', id: 'GET /a', declared: ['ok'] })
    expect(message).toContain('" ok" is not declared')
  })
})
