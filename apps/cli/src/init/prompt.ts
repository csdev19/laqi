// apps/cli/src/init/prompt.ts
//
// The interactive half of `laqi init`: five questions, each translating an
// answer into exactly the shape a flag would have produced in `RawInitFlags`
// — so both paths feed the same `resolveInitOptions` and can never drift.
// This module never decides *whether* to prompt (that is `run.ts`'s call,
// driven by TTY detection); it only knows how to ask, once told to.
//
// Built on `@clack/core`'s prompt engine rather than hand-rolled cursor
// arithmetic. An earlier version of this file moved the cursor and cleared
// the screen itself, and got both wrong: it repainted over the shell's own
// prompt line, and it never collapsed an answered question, so the screen
// accumulated every previous question's option list. `@clack/core` (the
// engine `@clack/prompts` itself is built on, and what `create astro` uses)
// owns that arithmetic instead — it diffs each frame against the last one it
// drew and only rewrites what changed, it survives a terminal resize
// mid-prompt, and it already solved the standalone-Escape problem this
// module used to work around by reading raw stdin chunks: it opens its own
// `readline` interface with `escapeCodeTimeout: 50`, short enough that a
// lone Escape (this wizard's cancel key) resolves quickly instead of
// waiting to see whether more bytes follow. `@clack/prompts`' own `text`,
// `select` and `confirm` helpers don't expose their `render()` — it's fixed
// to their own look — so this module builds directly on `@clack/core`'s
// `TextPrompt` / `SelectPrompt` / `ConfirmPrompt` classes with a `render()`
// that draws the shape the product owner asked for: a one-line description,
// the default visible, and an "enter to accept" hint with the step counter.
import type { Readable, Writable } from 'node:stream'
import { ConfirmPrompt, isCancel, SelectPrompt, TextPrompt, type State } from '@clack/core'
import { paint, type Level } from '@laqi/tui'
import type { RawInitFlags } from './args'
import type { InitFrom } from './options'
import { DEFAULT_DIR, DEFAULT_PORT } from './options'

export type PromptIO = {
  input: Readable & {
    isTTY?: boolean
    setRawMode?: (mode: boolean) => void
  }
  output: Writable
}

export function defaultPromptIO(): PromptIO {
  return { input: process.stdin, output: process.stdout }
}

class PromptCancelled extends Error {}

const TOTAL_STEPS = 5

const SYMBOL_ACTIVE = '◆'
const SYMBOL_SUBMIT = '◇'
const SYMBOL_ERROR = '▲'
const SYMBOL_CANCEL = '■'
const BAR = '│'
const CORNER = '└'
const RADIO_ON = '●'
const RADIO_OFF = '○'

/**
 * Draws one question's block: a title line, one prefixed body line per
 * entry in `body`, and a footer hint — or, once the question is answered
 * (`submit`/`cancel`), collapses to just the title and the last body line,
 * so an answered question never leaves its option list on screen for the
 * next question to scroll past.
 */
function frame(
  level: Level,
  state: State,
  title: string,
  body: readonly string[],
  footer: string,
): string {
  const bar = paint(BAR, 'dim', level)
  if (state === 'submit' || state === 'cancel') {
    const symbol = paint(
      state === 'cancel' ? SYMBOL_CANCEL : SYMBOL_SUBMIT,
      state === 'cancel' ? 'fatal' : 'accent',
      level,
    )
    const summary = body.at(-1) ?? ''
    return `${symbol}  ${paint(title, 'label', level)}\n${bar}  ${summary}`
  }
  const symbol = paint(
    state === 'error' ? SYMBOL_ERROR : SYMBOL_ACTIVE,
    state === 'error' ? 'degraded' : 'accent',
    level,
  )
  const corner = paint(CORNER, 'dim', level)
  const lines = [
    `${symbol}  ${paint(title, 'label', level)}`,
    ...body.map((line) => `${bar}  ${line}`),
  ]
  lines.push(`${corner}  ${footer}`)
  return lines.join('\n')
}

function hint(step: number, prefix?: string): string {
  const accept = `enter to accept · ${step}/${TOTAL_STEPS}`
  return prefix === undefined ? accept : `${prefix} · ${accept}`
}

/** `.prompt()` resolves to a cancellation symbol rather than throwing —
 *  this turns that into the same short-circuit the rest of this module (and
 *  the old hand-rolled version) already uses. `@clack/core`'s own typing
 *  always includes `undefined` in the resolved union (some of its prompts,
 *  like a multiselect with nothing picked, can genuinely produce it); none
 *  of the three kinds this module drives ever do — a text prompt without a
 *  `defaultValue` falls back to `''`, not `undefined`, and select/confirm
 *  always resolve to one of their options. */
async function runOrCancel<T>(prompt: { prompt(): Promise<symbol | T | undefined> }): Promise<T> {
  const result = await prompt.prompt()
  if (isCancel(result)) throw new PromptCancelled()
  return result as T
}

async function askDir(io: PromptIO, level: Level): Promise<string> {
  const description = 'Where laqi looks for your JSON files.'
  const placeholder = `./${DEFAULT_DIR}/`
  const title = 'Mocks folder'

  const prompt = new TextPrompt({
    input: io.input,
    output: io.output,
    render() {
      const typed = this.userInput
      const shown = typed.length > 0 ? typed : placeholder
      const styled = paint(
        shown,
        typed.length > 0 || this.state === 'submit' ? 'value' : 'dim',
        level,
      )
      return frame(level, this.state, title, [description, styled], hint(1))
    },
  })

  return runOrCancel(prompt)
}

