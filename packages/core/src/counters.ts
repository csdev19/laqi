/**
 * What the goodbye summary reports. Nothing counted anything before this, so
 * every field here is new state on a path that runs per request — kept to
 * integer increments and a Map to count write frequency.
 */
export class SessionCounters {
  #requests = 0
  #unmatched = 0
  #flips = 0
  readonly #files = new Map<string, number>()

  recordRequest(matched: boolean): void {
    this.#requests += 1
    if (!matched) this.#unmatched += 1
  }

  recordFlip(): void {
    this.#flips += 1
  }

  recordWrite(file: string): void {
    this.#files.set(file, (this.#files.get(file) ?? 0) + 1)
  }

  snapshot(): {
    requests: number
    unmatched: number
    flips: number
    filesWritten: readonly { file: string; times: number }[]
  } {
    return {
      requests: this.#requests,
      unmatched: this.#unmatched,
      flips: this.#flips,
      filesWritten: Array.from(this.#files, ([file, times]) => ({ file, times })),
    }
  }
}
