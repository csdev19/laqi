// apps/cli/src/init/prompt.ts
//
// The interactive half of `laqi init`: five questions, each translating an
// answer into exactly the shape a flag would have produced in `RawInitFlags`
// — so both paths feed the same `resolveInitOptions` and can never drift.
// This module never decides *whether* to prompt (that is `run.ts`'s call,
// driven by TTY detection); it only knows how to ask, once told to.
//
// Built on raw stdin chunks rather than `node:readline`'s keypress decoder:
// that decoder buffers a lone ESC waiting to see whether it starts a longer
// escape sequence, and never resolves it if nothing follows — which makes a
// bare Escape (this module's cancel key) impossible to detect reliably. A
// human keystroke, including the three bytes of an arrow key, arrives as one
// `data` chunk, so matching whole chunks against known sequences is both
// simpler and unambiguous. Confirmed against Node directly before writing
// this: a standalone ESC byte with nothing after it never fires a
// `keypress` event at all through `emitKeypressEvents`.
//
// Control bytes below are built with `String.fromCharCode` rather than
// written as escape literals in this file — the editing tool that wrote this
// module turns a `\u`-style escape into the raw control byte on save, which
// would leave literal ESC/DEL/ETX bytes sitting in the source.
import { paint, type Level } from '@laqi/tui'
import type { RawInitFlags } from './args'
import { DEFAULT_DIR, DEFAULT_PORT } from './options'

const ESC = String.fromCharCode(0x1b)
const CTRL_C = String.fromCharCode(0x03)
const DEL = String.fromCharCode(0x7f)
const BACKSPACE = String.fromCharCode(0x08)
const ARROW_UP = `${ESC}[A`
const ARROW_DOWN = `${ESC}[B`

/** Moves the cursor up `n` lines, then clears everything from there to the
 *  end of the screen — the redraw primitive the select list uses to repaint
 *  itself in place after every arrow keypress. */
function cursorUpAndClear(lines: number): string {
  return `${ESC}[${lines}A${ESC}[0J`
}

/** Carriage return + clear-to-end-of-line, for redrawing a single-line
 *  prompt in place as the user types. */
function clearLine(): string {
  return `\r${ESC}[2K`
}

export type PromptIO = {
  input: NodeJS.ReadableStream & {
    isTTY?: boolean
    setRawMode?: (mode: boolean) => void
    unref?: () => void
  }
  output: NodeJS.WritableStream
}

export function defaultPromptIO(): PromptIO {
  return { input: process.stdin, output: process.stdout }
}

type ParsedKey =
  | { kind: 'cancel' }
  | { kind: 'submit' }
  | { kind: 'backspace' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'text'; text: string }

/**
 * Splits one raw `data` chunk into every key it contains. A single physical
 * keystroke is normally one chunk, but that is not guaranteed: pasted text,
 * or input written faster than the pty forwards it, can land in one chunk
 * that mixes plain characters with a control byte — e.g. typing "9010" and
 * pressing Enter quickly enough that they arrive together as `"9010\r"`.
 * Treating that whole chunk as one opaque key (as an early version of this
 * function did) swallows the Enter into the typed text and the prompt never
 * submits. Tokenizing instead — a run of plain characters becomes one text
 * event, each control byte or arrow sequence its own — handles both the
 * common one-key-per-chunk case and this one identically.
 */
function tokenize(chunk: string): ParsedKey[] {
  const events: ParsedKey[] = []
  let text = ''
  const flushText = (): void => {
    if (text.length > 0) {
      events.push({ kind: 'text', text })
      text = ''
    }
  }

  let i = 0
  while (i < chunk.length) {
    const rest = chunk.slice(i)
    if (rest.startsWith(ARROW_UP)) {
      flushText()
      events.push({ kind: 'up' })
      i += ARROW_UP.length
      continue
    }
    if (rest.startsWith(ARROW_DOWN)) {
      flushText()
      events.push({ kind: 'down' })
      i += ARROW_DOWN.length
      continue
    }

    const ch = chunk[i]!
    if (ch === CTRL_C || ch === ESC) {
      flushText()
      events.push({ kind: 'cancel' })
    } else if (ch === '\r' || ch === '\n') {
      flushText()
      events.push({ kind: 'submit' })
    } else if (ch === DEL || ch === BACKSPACE) {
      flushText()
      events.push({ kind: 'backspace' })
    } else {
      text += ch
    }
    i += 1
  }
  flushText()
  return events
}

