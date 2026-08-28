// apps/cli/src/goodbye.ts
import type { SessionCounters } from '@laqi/core'
import { goodbyeScreen, paint, type Level } from '@laqi/tui'

/**
 * The farewell line `goodbyeScreen` always prints, spelled out in the exact
 * form `paint()` produces it — so it can be swapped out with a plain string
 * replace instead of teaching the screen itself about sharing, which
 * `apps/cli` is the only caller that knows anything about.
 */
function farewell(level: Level): string {
  return `${paint('tupananchikkama', 'bolt', level)} ${paint('— until we meet again', 'dim', level)}`
}

/**
 * The session summary printed on the way out, on `^C` and on a clean exit
 * alike. With sharing on, the tunnel closing is the fact that matters at
 * that moment, not the farewell — so the last line reads `public URL closed`
 * instead.
 */
export function renderGoodbye(
  counters: SessionCounters,
  upMs: number,
  level: Level,
  shareWasOn: boolean,
  columns?: number,
): string {
  const screen = goodbyeScreen({ upMs, ...counters.snapshot() }, level, columns)
  if (!shareWasOn) return screen
  return screen.replace(farewell(level), paint('public URL closed', 'accent', level))
}
