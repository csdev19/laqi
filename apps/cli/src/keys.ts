export type KeyBindings = {
  onPanel: () => void
  onShare: () => void
  onClear: () => void
  onQuit: () => void
}

/** Narrowed to what this module touches, so a test can supply a fake. */
export type Stdin = Pick<
  NodeJS.ReadStream,
  'isTTY' | 'setRawMode' | 'on' | 'off' | 'resume' | 'pause'
>

/**
 * In raw mode these arrive as ordinary data: the terminal driver stops
 * translating them into SIGINT and EOF. Exported so the tests name them
 * rather than embedding invisible bytes in a string literal.
 */
export const CTRL_C = '\u0003'
export const CTRL_D = '\u0004'

/**
 * Raw mode, the four bindings, and — the part that matters — a `restore`
 * that always works.
 *
 * Raw mode stops the terminal driver from turning `^C` into SIGINT, so it
 * arrives here as data and this module has to quit on it. Forgetting that
 * is how a tool ends up unkillable from its own terminal.
 *
 * Without a TTY nothing is bound and `active` is false: the caller uses
 * that to decide whether to print the keys line, because advertising a key
 * that is not bound is worse than printing nothing.
 */
export function bindKeys(
  bindings: KeyBindings,
  stdin: Stdin = process.stdin,
): { active: boolean; restore: () => void } {
  if (!stdin.isTTY) return { active: false, restore: () => {} }

  const onData = (chunk: string): void => {
    switch (chunk) {
      case 'o':
      case 'O':
        return bindings.onPanel()
      case 's':
      case 'S':
        return bindings.onShare()
      case 'c':
      case 'C':
        return bindings.onClear()
      case 'q':
      case 'Q':
      case CTRL_C:
      case CTRL_D:
        return bindings.onQuit()
      default:
      // Every other key is ignored rather than guessed at. Arrows and
      // other escape sequences arrive as multi-byte chunks, so they fall
      // here whole and never match a single-letter case.
    }
  }

  try {
    stdin.setRawMode(true)
  } catch {
    // A terminal that reports isTTY but refuses raw mode (some CI shims,
    // some Windows consoles). Serving is unaffected; the keys are not
    // available and the caller must not claim they are.
    return { active: false, restore: () => {} }
  }

  stdin.resume()
  stdin.on('data', onData)

  let restored = false
  const restore = (): void => {
    if (restored) return
    restored = true
    try {
      stdin.setRawMode(false)
    } catch {
      // The terminal is already gone. The listener still has to come off
      // below, or the event loop stays alive and the process never exits.
    }
    stdin.off('data', onData)
    stdin.pause()
  }

  return { active: true, restore }
}
