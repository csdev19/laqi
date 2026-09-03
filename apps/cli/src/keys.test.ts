import { describe, expect, it, vi } from 'vitest'
import { bindKeys, CTRL_C, CTRL_D } from './keys'

function fakeStdin(isTTY: boolean) {
  const listeners = new Set<(chunk: string) => void>()
  return {
    isTTY,
    raw: false,
    resumed: false,
    paused: false,
    setRawMode(value: boolean) {
      this.raw = value
      return this as never
    },
    on(_event: string, listener: (chunk: string) => void) {
      listeners.add(listener)
      return this as never
    },
    off(_event: string, listener: (chunk: string) => void) {
      listeners.delete(listener)
      return this as never
    },
    resume() {
      this.resumed = true
      return this as never
    },
    pause() {
      this.paused = true
      return this as never
    },
    press(key: string) {
      for (const listener of [...listeners]) listener(key)
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

const bindings = () => ({
  onPanel: vi.fn(),
  onShare: vi.fn(),
  onClear: vi.fn(),
  onQuit: vi.fn(),
})

describe('bindKeys', () => {
  it('binds each of the four keys', () => {
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)

    stdin.press('o')
    stdin.press('s')
    stdin.press('c')
    stdin.press('q')

    expect(handlers.onPanel).toHaveBeenCalledOnce()
    expect(handlers.onShare).toHaveBeenCalledOnce()
    expect(handlers.onClear).toHaveBeenCalledOnce()
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('accepts the uppercase keys too', () => {
    // Caps lock on is not a reason for the tool to stop responding.
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press('Q')
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('quits on ^C, because raw mode stops the driver sending SIGINT', () => {
    // THE critical case. In raw mode byte 0x03 arrives as data and no
    // signal is raised; without this branch, ^C would do nothing at all
    // and the process would be unkillable from its own terminal.
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press(CTRL_C)
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('quits on ^D', () => {
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press(CTRL_D)
    expect(handlers.onQuit).toHaveBeenCalledOnce()
  })

  it('ignores a key nothing is bound to', () => {
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press('x')
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })

  it('ignores an escape sequence rather than guessing at it', () => {
    // An arrow key arrives as three bytes at once. None of them should
    // read as a bound letter.
    const stdin = fakeStdin(true)
    const handlers = bindings()
    bindKeys(handlers, stdin)
    stdin.press('\u001b[A')
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled()
  })

  it('enters raw mode and resumes the stream', () => {
    const stdin = fakeStdin(true)
    bindKeys(bindings(), stdin)
    expect(stdin.raw).toBe(true)
    expect(stdin.resumed).toBe(true)
  })

  it('does nothing at all without a TTY', () => {
    // Piped, under a task runner, in CI, inside an agent harness. Calling
    // setRawMode on a pipe throws, and a keys line here would be a lie.
    const stdin = fakeStdin(false)
    const result = bindKeys(bindings(), stdin)
    expect(result.active).toBe(false)
    expect(stdin.raw).toBe(false)
    expect(stdin.listenerCount).toBe(0)
  })

  it('restores the terminal completely', () => {
    const stdin = fakeStdin(true)
    const { restore } = bindKeys(bindings(), stdin)
    restore()
    expect(stdin.raw).toBe(false)
    expect(stdin.listenerCount).toBe(0)
    expect(stdin.paused).toBe(true)
  })

  it('is safe to restore twice', () => {
    // Both the q handler and the signal handler call it on the way out.
    const stdin = fakeStdin(true)
    const { restore } = bindKeys(bindings(), stdin)
    restore()
    expect(() => restore()).not.toThrow()
  })

  it('restores even when setRawMode throws on the way out', () => {
    // A terminal that has already gone away. The listener still has to
    // come off, or the event loop stays alive and the process never exits.
    const stdin = fakeStdin(true)
    const { restore } = bindKeys(bindings(), stdin)
    stdin.setRawMode = () => {
      throw new Error('ENOTTY')
    }
    expect(() => restore()).not.toThrow()
    expect(stdin.listenerCount).toBe(0)
  })

  it('does not throw when the terminal refuses raw mode', () => {
    const stdin = fakeStdin(true)
    stdin.setRawMode = () => {
      throw new Error('ENOTTY')
    }
    expect(bindKeys(bindings(), stdin).active).toBe(false)
  })

  it('stops acting on keys once restored', () => {
    // A keypress arriving after shutdown started must not re-enter the
    // handlers — `q` twice would run the whole teardown twice.
    const stdin = fakeStdin(true)
    const handlers = bindings()
    const { restore } = bindKeys(handlers, stdin)
    restore()
    stdin.press('q')
    expect(handlers.onQuit).not.toHaveBeenCalled()
  })
})