class PromptCancelled extends Error {}

type KeyReader = { next: () => Promise<ParsedKey>; dispose: () => void }

/**
 * One raw-mode session for the whole wizard: a single persistent listener
 * queues keys as they arrive. A per-question listener (attach, read one key,
 * detach, repeat) would drop any key that lands in the gap between one
 * question finishing and the next attaching its own listener.
 */
function createKeyReader(io: PromptIO): KeyReader {
  const queue: ParsedKey[] = []
  let waiting: ((key: ParsedKey) => void) | undefined

  const push = (event: ParsedKey): void => {
    if (waiting !== undefined) {
      const resolve = waiting
      waiting = undefined
      resolve(event)
    } else {
      queue.push(event)
    }
  }

  const onData = (data: Buffer | string): void => {
    for (const event of tokenize(data.toString())) push(event)
  }

  io.input.on('data', onData)

  return {
    next(): Promise<ParsedKey> {
      const queued = queue.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      return new Promise((resolve) => {
        waiting = resolve
      })
    },
    dispose(): void {
      io.input.removeListener('data', onData)
    },
  }
}

/** Restores raw mode (and pauses stdin) unconditionally — called from a
 *  `finally`, so a cancelled prompt, a completed one, and a thrown error all
 *  leave the terminal exactly as they found it. */
function enableRawMode(io: PromptIO): () => void {
  const canSetRawMode = typeof io.input.setRawMode === 'function' && io.input.isTTY === true
  if (canSetRawMode) io.input.setRawMode!(true)
  io.input.resume()
  return () => {
    if (canSetRawMode) io.input.setRawMode!(false)
    io.input.pause()
    // Belt and suspenders: `unref()` tells the event loop this handle is not
    // a reason to keep the process alive, in case anything about resuming a
    // raw-mode stdin leaves it referenced past `pause()` alone. Cheap and
    // harmless when it turns out not to be needed.
    if (typeof io.input.unref === 'function') io.input.unref()
  }
}

function write(io: PromptIO, text: string): void {
  io.output.write(text)
}

function progressLabel(step: number, total: number, question: string, level: Level): string {
  return `${paint(`${step}/${total}`, 'dim', level)}  ${paint(question, 'label', level)}`
}

/** A single-line free-text prompt. Backspace edits, Enter submits (the empty
 *  string when `allowEmpty`, otherwise Enter on nothing is ignored and the
 *  prompt keeps reading), Escape/^C cancel the whole wizard. */
async function textPrompt(
  reader: KeyReader,
  io: PromptIO,
  level: Level,
  header: string,
  hint: string,
  allowEmpty: boolean,
): Promise<string> {
  let value = ''
  const render = (): string =>
    `${clearLine()}${header} ${paint(`(${hint})`, 'dim', level)}  ${paint(value, 'value', level)}`
  write(io, render())

  for (;;) {
    const key = await reader.next()
    if (key.kind === 'cancel') throw new PromptCancelled()
    if (key.kind === 'submit') {
      if (value.length === 0 && !allowEmpty) continue
      write(io, '\n')
      return value
    }
    if (key.kind === 'backspace') value = value.slice(0, -1)
    else if (key.kind === 'text') value += key.text
    write(io, render())
  }
}

/** y/n, defaulting on a bare Enter. Any other key is ignored — there is no
 *  partial state to edit, unlike the text prompt. */
async function confirmPrompt(
  reader: KeyReader,
  io: PromptIO,
  level: Level,
  header: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N'
  write(io, `${header} ${paint(`(${hint})`, 'dim', level)}  `)

  for (;;) {
    const key = await reader.next()
    if (key.kind === 'cancel') throw new PromptCancelled()
    if (key.kind === 'submit') {
      write(io, '\n')
      return defaultValue
    }
    if (key.kind === 'text') {
      const answer = key.text.trim().toLowerCase()
      if (answer.startsWith('y')) {
        write(io, '\n')
        return true
      }
      if (answer.startsWith('n')) {
        write(io, '\n')
        return false
      }
    }
  }
}

