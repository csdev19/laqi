// apps/cli/src/open-browser.ts
//
// Lives here, not under init/, because it has two callers: `laqi init
// --open` and the `o` key on a running server.
//
// Best-effort only. `--open` on a machine with no browser (a container, CI,
// a headless box an agent runs in) is a notice, not a failure — the caller
// decides what to do with a `{ opened: false }` result, this module never
// throws. The child process is unref'd so a missing opener, or one that
// never exits, cannot hang the CLI or a test runner waiting on it.
import { execFile, type ChildProcess } from 'node:child_process'

export type OpenResult = { opened: true } | { opened: false; reason: string }

export function openBrowser(url: string): Promise<OpenResult> {
  const [command, args] = openerFor(process.platform, url)

  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = execFile(command, args, (error) => {
        resolve(error ? { opened: false, reason: describeError(error) } : { opened: true })
      })
    } catch (error) {
      resolve({ opened: false, reason: describeError(error) })
      return
    }
    child.unref()
  })
}

function openerFor(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]]
  // cmd's `start` treats the first quoted argument as the window title, so
  // an empty one is required or a `url` containing spaces would be read as
  // the title instead.
  if (platform === 'win32') return ['cmd', ['/c', 'start', '""', url]]
  return ['xdg-open', [url]]
}

function describeError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return 'no browser opener was found on this machine'
  return error instanceof Error ? error.message : String(error)
}
