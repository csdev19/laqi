// apps/cli/src/init/equivalence.test.ts
//
// The property the spec calls out as the whole reason the prompt path
// exists: "for every question, --flag produces the same files the prompt
// does." Each of the five questions gets one test here that drives the
// prompt path with a scripted answer and the flag path with the equivalent
// flag, then diffs every file either run wrote, byte for byte. A drift
// between the two would fail here even if both paths individually still
// "worked" — which is exactly the silent-rot this test exists to catch.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PromptIO } from './prompt'
import { runInit } from './run'

let roots: string[] = []
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  roots = []
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'laqi-init-equivalence-'))
  roots.push(root)
  return root
}

/** Every relative path under `root`, with its content — a full snapshot of
 *  what a run wrote, deep enough to catch a stray extra file as well as a
 *  content mismatch in one that both runs produced. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files[relative(root, full)] = readFileSync(full, 'utf8')
    }
  }
  walk(root)
  return files
}

/** Drives the prompt path: `input` is fed the scripted keys immediately,
 *  relying on `promptForFlags`'s internal queue (proven in prompt.test.ts)
 *  to hold them regardless of timing, so no delay between writes is
 *  needed. */
function scriptedIO(keys: readonly string[]): PromptIO {
  const input = new PassThrough()
  const output = new PassThrough()
  output.on('data', () => {})
  for (const key of keys) input.write(key)
  return { input, output }
}

const ENTER = '\r'

async function runFlagPath(argv: string[]): Promise<string> {
  const root = makeRoot()
  const exitCode = await runInit(['--yes', ...argv], root)
  expect(exitCode).toBeUndefined()
  return root
}

async function runPromptPath(keys: readonly string[]): Promise<string> {
  const root = makeRoot()
  const exitCode = await runInit([], root, {
    interactive: true,
    promptIO: scriptedIO(keys),
  })
  expect(exitCode).toBeUndefined()
  return root
}

describe('the flag path and the prompt path agree', () => {
  it('question 1 — mocks folder: --dir vs typing a path', async () => {
    const flagRoot = await runFlagPath(['--dir', 'custom-mocks'])
    const promptRoot = await runPromptPath([
      'custom-mocks',
      ENTER, // dir
      ENTER, // from (default)
      ENTER, // port (default)
      ENTER, // script (default: no)
      ENTER, // open (default: no)
    ])

    expect(snapshot(promptRoot)).toEqual(snapshot(flagRoot))
    expect(existsSync(join(flagRoot, 'custom-mocks', 'api.json'))).toBe(true)
  })

  it('question 2 — start from: --from empty vs selecting "empty file"', async () => {
    const flagRoot = await runFlagPath(['--from', 'empty'])
    const promptRoot = await runPromptPath([
      ENTER, // dir (default)
      `${String.fromCharCode(0x1b)}[B`, // from: down-arrow to "empty file"
      ENTER, // confirm selection
      ENTER, // port (default)
      ENTER, // script (default: no)
      ENTER, // open (default: no)
    ])

    expect(snapshot(promptRoot)).toEqual(snapshot(flagRoot))
    const api = JSON.parse(readFileSync(join(flagRoot, 'laqi', 'api.json'), 'utf8')) as object
    expect(Object.keys(api)).toEqual(['GET /example'])
  })

  it('question 3 — port: --port 8010 vs typing 8010', async () => {
    const flagRoot = await runFlagPath(['--port', '8010'])
    const promptRoot = await runPromptPath([
      ENTER, // dir (default)
      ENTER, // from (default)
      '8010',
      ENTER, // port
      ENTER, // script (default: no)
      ENTER, // open (default: no)
    ])

    expect(snapshot(promptRoot)).toEqual(snapshot(flagRoot))
  })

  it('question 4 — add an npm script: --script vs answering "y"', async () => {
    const pkg = JSON.stringify({ name: 'demo-app', version: '1.0.0' }, null, 2)

    const flagRoot = makeRoot()
    writeFileSync(join(flagRoot, 'package.json'), pkg, 'utf8')
    expect(await runInit(['--yes', '--script'], flagRoot)).toBeUndefined()

    const promptRoot = makeRoot()
    writeFileSync(join(promptRoot, 'package.json'), pkg, 'utf8')
    const exitCode = await runInit([], promptRoot, {
      interactive: true,
      promptIO: scriptedIO([
        ENTER, // dir (default)
        ENTER, // from (default)
        ENTER, // port (default)
        'y', // script
        ENTER, // open (default: no)
      ]),
    })
    expect(exitCode).toBeUndefined()

    expect(snapshot(promptRoot)).toEqual(snapshot(flagRoot))
    const written = JSON.parse(readFileSync(join(flagRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(written.scripts).toEqual({ mock: 'laqi' })
  })

  it('question 5 — open the panel: --open vs answering "y", both call the same opener', async () => {
    const flagOpen = vi.fn().mockResolvedValue({ opened: true })
    const flagRoot = makeRoot()
    expect(
      await runInit(['--yes', '--open', '--port', '8020'], flagRoot, { openBrowser: flagOpen }),
    ).toBeUndefined()

    const promptOpen = vi.fn().mockResolvedValue({ opened: true })
    const promptRoot = makeRoot()
    // --port is given as a flag here, so the wizard skips question 3
    // entirely (see the flag-mixing tests in prompt.test.ts) — only dir,
    // from, script and open are actually asked, in that order.
    const exitCode = await runInit(['--port', '8020'], promptRoot, {
      interactive: true,
      openBrowser: promptOpen,
      promptIO: scriptedIO([
        ENTER, // dir (default)
        ENTER, // from (default)
        ENTER, // script (default: no)
        'y', // open
      ]),
    })
    expect(exitCode).toBeUndefined()

    // --open never changes what gets written — only whether a browser opens
    // — so the file trees must match regardless, and both openers must have
    // been asked for the exact same URL.
    expect(snapshot(promptRoot)).toEqual(snapshot(flagRoot))
    expect(flagOpen).toHaveBeenCalledWith('http://127.0.0.1:8020/__laqi')
    expect(promptOpen).toHaveBeenCalledWith('http://127.0.0.1:8020/__laqi')
  })
})