/** Up/down moves the highlighted marker, Enter confirms it. Redraws the
 *  whole block (header + one line per option) in place on every move — the
 *  `●`/`○` list from the spec's mockup, kept local to `init` rather than
 *  added to `@laqi/tui`, since nothing else in the CLI needs a navigable
 *  list; `paint()` is the only primitive borrowed from there. */
async function selectPrompt<T extends string>(
  reader: KeyReader,
  io: PromptIO,
  level: Level,
  header: string,
  options: readonly { value: T; label: string }[],
  defaultIndex: number,
): Promise<T> {
  let index = defaultIndex
  const blockLines = options.length + 1

  const renderBlock = (): string => {
    const lines = [header]
    for (const [i, option] of options.entries()) {
      const selected = i === index
      const marker = paint(selected ? '●' : '○', selected ? 'accent' : 'dim', level)
      const label = paint(option.label, selected ? 'value' : 'dim', level)
      lines.push(`  ${marker} ${label}`)
    }
    return lines.join('\n')
  }

  write(io, renderBlock())

  for (;;) {
    const key = await reader.next()
    if (key.kind === 'cancel') throw new PromptCancelled()
    if (key.kind === 'submit') {
      write(io, `${cursorUpAndClear(blockLines)}${renderBlock()}\n`)
      return options[index]!.value
    }
    if (key.kind === 'up') index = (index - 1 + options.length) % options.length
    else if (key.kind === 'down') index = (index + 1) % options.length
    else continue
    write(io, `${cursorUpAndClear(blockLines)}${renderBlock()}`)
  }
}

const FROM_OPTIONS: readonly { value: 'example' | 'empty' | 'openapi'; label: string }[] = [
  { value: 'example', label: 'example todo API' },
  { value: 'empty', label: 'empty file' },
  { value: 'openapi', label: 'import OpenAPI' },
]

/**
 * Runs the five-question wizard, skipping any question whose flag is already
 * present in `base` — so `laqi init --port 9000` on a TTY still prompts for
 * everything else but leaves the port alone. Returns the fully-answered
 * flags, or `null` if the user cancelled (Escape or ^C at any point): the
 * caller writes nothing in that case, matching the non-interactive path's
 * "bad input, nothing written" behaviour.
 */
export async function promptForFlags(
  base: RawInitFlags,
  level: Level,
  io: PromptIO = defaultPromptIO(),
): Promise<RawInitFlags | null> {
  const flags: RawInitFlags = { ...base }
  const reader = createKeyReader(io)
  const restore = enableRawMode(io)

  try {
    if (flags.dir === undefined) {
      const answer = await textPrompt(
        reader,
        io,
        level,
        progressLabel(1, 5, 'Mocks folder', level),
        `./${DEFAULT_DIR}/`,
        true,
      )
      if (answer.length > 0) flags.dir = answer
    }

    if (flags.from === undefined) {
      flags.from = await selectPrompt(
        reader,
        io,
        level,
        progressLabel(2, 5, 'Start from', level),
        FROM_OPTIONS,
        0,
      )
    }

    if (flags.from === 'openapi' && flags.spec === undefined) {
      flags.spec = await textPrompt(
        reader,
        io,
        level,
        paint('     OpenAPI spec path', 'label', level),
        '.yaml or .json',
        false,
      )
    }

    if (flags.port === undefined) {
      const answer = await textPrompt(
        reader,
        io,
        level,
        progressLabel(3, 5, 'Port', level),
        String(DEFAULT_PORT),
        true,
      )
      if (answer.length > 0) flags.port = answer
    }

    if (flags.script === undefined) {
      const wantsScript = await confirmPrompt(
        reader,
        io,
        level,
        progressLabel(4, 5, 'Add an npm script', level),
        false,
      )
      if (wantsScript) flags.script = true
    }

    if (flags.open === undefined) {
      const wantsOpen = await confirmPrompt(
        reader,
        io,
        level,
        progressLabel(5, 5, 'Open the panel', level),
        false,
      )
      if (wantsOpen) flags.open = true
    }

    return flags
  } catch (error) {
    if (error instanceof PromptCancelled) return null
    throw error
  } finally {
    reader.dispose()
    restore()
  }
}
