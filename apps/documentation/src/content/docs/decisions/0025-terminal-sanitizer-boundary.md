---
title: ADR-0025 — The terminal renderer is the trust boundary for what reaches a terminal
---

# ADR-0025 — The terminal renderer is the trust boundary for what reaches a terminal

**Status:** Proposed
**Date:** 2026-10-12
**Ticket:** NIW2-316 — [UI surfaces hardening spec](/design/ui-surfaces-hardening/)

## Context

laqi prints text it did not write: file names, the lines of a mock file that failed to parse, V8's parse message (which quotes the source), config values, the tunnel URL, and — once the terminal request stream (PR #56) lands — request paths and the `X-Laqi-Response` header value that chose a response. A terminal executes control characters: ESC-led sequences clear the screen, retitle the window or write the clipboard (OSC 52), and a single C1 byte (U+009B) is a CSI introducer on terminals that honour 8-bit controls. A cloned repository, a shared "mock pack", or anyone holding a `--share` URL can therefore drive the developer's terminal through laqi.

`@laqi/tui` was written as a pure rendering layer ([terminal-output](/design/terminal-output/)): values in, string out, `paint()` adds colour, nothing removes anything. The question was where the removal belongs.

## Decision

**`@laqi/tui` sanitizes every string that enters one of its renderers, and renderers are the only code that paints.**

1. `sanitize(text)` replaces C0 controls (except TAB and LF), DEL, C1 controls, the Unicode line separators and the bidirectional override and isolate controls with a **visible stand-in** (`␛` for ESC, `␇` for BEL, `␍` for CR, `␡` for DEL, U+FFFD otherwise). It never drops a character and never truncates.
2. Every exported renderer (`renderFailure`, `row`, `startScreen`, `goodbyeScreen`, `requestRow`) applies `sanitize` to every string field of its input before painting or measuring. Callers do not pre-sanitize.
3. Callers pass raw text plus a colour token (a `Segment`); renderers call `paint()`. A string that arrives already containing ESC is treated like any other control character, so a caller that still pre-paints sees `␛[38;2;…m` in the output: the mistake is visible, not silently honoured.

## Alternatives rejected

**Sanitize at the sources** (`LoadError` in `@laqi/core`, the CLI's call sites, the server's event fields). Strongest argument: every surface would receive clean data. Rejected: the panel escapes for HTML by construction and MCP must report file contents faithfully, so only the terminal needs this; and a per-source rule is re-implemented per source and missed by the next one — PR #56's header value is exactly the case that a source-side rule written for file excerpts would have missed.

**Strip silently.** Strongest argument: output never shows an odd glyph. Rejected: a cleaned excerpt no longer shows what is wrong with the file, and silent removal hides tampering. One glyph is the price of honesty.

**Let `paint()`'s own SGR sequences pass through** (sanitize everything except `\x1b[…m`). Strongest argument: `row` keeps accepting pre-painted strings, no caller changes. Rejected: an attacker's `\x1b[38;2;0;0;0m` (black on black) or `\x1b[8m` (conceal) is byte-for-byte indistinguishable from ours and hides the line that reports the failure. Making renderers the only painters removes the ambiguity instead of guessing at it.

**A terminal-side defence** (document that users should disable OSC 52). Rejected as the only measure: laqi should not be the carrier, whatever the terminal does.

## Consequences

**In favour:**

- One rule, one place, forty lines, covered by one test fixture of hostile strings reused by every renderer test and by an end-to-end CLI test.
- New renderers (the request stream, a future QR line, the user-agent family of stage 3) are safe by construction: they inherit the rule by living in `@laqi/tui`.
- Piped output (level `none`) becomes strictly cleaner: no byte in C0/C1 except TAB and LF.

**Against:**

- `row()` changes signature; the CLI's few call sites that pre-painted migrate in the same change, and PR #56 rebases.
- Stand-ins assume a Unicode-capable terminal font, as the bolt and the rule already do. Caret notation (`^[`) is the fallback if that assumption is ever wrong.
- `paint()` stays exported for literals, so the rule is enforced by convention plus a test that lists the CLI's raw `console.*` calls, not by the type system.

## Non-goals

- Sanitizing for the panel or MCP: different escaping, different surface, different owner (NIW2-314 for MCP output delimiting).
- Deciding what the server should accept in `X-Laqi-Response` (NIW2-309/NIW2-314); the renderer does not rely on it.
- Width, wrapping and truncation policy, which stay in layout.

## Reopen condition

A renderer that must emit a non-SGR escape on purpose (an OSC 8 hyperlink to the panel URL, a cursor move for an in-place request stream). The answer then is a second, named, allow-listed emitter inside `@laqi/tui` for that one sequence, not a passthrough of caller-supplied escapes.