const FROM_OPTIONS: { value: InitFrom; label: string }[] = [
  { value: 'example', label: 'example todo API' },
  { value: 'empty', label: 'empty file' },
  { value: 'openapi', label: 'import OpenAPI' },
]

async function askFrom(io: PromptIO, level: Level): Promise<InitFrom> {
  const description = 'What laqi scaffolds before you make it your own.'
  const title = 'Start from'

  const prompt = new SelectPrompt({
    input: io.input,
    output: io.output,
    options: FROM_OPTIONS,
    initialValue: FROM_OPTIONS[0]!.value,
    render() {
      const selected = FROM_OPTIONS.find((option) => option.value === this.value)
      if (this.state === 'submit' || this.state === 'cancel') {
        return frame(
          level,
          this.state,
          title,
          [description, paint(selected?.label ?? '', 'value', level)],
          '',
        )
      }
      const optionLines = this.options.map((option, index) => {
        const active = index === this.cursor
        const marker = paint(active ? RADIO_ON : RADIO_OFF, active ? 'accent' : 'dim', level)
        return `${marker} ${paint(option.label, active ? 'value' : 'dim', level)}`
      })
      return frame(
        level,
        this.state,
        title,
        [description, ...optionLines],
        hint(2, '↑/↓ to choose'),
      )
    },
  })

  return runOrCancel(prompt)
}

async function askSpec(io: PromptIO, level: Level): Promise<string> {
  const description = 'A JSON OpenAPI document to import routes from.'
  const placeholder = '.yaml or .json'
  const title = 'OpenAPI spec path'

  const prompt = new TextPrompt({
    input: io.input,
    output: io.output,
    validate: (value) =>
      value === undefined || value.trim().length === 0
        ? 'laqi needs a path to import from.'
        : undefined,
    render() {
      const typed = this.userInput
      const styled = paint(
        typed.length > 0 ? typed : placeholder,
        typed.length > 0 ? 'value' : 'dim',
        level,
      )
      const body = [description, styled]
      if (this.state === 'error') body.push(paint(this.error, 'degraded', level))
      return frame(level, this.state, title, body, 'type a path · enter to accept')
    },
  })

  return runOrCancel(prompt)
}

async function askPort(io: PromptIO, level: Level): Promise<string> {
  const description = 'The port laqi start listens on.'
  const placeholder = String(DEFAULT_PORT)
  const title = 'Port'

  const prompt = new TextPrompt({
    input: io.input,
    output: io.output,
    render() {
      const typed = this.userInput
      const shown = typed.length > 0 ? typed : placeholder
      const styled = paint(
        shown,
        typed.length > 0 || this.state === 'submit' ? 'value' : 'dim',
        level,
      )
      return frame(level, this.state, title, [description, styled], hint(3))
    },
  })

  return runOrCancel(prompt)
}

async function askScript(io: PromptIO, level: Level): Promise<boolean> {
  const description = 'Adds an npm script that runs `laqi start`.'
  const title = 'Add an npm script'

  const prompt = new ConfirmPrompt({
    input: io.input,
    output: io.output,
    active: 'Yes',
    inactive: 'No',
    initialValue: false,
    render() {
      const shown = paint(this.value ? 'Yes' : 'No', 'value', level)
      if (this.state === 'submit' || this.state === 'cancel') {
        return frame(level, this.state, title, [description, shown], '')
      }
      return frame(
        level,
        this.state,
        title,
        [description, shown],
        hint(4, this.value ? 'Y/n' : 'y/N'),
      )
    },
  })

  return runOrCancel(prompt)
}

async function askOpen(io: PromptIO, level: Level): Promise<boolean> {
  const description = "Opens the mock server's control panel once it's running."
  const title = 'Open the panel'

  const prompt = new ConfirmPrompt({
    input: io.input,
    output: io.output,
    active: 'Yes',
    inactive: 'No',
    initialValue: false,
    render() {
      const shown = paint(this.value ? 'Yes' : 'No', 'value', level)
      if (this.state === 'submit' || this.state === 'cancel') {
        return frame(level, this.state, title, [description, shown], '')
      }
      return frame(
        level,
        this.state,
        title,
        [description, shown],
        hint(5, this.value ? 'Y/n' : 'y/N'),
      )
    },
  })

  return runOrCancel(prompt)
}

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

  try {
    if (flags.dir === undefined) {
      const answer = await askDir(io, level)
      if (answer.length > 0) flags.dir = answer
    }

    if (flags.from === undefined) {
      flags.from = await askFrom(io, level)
    }

    if (flags.from === 'openapi' && flags.spec === undefined) {
      flags.spec = await askSpec(io, level)
    }

    if (flags.port === undefined) {
      const answer = await askPort(io, level)
      if (answer.length > 0) flags.port = answer
    }

    if (flags.script === undefined) {
      const wantsScript = await askScript(io, level)
      if (wantsScript) flags.script = true
    }

    if (flags.open === undefined) {
      const wantsOpen = await askOpen(io, level)
      if (wantsOpen) flags.open = true
    }

    return flags
  } catch (error) {
    if (error instanceof PromptCancelled) return null
    throw error
  }
}
