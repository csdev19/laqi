---
title: "Terminal output — one rendering layer for start, failures and goodbye"
---

# Terminal output — one rendering layer for start, failures and goodbye

**Status:** Draft — design agreed from mockups, open questions below unresolved.

laqi's terminal output is the first thing anyone sees and, for most sessions,
the only thing. Today it is two lines:

```
⚡ laqi  http://127.0.0.1:8000
   watching ./laqi/  ·  7 endpoints
```

That is not wrong, it is thin. It omits the version, the panel URL — the
feature laqi is built around — and any sense of what loaded. And it is not a
system: **41 `console.*` calls live in production code, 32 of them in
`apps/cli/src/index.ts` alone**, each formatting itself.

That count is why start, failures and goodbye are one piece of work and not
three. They share a palette, a label column, a glyph set and a rule; split
across three efforts they would be invented three times and drift.

## What ships

### 1 · Start

```
⚡ laqi 2.0.1 ──────────────────────────────────────── ready in 84ms

serving     http://127.0.0.1:8000
panel       http://127.0.0.1:8000/__laqi
watching    ./laqi/ 7 endpoints · 19 responses · 4 scenarios

            press o panel · s share · c clear · q quit
```

- **The bolt is the only ornament, and it is the logo** — not a decorative
  emoji. Nothing else in the tool gets one.
- **One rule** carries the eye from the name to the boot time. No box drawing:
  boxes wrap badly, break on narrow terminals, and age poorly.
- **Labels dim, values bright.** A fixed label column means the URLs stack
  flush, which is what makes the block scannable.
- **Keys last**, four of them, one line, never mentioned again.

The counts (`19 responses · 4 scenarios`) are new information — today's line
says only how many endpoints loaded, which does not tell you whether your
scenarios file was picked up at all.

### 2 · Failures

One format, four severities. Every failure renders the same five parts:

| Part                 | Rule                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| **glyph + headline** | What failed, in six words. Never the exception class.                           |
| **cause**            | One sentence, plain words, no jargon, ending in a full stop.                    |
| **evidence**         | `file:line:col` and a three-line frame with a caret, or the conflicting values. |
| **remedy**           | One or two runnable commands under `try` / `or`. Copy-pasteable, never prose.   |
| **exit line**        | Whether laqi stopped or kept serving, and the exit code.                        |

Severities:

| Glyph | Severity  | Meaning                                    |
| ----- | --------- | ------------------------------------------ |
| `✗`   | fatal     | laqi stops — exit 1–9                      |
| `!`   | degraded  | keeps serving what loaded — exit 0 on quit |
| `•`   | notice    | something surprising but fine              |
| `↻`   | recovered | the thing that broke now works             |

Exit codes:

| Code | Meaning                         |
| ---- | ------------------------------- |
| 1    | unknown / unhandled             |
| 2    | no mock folder, or it is empty  |
| 3    | port unavailable                |
| 4    | every mock file failed to parse |
| 5    | bad flag or argument            |

The **degraded** severity is the one that carries weight. laqi already keeps
serving the files that parsed when one fails, but says so in a way that reads
like a crash. A `!` that ends in `still serving the 6 endpoints that loaded ·
save the file to retry` tells the truth about a state the user can work in.

Worked example, the port case:

```
✗ laqi could not start

  Port 8000 is already in use.

  Another process is listening on 127.0.0.1:8000 — most likely a laqi you
  started in another tab.

  try   laqi start --port 8001
  or    kill $(lsof -ti :8000)

  nothing was started · exit 3
```

Compare against today's single line, which names the flag but not the
occupant, and gives no way to find it.

### 3 · Goodbye

```
^C
⚡ laqi stopped ──────────────────────────────────────────── up 41m

served      218 requests · 9 unmatched
flipped     12 times · scenario offline for 6m
files       laqi/api.json written 3 times

            tupananchikkama — until we meet again
```

The summary is the only place laqi talks about itself, and it earns it: those
numbers tell you whether the session did what you thought it did. `9
unmatched` in particular is the number that catches a typo'd path in the
frontend, and today nothing surfaces it.

`tupananchikkama` is Quechua for "until we meet again" — the one flourish in
the tool, from the same place the name comes from.

A second `^C` during shutdown exits immediately with no summary. With sharing
on, the last line reads `public URL closed` instead.

## Architecture

A single module owns the vocabulary; nothing else formats output.

| Unit                      | Responsibility                                                                    |
| ------------------------- | --------------------------------------------------------------------------------- |
| `packages/tui/palette.ts` | Colour tokens, and the degradation ladder below.                                  |
| `packages/tui/layout.ts`  | The rule, the label column, width handling.                                       |
| `packages/tui/report.ts`  | `fatal()`, `degraded()`, `notice()`, `recovered()` — the five-part failure shape. |
| `packages/tui/screens.ts` | `start()`, `goodbye()`. Composition only, no formatting.                          |

Every `console.*` in `apps/cli` routes through it. The migration is the bulk of
the work and the part worth reviewing carefully: **41 call sites**, several of
which are on error paths with no test coverage today.

`packages/server` keeps its zero-`node:*` rule — it does not import this.

### Colour, and when to drop it

The palette comes from the panel, which already ships it (`#0B0A0F`
background, `#EAE7F2` text, `#00FFC2` accent, plus the violets and magentas in
`packages/editor`). The terminal reuses those values rather than inventing a
second set.

Three levels, chosen at startup and never re-checked:

1. **Truecolor** — the palette verbatim.
2. **256-colour** — nearest-neighbour mapping, computed once.
3. **No colour** — glyphs and layout carry the meaning alone.

Drop to level 3 when `NO_COLOR` is set (any value), when `TERM=dumb`, or when
stdout is not a TTY. **The last one matters most**: laqi's output gets piped
into CI logs and captured by agents, and escape codes there are noise. The
layout must stay readable with every colour removed — which is also the
accessibility requirement, met by the same mechanism.

## Constraints

- **stdout is sacred in `laqi mcp`.** It is the MCP protocol channel; the
  banner already goes to stderr there. The new layer must not regress this,
  and it is worth a test rather than a comment.
- **Narrow terminals.** The rule and the label column need a minimum width.
  Below it, degrade to stacked lines rather than wrapping mid-URL.
- **No box drawing.** Stated in the mockups and worth keeping as a rule.
- **English everywhere**, including the Quechua farewell's gloss (ADR-0009).

## Open questions

1. **The keys line implies interactivity that does not exist.** `o panel · s
share · c clear · q quit` needs raw-mode stdin. That conflicts with
   non-TTY runs, and `s share` starts a cloudflared tunnel — an outward-facing
   action behind a single keypress with no confirmation. Options: ship the
   keys without `s`; require a confirm for `s`; or ship start/failures/goodbye
   first and treat interactivity as its own piece. **Recommended: the last
   one.** It is a different kind of risk from everything else here, and the
   rest of the design does not depend on it.

2. **Where does the version string come from?** The mockup shows `laqi 2.0.1`.
   Reading it from `package.json` at runtime works from source but not from
   the bundle, where `package.json` is not adjacent to `dist/index.mjs`.
   Likely answer: tsdown injects it at build time — needs verifying against
   the current build.

3. **`up 41m` and the request counters need state that does not exist.** The
   server counts nothing today. Cheap to add, but it is a real addition to the
   request path and should be measured, not assumed free.

4. **Does `q quit` mean the summary prints on a clean quit as well as `^C`?**
   The mockup shows `^C`. Assume both, unless there is a reason not to.

## Out of scope

The panel's own visual design. This is the terminal only.
