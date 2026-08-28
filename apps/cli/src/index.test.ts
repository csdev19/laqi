// apps/cli/src/index.test.ts — exercises `main()` the only way it can be
// exercised: as a real process. `main()` runs unconditionally at import
// time (it reads the real `process.argv`), so every other module in this
// package tests its pieces (startServer, runInit, ...) directly instead —
// this file is the one place that has to go through the CLI entry point
// itself, to prove `laqi start` and bare `laqi` really do dispatch the same
// way an invoker on the command line would see.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const CLI_ENTRY = join(import.meta.dirname, 'index.ts')

let root: string
let child: ChildProcessWithoutNullStreams | undefined

afterEach(async () => {
  if (child !== undefined && child.exitCode === null && !child.killed) {
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => child?.once('exit', () => resolve()))
  }
  child = undefined
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
})

function makeMockRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'laqi-cli-'))
  writeFileSync(
    join(dir, 'laqi.json'),
    JSON.stringify({
      'GET /ping': {
        description: 'ping',
        default: 'ok',
        responses: { ok: { status: 200, body: { pong: true } } },
      },
    }),
    'utf8',
  )
  return dir
}

/** Grabs a free TCP port from the OS and releases it immediately — good
 *  enough to hand to `--port` without colliding with another test's server,
 *  which a hardcoded port would risk under parallel test files. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : undefined
      probe.close(() => (port === undefined ? reject(new Error('no port')) : resolve(port)))
    })
  })
}

/** Runs the CLI and resolves once its stdout contains `waitFor` — the
 *  banner's `serving` row for the happy paths below — without waiting for
 *  the process to exit, since a serving laqi never exits on its own. */
function runUntil(
  args: string[],
  cwd: string,
  waitFor: string,
): Promise<{ stdout: string; child: ChildProcessWithoutNullStreams }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', [CLI_ENTRY, ...args], { cwd })
    let stdout = ''
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`timed out waiting for ${JSON.stringify(waitFor)} in: ${stdout}`))
    }, 15_000)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.includes(waitFor)) {
        clearTimeout(timeout)
        resolve({ stdout, child: proc })
      }
    })
    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    proc.on('exit', (code) => {
      if (!stdout.includes(waitFor)) {
        clearTimeout(timeout)
        reject(
          new Error(
            `process exited (code ${code}) before printing ${JSON.stringify(waitFor)}: ${stdout}`,
          ),
        )
      }
    })
  })
}

/** Runs the CLI to completion — for the failure paths below, which exit on
 *  their own rather than serving forever. */
function runToExit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', [CLI_ENTRY, ...args], { cwd })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`timed out waiting for exit: ${stdout}${stderr}`))
    }, 15_000)

    proc.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    proc.on('exit', (exitCode) => {
      clearTimeout(timeout)
      resolve({ stdout, stderr, exitCode })
    })
  })
}

describe('laqi start — alias for the default serve mode', () => {
  it('serves, exactly as bare laqi does', async () => {
    root = makeMockRoot()
    const { stdout, child: proc } = await runUntil(['start', '--port', '0'], root, 'serving')
    child = proc

    expect(stdout).toContain('serving')
    expect(stdout).toContain('panel')
    expect(stdout).toMatch(/http:\/\/127\.0\.0\.1:\d+/)
  })

  it('bare laqi still serves — the regression that would matter most', async () => {
    root = makeMockRoot()
    const { stdout, child: proc } = await runUntil(['--port', '0'], root, 'serving')
    child = proc

    expect(stdout).toContain('serving')
    expect(stdout).toMatch(/http:\/\/127\.0\.0\.1:\d+/)
  })

  it('laqi start --port N honours the flag', async () => {
    root = makeMockRoot()
    const port = await freePort()
    const { stdout, child: proc } = await runUntil(
      ['start', '--port', String(port)],
      root,
      'serving',
    )
    child = proc

    expect(stdout).toContain(`http://127.0.0.1:${port}`)
  })

  it('an unknown command still fails with exit 5, and start is not one of them', async () => {
    root = makeMockRoot()
    const { stderr, exitCode } = await runToExit(['bogus'], root)

    expect(exitCode).toBe(5)
    expect(stderr).toContain('unknown command')
    expect(stderr).toContain('"bogus"')
    expect(stderr).not.toContain('"start"')
  })
})
