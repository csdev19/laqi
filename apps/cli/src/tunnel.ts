import { spawn, type ChildProcess } from 'node:child_process'

export type Tunnel = {
  url: string
  stop: () => Promise<void>
}

/**
 * The sharing layer as a pluggable interface, from day one
 * ([ADR-0007](../decisions/0007-public-url.md)). `CloudflaredProvider` is
 * phase 1; a self-hosted relay on Workers slots in here without rewriting
 * anything.
 */
export type TunnelProvider = {
  name: string
  /** Why it can't be used right now, or `null` if it's ready. */
  unavailable: () => Promise<string | null>
  start: (options: { port: number; signal?: AbortSignal }) => Promise<Tunnel>
}

/** Injectable so it can be tested without the binary installed. */
export type Spawner = (command: string, args: string[]) => ChildProcess

const TRYCLOUDFLARE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

export const CLOUDFLARED_MISSING = [
  'cloudflared is not installed, and --share needs it to open a public URL.',
  '',
  '  macOS     brew install cloudflared',
  '  linux     https://github.com/cloudflare/cloudflared/releases',
  '  windows   winget install --id Cloudflare.cloudflared',
  '',
  'No account or login is required for a quick tunnel.',
].join('\n')

/** How long to wait for the URL before giving up. */
export const URL_TIMEOUT_MS = 30_000

export function createCloudflaredProvider(options: { spawner?: Spawner } = {}): TunnelProvider {
  const spawner: Spawner =
    options.spawner ??
    ((command, args) => spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }))

  return {
    name: 'cloudflared',

    async unavailable() {
      return new Promise((resolve) => {
        let child: ChildProcess
        try {
          child = spawner('cloudflared', ['--version'])
        } catch {
          return resolve(CLOUDFLARED_MISSING)
        }

        child.on('error', () => resolve(CLOUDFLARED_MISSING))
        child.on('exit', (code) => resolve(code === 0 ? null : CLOUDFLARED_MISSING))
      })
    },

    start({ port, signal }) {
      return new Promise<Tunnel>((resolve, reject) => {
        const child = spawner('cloudflared', [
          'tunnel',
          '--no-autoupdate',
          '--url',
          `http://127.0.0.1:${port}`,
        ])

        let settled = false
        // cloudflared prints the URL in an ASCII banner split across
        // several writes, so we have to accumulate instead of looking at
        // each chunk in isolation.
        let buffered = ''

        /** Drains the pipe without keeping anything. See the comment in `finish`. */
        const drain = () => {}

        const onChunk = (chunk: Buffer | string) => {
          buffered += String(chunk)
          const match = TRYCLOUDFLARE.exec(buffered)
          if (!match) return

          finish(() =>
            resolve({
              url: match[0],
              stop: () =>
                new Promise<void>((done) => {
                  if (child.exitCode !== null || child.killed) return done()
                  child.once('exit', () => done())
                  child.kill()
                }),
            }),
          )
        }

        const finish = (action: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          // We stop ACCUMULATING, but keep draining.
          //
          // cloudflared keeps logging nonstop while the tunnel is alive, so
          // keeping it all would make `buffered` grow without bound and
          // re-run the regex over an ever-longer string. But just removing
          // the listeners pauses the stream: Node stops draining the pipe,
          // the pipe fills up, and cloudflared — which writes to stderr
          // blockingly — hangs forever on its next log line. Verified: the
          // child process froze at ~1.1MB after resolving.
          child.stdout?.off('data', onChunk)
          child.stderr?.off('data', onChunk)
          child.stdout?.on('data', drain)
          child.stderr?.on('data', drain)
          buffered = ''
          action()
        }

        const timer = setTimeout(() => {
          finish(() => {
            child.kill()
            reject(new Error(`cloudflared did not report a URL within ${URL_TIMEOUT_MS / 1000}s`))
          })
        }, URL_TIMEOUT_MS)

        // The URL comes out on stderr, but not in every version — watch both.
        child.stdout?.on('data', onChunk)
        child.stderr?.on('data', onChunk)

        child.on('error', (error) => finish(() => reject(error)))
        child.on('exit', (code) =>
          finish(() =>
            reject(new Error(`cloudflared exited with code ${code} before reporting a URL`)),
          ),
        )

        // Killing without settling would leave the promise hanging
        // forever, and since `finish` marks it settled, the `exit` that
        // follows couldn't reject it either. Aborting has to end the
        // CLI's await.
        signal?.addEventListener(
          'abort',
          () =>
            finish(() => {
              child.kill()
              reject(new Error('tunnel start aborted'))
            }),
          { once: true },
        )
      })
    },
  }
}
