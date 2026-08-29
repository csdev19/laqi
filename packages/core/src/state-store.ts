import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from './atomic-file'
import { DEFAULT_STATE, StateSchema, type LaqiState } from '@laqi/schema'

export const STATE_DIR = '.laqi'
export const STATE_FILE = 'state.json'

export class StateStore {
  readonly path: string

  constructor(root: string) {
    this.path = join(root, STATE_DIR, STATE_FILE)
  }

  /**
   * The machine generates this, so any corruption is silently discarded:
   * losing a session's state is preferable to not starting at all.
   */
  read(): LaqiState {
    if (!existsSync(this.path)) return { ...DEFAULT_STATE }

    try {
      const parsed = StateSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')))
      return parsed.success ? parsed.data : { ...DEFAULT_STATE }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  /**
   * Writes the whole state.
   *
   * Under the same lock as the mock files, and for the same reason: the TWO
   * processes that write mocks — `laqi mcp` and the CLI's control plane —
   * also write here, via `setResponse`, `setScenario`, and `PUT /api/state`.
   * The concurrency fix had only been applied to `writer.ts`, so this file
   * still carried the whole bug: fixed-name temp file, ENOENT on rename, and
   * lost writes. Measured before the fix: of 600 overrides written from two
   * processes, 300 survived, with a crash.
   */
  write(state: LaqiState): void {
    withFileLock(this.path, () => {
      writeFileAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`)
    })
    // Not propagating the failure, on purpose: this is machine state, and
    // its contract since Plan 1 is that it never takes the server down. A
    // stale lock loses that change; losing one flip is preferable to a 500.
  }

  /**
   * Reads, transforms, and writes in a single turn under the lock.
   *
   * `read()` followed by `write()` from the outside leaves a window where
   * another process writes in between and its change gets lost. Anyone
   * mutating the state should use this.
   */
  update(change: (current: LaqiState) => LaqiState): LaqiState {
    let result: LaqiState = this.read()

    withFileLock(this.path, () => {
      result = change(this.read())
      writeFileAtomic(this.path, `${JSON.stringify(result, null, 2)}\n`)
    })

    return result
  }
}
