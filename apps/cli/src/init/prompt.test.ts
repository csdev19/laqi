// apps/cli/src/init/prompt.test.ts
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { RawInitFlags } from './args'
import { promptForFlags, type PromptIO } from './prompt'

const ESC = String.fromCharCode(0x1b)
const CTRL_C = String.fromCharCode(0x03)
const DEL = String.fromCharCode(0x7f)
const ARROW_UP = `${ESC}[A`
const ARROW_DOWN = `${ESC}[B`

/** A scripted terminal: `output` is discarded (its bytes are never asserted
 *  on — the wizard's screen is a rendering detail, not a contract), `input`
 *  is fed by the test. Not a real TTY (`isTTY` is left unset), which is
 *  deliberate: it proves the wizard works from any readable stream, not
 *  only from `process.stdin`. */
function fakeIO(): { io: PromptIO; input: PassThrough } {
  const input = new PassThrough()
  const output = new PassThrough()
  output.on('data', () => {})
  return { io: { input, output }, input }
}

async function run(
  input: PassThrough,
  io: PromptIO,
  base: RawInitFlags,
  keys: string[],
): Promise<RawInitFlags | null> {
  const promise = promptForFlags(base, 'none', io)
  for (const key of keys) input.write(key)
  return promise
}

describe('promptForFlags — enter takes every default', () => {
  it('produces the same flags a bare "laqi init --yes" would resolve from', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '\r', '\r', '\r'])
    // `from` always carries a value — the select prompt has no "unanswered"
    // state, unlike the text and confirm prompts, which can leave a flag
    // unset entirely. Enter on the first (default) option still returns it.
    expect(result).toEqual({ from: 'example' })
  })
})

describe('promptForFlags — mocks folder (question 1)', () => {
  it('typing a path sets --dir, matching what the flag would carry', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['mocks', '\r', '\r', '\r', '\r', '\r'])
    expect(result?.dir).toBe('mocks')
  })

  it('backspace edits the typed value before submit', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['mocksx', DEL, '\r', '\r', '\r', '\r', '\r'])
    expect(result?.dir).toBe('mocks')
  })

  it('is skipped entirely when --dir was already given', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, { dir: 'preset' }, ['\r', '\r', '\r', '\r'])
    expect(result?.dir).toBe('preset')
  })
})

describe('promptForFlags — start from (question 2)', () => {
  it('defaults to example on a bare enter', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '\r', '\r', '\r'])
    expect(result?.from).toBe('example')
  })

  it('one down-arrow selects empty', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', ARROW_DOWN, '\r', '\r', '\r', '\r'])
    expect(result?.from).toBe('empty')
  })

  it('two down-arrows select openapi, then asks for the spec path', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, [
      '\r',
      ARROW_DOWN,
      ARROW_DOWN,
      '\r',
      'spec.json',
      '\r',
      '\r',
      '\r',
      '\r',
    ])
    expect(result?.from).toBe('openapi')
    expect(result?.spec).toBe('spec.json')
  })

  it('wraps from the first option back to the last on up-arrow', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, [
      '\r',
      ARROW_UP,
      '\r',
      'spec.yaml',
      '\r',
      '\r',
      '\r',
      '\r',
    ])
    expect(result?.from).toBe('openapi')
  })

  it('is skipped entirely when --from was already given', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, { from: 'empty' }, ['\r', '\r', '\r', '\r'])
    expect(result?.from).toBe('empty')
  })

  it('still asks for the spec path when --from openapi was given without --spec', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, { from: 'openapi' }, [
      '\r', // dir
      'from-flag-spec.json',
      '\r', // spec submit
      '\r', // port
      '\r', // script
      '\r', // open
    ])
    expect(result?.spec).toBe('from-flag-spec.json')
  })

  it('does not ask for the spec path again when --spec was also given', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, { from: 'openapi', spec: 'preset.json' }, [
      '\r', // dir
      '\r', // port
      '\r', // script
      '\r', // open
    ])
    expect(result?.spec).toBe('preset.json')
  })
})

describe('promptForFlags — port (question 3)', () => {
  it('typing digits sets --port', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '8010', '\r', '\r', '\r'])
    expect(result?.port).toBe('8010')
  })

  it('is skipped entirely when --port was already given', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, { port: '9999' }, ['\r', '\r', '\r', '\r'])
    expect(result?.port).toBe('9999')
  })

  it('digits and Enter arriving in one burst still submit — not left dangling as typed text', async () => {
    // A real pty can deliver a fast typist's digits and their Enter as one
    // `data` chunk rather than one event each — this reproduces that against
    // a scripted stream rather than requiring a real terminal. Caught via a
    // pty-based manual run before this test existed: the port question hung
    // forever because the embedded \r was appended to the typed text instead
    // of being read as a separate submit.
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '8010\r', '\r', '\r'])
    expect(result?.port).toBe('8010')
  })
})

describe('promptForFlags — add an npm script (question 4)', () => {
  it('"y" sets a bare --script', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '\r', 'y', '\r'])
    expect(result?.script).toBe(true)
  })

  it('"n" leaves --script unset', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '\r', 'n', '\r'])
    expect(result?.script).toBeUndefined()
  })

  it('enter takes the default (no script)', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '\r', '\r', '\r'])
    expect(result?.script).toBeUndefined()
  })

  it('is skipped entirely when --script was already given', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, { script: 'mock:api' }, ['\r', '\r', '\r', '\r'])
    expect(result?.script).toBe('mock:api')
  })
})

describe('promptForFlags — open the panel (question 5)', () => {
  it('"y" sets --open', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '\r', '\r', 'y'])
    expect(result?.open).toBe(true)
  })

  it('enter takes the default (do not open)', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', '\r', '\r', '\r', '\r'])
    expect(result?.open).toBeUndefined()
  })

  it('is skipped entirely when --open was already given', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, { open: true }, ['\r', '\r', '\r', '\r'])
    expect(result?.open).toBe(true)
  })
})

describe('promptForFlags — cancellation', () => {
  it('Escape at the first question returns null, mid-wizard', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, [ESC])
    expect(result).toBeNull()
  })

  it('^C partway through the wizard returns null', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['\r', ARROW_DOWN, CTRL_C])
    expect(result).toBeNull()
  })

  it('Escape while typing text cancels rather than being treated as input', async () => {
    const { io, input } = fakeIO()
    const result = await run(input, io, {}, ['partial-dir', ESC])
    expect(result).toBeNull()
  })
})

describe('promptForFlags — terminal restore', () => {
  it('enables raw mode for the session and disables it again once done', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY?: boolean
      setRawMode?: (mode: boolean) => void
    }
    input.isTTY = true
    const setRawMode = vi.fn()
    input.setRawMode = setRawMode
    const output = new PassThrough()
    output.on('data', () => {})

    const promise = promptForFlags({}, 'none', { input, output })
    input.write('\r')
    input.write('\r')
    input.write('\r')
    input.write('\r')
    input.write('\r')
    await promise

    expect(setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(setRawMode).toHaveBeenNthCalledWith(2, false)
  })

  it('disables raw mode again even when the wizard is cancelled', async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY?: boolean
      setRawMode?: (mode: boolean) => void
    }
    input.isTTY = true
    const setRawMode = vi.fn()
    input.setRawMode = setRawMode
    const output = new PassThrough()
    output.on('data', () => {})

    const promise = promptForFlags({}, 'none', { input, output })
    input.write(ESC)
    const result = await promise

    expect(result).toBeNull()
    expect(setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(setRawMode).toHaveBeenNthCalledWith(2, false)
  })
})
