import {
  closeSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  openSync,
} from 'node:fs'
import { dirname } from 'node:path'

/**
 * File writes that are safe across PROCESSES.
 *
 * Needed because this version connects two independent writers to the same
 * files: the `laqi mcp` server and the CLI's control plane, both through
 * `Project`. Without this, two simultaneous writes step on each other's
 * temp file and one blows up renaming something the other already took.
 */

/** How long to wait for the lock before giving up. */
export const LOCK_TIMEOUT_MS = 5_000

/**
 * From when a lock is considered abandoned.
 *
 * Has to be SHORTER than the timeout: if it were longer, a freshly-created
 * orphan lock (a process that died mid-write) would make everyone else wait
 * out the full timeout and fail, never able to reclaim it.
 */
export const LOCK_STALE_MS = 2_000

let tmpCounter = 0

/**
 * Writes `contents` atomically: to a temp file, then rename on top. A
 * rename on the same filesystem is atomic, so a reader never sees a
 * partially-written file — and chokidar is watching these files.
 *
 * The temp file's name is unique per write. With a fixed one, two processes
 * would step on each other's temp file and one fails with ENOENT on rename.
 */
export function writeFileAtomic(fullPath: string, contents: string): void {
  mkdirSync(dirname(fullPath), { recursive: true })

  const tmpPath = `${fullPath}.${process.pid.toString(36)}.${(tmpCounter++).toString(36)}.tmp`
  try {
    writeFileSync(tmpPath, contents, 'utf8')
    renameSync(tmpPath, fullPath)
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // If it can't be deleted either, the original error is what matters.
    }
    throw error
  }
}

export type LockOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Serializes a read-modify-write cycle against other processes.
 *
 * Not needed within a single process: this whole path is synchronous. It's
 * between processes that two simultaneous `read`s see the same state and
 * the second `write` overwrites the first.
 *
 * Returns a result instead of throwing: the caller exposes this as an HTTP
 * 500 or an MCP tool error, and a throw used to turn into a stack trace
 * with no context.
 */
export function withFileLock<T>(fullPath: string, work: () => T): LockOutcome<T> {
  const lockPath = `${fullPath}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let handle: number | undefined

  while (handle === undefined) {
    try {
      mkdirSync(dirname(lockPath), { recursive: true })
      handle = openSync(lockPath, 'wx')
      // The pid gets written so another process can see if I'm still alive.
      writeFileSync(handle, String(process.pid), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, error: `could not lock ${fullPath}: ${message(error)}` }
      }

      if (isAbandoned(lockPath)) {
        rmSync(lockPath, { force: true })
        continue
      }

      if (Date.now() > deadline) {
        // Proceeding without the lock is worse than failing: writes would
        // be lost silently, which is exactly what this exists to prevent.
        return { ok: false, error: `timed out waiting for the lock on ${fullPath}` }
      }

      sleepBriefly()
    }
  }

  try {
    return { ok: true, value: work() }
  } finally {
    closeSync(handle)
    rmSync(lockPath, { force: true })
  }
}

/**
 * Whether the lock was left abandoned and can be reclaimed.
 *
 * Goes by pid, not age: if the owner died it's reclaimed instantly, and if
 * it's ALIVE we wait even if the lock is old — stealing it from someone who
 * is simply slow would lose their write, which is exactly what this lock
 * exists to prevent. Age is only a fallback for when the pid can't be read
 * (a half-written lock, or a directory shared across machines where the pid
 * means nothing here).
 */
function isAbandoned(lockPath: string): boolean {
  const owner = readOwner(lockPath)

  // Couldn't read the pid: age is all that's left.
  if (owner === null) return isOlderThanStale(lockPath)

  // Our own lock. This path is synchronous, so we can't still be holding it
  // right now: it's left over from an earlier call that died between the
  // open and the finally.
  if (owner === process.pid) return true

  return !isAlive(owner)
}

function readOwner(lockPath: string): number | null {
  try {
    const pid = Number(readFileSync(lockPath, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0: sends nothing, just checks that the process exists.
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = exists but belongs to another user, i.e. it's alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isOlderThanStale(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS
  } catch {
    // Disappeared while we were checking: let the next attempt pick it up.
    return false
  }
}

/** Waits without async: the whole write path is synchronous on purpose. */
function sleepBriefly(): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buffer, 0, 0, 5)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
