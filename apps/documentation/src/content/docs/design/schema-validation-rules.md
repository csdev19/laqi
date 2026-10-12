---
title: Schema validation rules — design spec
---

# Schema validation rules — design spec

**Status:** proposed, not implemented
**Date:** 2026-10-12
**Ticket:** [NIW2-315](https://linear.app/niway/issue/NIW2-315) — Tighten `@laqi/schema` validation and fail closed on bad config (audit umbrella NIW2-302)

This document turns the audit findings for `packages/schema` into contracts an
implementer can build and a reviewer can check. Normative statements use
**must** / **must not**. Code blocks marked _illustrative_ show intent, not final
declarations. Every file:line below is on the `origin/main` snapshot of
2026-10-12 unless it says otherwise.

## One-minute block

### Summary

`@laqi/schema` is the only place where the three writers of a mock file (human,
panel, MCP agent — [three-writers](/concepts/three-writers/)) and the one
reader of `laqi.config.json` agree on what is valid. Today it checks shape and
little else, so six things that the runtime cannot serve, or that a cloned
repository should not be able to decide, pass validation:

1. Config paths accept absolute paths and `..` (`config.ts:8,10,21,35`).
2. Endpoint paths reach Hono as **route patterns**: `GET /x/:id{(a+)+$}` is a
   backtracking regex on the single event loop. **Verified**: 26 `a`s cost
   620 ms, 27 cost 1.6 s, doubling per character, reachable through `--share`.
3. `status` 1xx, and a body on 204/205/304, pass the schema and then fail on
   **every request** with a 500. **Verified** against `@hono/node-server`.
4. Header names and values are unchecked: a malformed one is a 500 on every
   request (**verified**), and a mock-declared `Access-Control-Allow-Origin: *`
   **overrides** the CORS allowlist, including through the tunnel (**verified**;
   contradicts ADR-0007).
5. An invalid `laqi.config.json` is replaced by the defaults, including
   `cors: '*'` (`apps/cli/src/index.ts:64-74`).
6. Unknown keys are silently stripped, and the writer re-serialises the stripped
   object (`writer.ts:225,263,295`), so a hand-written key is lost on the next
   panel or MCP save. **Verified** by reading the write path.

The design: treat `laqi.config.json` as repository content (closed schema,
project-relative paths, fail closed), give endpoint paths a small literal
grammar, align status and header rules with what the Fetch `Response` can
serve, and refuse unknown keys. All of it ships in **one** major release,
`laqi@3.0.0`, with per-endpoint, file-and-line errors as the migration path
rather than a rewriting command.

### Decisions

| #   | Decision                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                     | ADR                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| D1  | Every path in `laqi.config.json` (`dir`, `file`, `schemaSources.root`, `mcp.modules[].file`) **must** be project-relative: not absolute, no drive letter or UNC, no `..` segment, no NUL, not empty.                                                                    | The file travels with a clone; it is the same trust class as `.vscode/tasks.json`. A path there must not reach outside the folder the developer chose to open.                          | ADR-0023 config-is-repository-content             |
| D2  | `--dir` / `--file` typed on the command line keep accepting any path, including outside the project. The rule in D1 applies to the file, not the flags.                                                                                                                 | The flag is typed by the person running laqi; an external `--dir` is a documented, tested capability (`project.ts:114-119`, `module-permission.test.ts:203-214`).                       | same ADR                                          |
| D3  | `laqi.config.json` is a **closed** schema (`z.strictObject` at every level); `$schema` is the one tolerated extra key. `cors` entries **must** be exact origins; `"*"` and `"null"` inside the list are refused.                                                        | A misspelled `cros` means the policy the user wrote is not in effect; for a security setting that is the worst way to fail. `"null"` in the list would admit sandboxed pages.           | same ADR                                          |
| D4  | An invalid or unparsable `laqi.config.json` **stops** `laqi start`, `laqi mcp` and `laqi migrate` with a fatal report and exit code 5. No fallback to defaults, ever.                                                                                                   | The defaults include `cors: '*'` and an empty module allowlist is the only thing keeping MCP from executing project code; "using defaults" silently relaxes both.                       | same ADR                                          |
| D5  | An endpoint path is `/` or `/seg(/seg)*` where a segment is a literal of RFC 3986 `pchar` minus `:` `%` `*`, or a whole-segment `:param`. `?`, `#`, `{`, `}`, `*`, `\`, `%`, empty, `.` and `..` segments are refused. Param names are identifiers and unique per path. | The path string is a Hono route pattern. Everything outside this grammar is either router syntax (regex, wildcard, optional) or can never match a request.                              | ADR-0024 endpoint-paths-are-literal-routes        |
| D6  | `STATUS_MIN` becomes 200; 1xx leaves the catalogue. A response with status 204, 205 or 304 **must not** carry a `body` key (`null` counts as a body).                                                                                                                   | `new Response()` throws for status < 200 and for a body on a null-body status; `@hono/node-server` turns that into a 500 per request. The schema is where the write should have failed. | none (reversible default; spec table is enough)   |
| D7  | Header names **must** be RFC 9110 tokens; values **must** match `[\t\x20-\x7e\x80-\xff]*`. Framing and hop-by-hop names, and every `access-control-*` name, are refused with a message naming the config key.                                                           | `Headers.set` throws on the rest; `Content-Length` lies to the client (**verified**); CORS headers are laqi's policy, not the mock's, and a mock value overrides the tunnel allowlist.  | none; the CORS rule reuses ADR-0007               |
| D8  | Endpoint and response objects become `z.strictObject`. On load, an endpoint whose only issues are unknown keys is **served** and reported as `degraded` with file, line and key; a write that carries unknown keys is **refused**.                                      | A typo must be loud, but pulling a working endpoint for `"descripton"` is hostile; refusing the write is what stops the silent data loss. Same shape as the `lossy-number` precedent.   | ADR-0023 config-is-repository-content (section 4) |
| D9  | All of the above ships together as `feat!` → `laqi@3.0.0`, with a BREAKING CHANGE footer listing each rule. No warn-then-error phase and no `laqi migrate` rewrite; the migration tool is the error band.                                                               | Each rule alone is a major; users pay per major, not per rule. Nothing here is mechanically rewritable without changing what a mock means.                                              | same ADR, consequences                            |

### Open questions for the owner

1. **Monorepo `schemaSources.root`.** D1 refuses `"root": "../../packages/domain/src"`,
   which is a plausible layout. Recommendation: refuse it now and reopen when
   NIW2-310's repo-local trust prompt exists, which is the right place to let a
   person approve a config that reaches outside the folder. The alternative — a
   `schemaSources.trustOutside: true` key — is a self-approval in the same
   untrusted file and defeats the purpose.
2. **Trailing slash.** D5 refuses `GET /users/`. Hono's default strict routing
   does distinguish `/users/` from `/users`, so someone may have one on purpose.
   Recommendation: refuse; the panel and MCP would otherwise create two ids
   one character apart. Say so if you want it allowed.
3. **Exit code.** D4 reuses exit 5 (`bad flag or argument`, terminal-output.md
   table) rather than adding a code. If a distinct `invalid config` code is
   preferred, 9 is free and the table is the only thing to update.
4. **`$schema` in mock files.** ADR-0003 shows `"$schema": "https://laqi.dev/schema.json"`
   at the top of `laqi.json`; today the loader treats it as an endpoint key and
   reports an error (`loader.ts:148-152`). Reserving it is a two-line loader
   change in NIW2-313's file; decide which ticket carries it.

### Out of scope

- Publishing a JSON Schema for `laqi.json` / `laqi.config.json` (audit Q11).
  `z.toJSONSchema` cannot express the refinements below; a later ticket.
- Body size, header count at the HTTP boundary, and `bodyLimit` on control-plane
  routes (audit P1): NIW2-309 owns `packages/server`.
- Symlink-aware confinement of `dir` / `file` at write time: NIW2-313. D1 is a
  lexical rule on the string in the file; it does not replace `resolveInside`.
- The repo-local module trust prompt and anything that makes `mcp.modules`
  more than a string match: NIW2-310. D1 only bounds what the list may name.
- `host` validation beyond "non-empty, no whitespace" (audit S5): the loopback
  decision lives in `serve.ts:60-68`, NIW2-309.
- Scenario → endpoint → response cross-reference validation (audit Q9).
- A `laqi check` verb. The agent-first CLI design may add one later; this spec
  does not depend on it.

## Verification log

Everything in this section was executed on 2026-10-12 against the dependencies
laqi pins: `hono@4.12.3`, `@hono/node-server@1.19.17`, `zod@4.3.6`, Node 24.21.0.
The scripts are in the audit scratchpad (`verify-315/probe.mjs`, `scale.mjs`,
`zod-probe.mjs`); they import laqi's own `node_modules`.

**Hono compiles `{...}` into a `RegExp`** (`hono/dist/utils/url.js:40-45`,
`router/reg-exp-router/node.js:42-54`). `RegExpRouter` refuses a capturing group
(`UnsupportedPathError`), `SmartRouter` then falls back to `TrieRouter`
(`router/smart-router/router.js:27-41`), which compiles it as written. With a
non-capturing group `(?:a+)+$` the `RegExpRouter` itself accepts it.

| Pattern            | Router (default = SmartRouter) | Request `/x/a…ab` | Time    |
| ------------------ | ------------------------------ | ----------------- | ------- |
| `/x/:id{(a+)+$}`   | falls back to TrieRouter       | n = 20            | 38 ms   |
|                    |                                | n = 24            | 154 ms  |
|                    |                                | n = 26            | 620 ms  |
|                    |                                | n = 27            | 1618 ms |
| `/x/:id{(?:a+)+$}` | RegExpRouter                   | n = 27            | 232 ms  |

Growth is ×4 per two characters; a 40-character request would run for hours.
During the stall, nothing else is served: the match runs on the event loop.
A sibling `/users/1` answered in 0.1 ms only once the evil request finished.
The audit's "timing unverified" is now verified.

**Other pattern behaviour** (default router, `app.request`): `/a?b=1`, `/a#x`,
`/a%20b`, `/a\b`, `/a/%2e%2e/x` never match any request (dead endpoints).
`//x` matches only a request for `//x`. `/:a{.*}` matches everything.
`/users/:id?` and `/files/*` behave as Hono optional and wildcard routes.
`/café` matches a request for `/caf%C3%A9`: Hono decodes the request path, so
a route literal is written decoded, never percent-encoded.

**What the client sees from `@hono/node-server`** (real listener, raw socket):

| Handler                                        | Response                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `c.json({a:1}, 204)` / `205` / `304`           | `500` — `TypeError: Response constructor: Invalid response status code 204`    |
| `c.body(null, 101)` / `100`                    | `500` — `RangeError: init["status"] must be in the range of 200 to 599`        |
| `c.header('a b', 'v')`                         | `500` — `TypeError: Headers.set: "a b" is an invalid header name`              |
| `c.header('x-a', 'a\r\nSet-Cookie: x=1')`      | `500` — invalid header value (no splitting; undici refuses CR/LF/NUL)          |
| `c.header('Access-Control-Allow-Origin', '*')` | `200` with `access-control-allow-origin: *` for an origin NOT in the allowlist |
| `c.header('Content-Length', '2')`              | `200`, `content-length: 2`, then the full 30-byte body on the wire             |
| `c.header('Transfer-Encoding', 'chunked')`     | `200`, served chunked                                                          |
| `c.header('Set-Cookie', …)`                    | `200`, cookie forwarded                                                        |

The CORS override is explained by `hono/dist/middleware/cors/index.js:36-42`
(the middleware calls `c.res.headers.set` **before** `await next()`) and
`context.js:209-220` (the handler's `c.header` sets on the same `Headers`
object afterwards). `mock-app.ts:70-72` sets every mock header in the handler,
and `public-app.ts:126` mounts that same mock app behind the tunnel with the
allowlist as its `cors`, so the override reaches the public URL.

**Fetch `Headers` value range** (undici): `\x7f`, `café` (U+00E9) and `\u00ff`
are accepted; `\u0100` throws (`ByteString`); leading and trailing spaces are
trimmed by `set`. This is why D7's value class ends at `\xff` and allows `\x7f`.

**Zod 4.3.6**: `z.strictObject` reports `unrecognized_keys` with the key names
in `issue.keys`; a record key regex failure reports the generic
`Invalid key in record` and ignores the custom message, so header-name errors
need a `superRefine` to name the header.

**Not verified**: Bun's `Response` (laqi serves through `@hono/node-server`
under both runtimes, `serve.ts:3,565`, so the Node behaviour is the one that
matters; the Bun process was not probed). Whether a mock `Content-Type` header
wins over `c.json`'s default. Both are marked where they appear.

## Finding 1 — config paths escape the project

**Current behaviour.** `ConfigSchema` (`packages/schema/src/config.ts:3-46`)
types `dir`, `file`, `schemaSources.root` and `mcp.modules[].file` as
`z.string()` (`min(1)` on the module file only). `loadConfig`
(`apps/cli/src/index.ts:44-77`) reads the file from `process.cwd()`. The
adapters spec already says `schemaSources.root` "is relative to `Project.root`"
([json-schema-adapters](/design/json-schema-adapters/), Configuration), but
nothing enforces it. `resolveSourcePath` (`packages/core/src/writer.ts:103-119`)
confines reads to `resolve(root, schemaSources.root)`, which is exactly the
value the file controls.

**Threat.** A developer clones a repository and runs `npx laqi` (or an agent
runs `laqi mcp`). Its `laqi.config.json` says `"schemaSources": { "root": "/" }`
and lists `{ "file": "home/me/.ssh/config", … }` — or, more practically,
`"dir": "../../some/other/checkout"` so mocks are written somewhere the
developer is not looking. This is the `.vscode/tasks.json` class that VS Code
Workspace Trust exists for: a file that ships with the clone decides what the
tool does to the machine.

**Designed behaviour.**

- `@laqi/schema` exports `ProjectRelativePath`, a string schema. A value
  **must** be non-empty, **must not** contain `\0`, **must not** start with `/`
  or `\`, **must not** match `/^[A-Za-z]:/` (drive) or start with `//` / `\\`
  (UNC), and **must not** contain a `..` segment when split on either `/` or
  `\`. Both separators are checked on every platform because the file travels
  between them. A `.` segment and a leading `./` are allowed.
- `ConfigFileSchema` (the renamed, closed schema of what the file may contain;
  see Finding 5) uses `ProjectRelativePath` for all four fields. Defaults are
  unchanged (`laqi`, `laqi.json`, `.`).
- The CLI merges `--dir` / `--file` **after** the file is validated, not before
  (today `index.ts:61` merges first). Flags are validated with the runtime rule
  only: non-empty, no NUL. The resolved `LaqiConfig` type keeps `dir: string`.
- The error message names the field and the rule:
  `dir: "../elsewhere" contains ".." — a path in laqi.config.json must stay inside the project`.

```ts
// packages/schema/src/project-relative-path.ts — illustrative
export function projectRelativePathProblem(value: string): string | null
export const ProjectRelativePath = z.string().superRefine(/* adds the problem as a custom issue */)
```

**Migration.** A config with an absolute or `..` path stops laqi (D4) with the
message above. Users who relied on `"dir": "/tmp/mocks"` in the file move it to
`laqi start --dir /tmp/mocks` (D2), which keeps working. No known example or
docs page uses an absolute path in the file.

**Tests** (`packages/schema/src/project-relative-path.test.ts`, new):

- `refuses absolute, drive, UNC, dotdot, NUL and empty` — for each of
  `/etc`, `\share`, `C:\x`, `C:/x`, `//srv/share`, `../x`, `a/../../x`,
  `a\..\x`, `a\0b`, ``—`safeParse().success === false`, and the message
  contains the offending value.
- `accepts nested relative paths` — `mocks/api`, `./src`, `src/./types`, `.`,
  `a..b/c` parse unchanged.
- In `config.test.ts`: `refuses an escaping path in every path field` — same
  bad list applied to `dir`, `file`, `schemaSources.root`,
  `mcp.modules[0].file`; `issue.path` names the field.
- In `apps/cli/src/index.test.ts` (uses the existing `runToExit` helper,
  `index.test.ts:102-126`): `exits 5 when laqi.config.json points dir outside the project`
  — write `{"dir":"../elsewhere"}`, run `--port 0`, expect `exitCode === 5`,
  stderr contains `laqi.config.json` and `..`, stdout does not contain the start
  screen. And `still accepts --dir outside the project` — run with
  `--dir <tmpdir-with-mocks>`, expect the start screen.

## Finding 2 — endpoint paths are Hono route patterns

**Current behaviour.** `parseEndpointKey` (`packages/schema/src/endpoint-key.ts:10-53`)
requires `METHOD \S+`, a leading `/`, no `..` segment, and not the reserved
prefix. The path is handed verbatim to `app.on(method, path, …)`
(`packages/server/src/mock-app.ts:31`). `Project.createEndpoint`
(`core/src/project.ts:198`) and the loader (`core/src/loader.ts:148`) both go
through `parseEndpointKey`, so one function gates every writer.

**Threat.** A mock file in a shared repository, or an agent calling
`create_endpoint`, declares `GET /x/:id{(a+)+$}`. Every request to
`/x/aaa…ab` — from the public tunnel URL too, which only needs the bearer
token the developer handed out — runs a backtracking regex on the event loop
for seconds to hours (verification log). `GET /:a{.*}` shadows every other mock.
`GET /a?b=1` is a dead endpoint the panel shows as live.

**Designed behaviour.** `parseEndpointKey` **must** accept exactly this grammar
and nothing else:

```
path     = "/" | "/" segment *( "/" segment )
segment  = param | literal
param    = ":" ident                       ; whole segment; ident = [A-Za-z_][A-Za-z0-9_]*
literal  = 1*lchar
lchar    = ALPHA / DIGIT / "-" / "." / "_" / "~"          ; RFC 3986 unreserved
         / "!" / "$" / "&" / "'" / "(" / ")" / "+" / "," / ";" / "="   ; sub-delims minus "*"
         / "@"
         / %x80-10FFFF minus Unicode whitespace             ; written decoded, e.g. /café
```

Additional rules, each with its own message:

- An empty segment (`//`, trailing `/` except the root) is refused:
  `an empty path segment never matches a request`.
- `.` and `..` segments are refused (the `..` message stays as today).
- `%` anywhere is refused: `write the character itself — a request path is decoded before routing, so "%20" in a route never matches`.
- `?`, `#`, `{`, `}`, `*`, `\`, `|`, `[`, `]`, `^`, `` ` ``, `"`, `<`, `>`
  and `:` inside a literal are refused with
  `segment "…" is not allowed: use letters, digits and -._~, or a whole-segment ":param"`.
  `:` mid-segment is refused because Hono's `RegExpRouter` tokeniser
  (`reg-exp-router/trie.js:22`) treats `a:b` as `a` followed by a parameter,
  so `/orders/a:b` would match `/orders/aXYZ` under one router and not the other.
- Duplicate param names in one path are refused (`:id` twice: Hono keeps one).
- Path length **must** be at most 1024 characters.
- Reserved-prefix check unchanged and case-sensitive: Hono routes are
  case-sensitive, so `/__LAQI/x` is only ever served by the mock app and
  shadows nothing (verified).

`hasPathParam` (`scaffold.ts:15-17`) already defines a param as a whole segment
starting with `:`; the grammar makes the two agree.

**Migration.** Keys with router syntax are per-endpoint load errors
(`degraded`, the endpoint is pulled, the rest of the file is served —
[ADR-0008](/decisions/0008-multifile-and-names/) point 2). The message names
the segment. Nothing is rewritten: `/:id{[0-9]+}` has no literal equivalent and
`/files/*` would need an explicit decision from the author.

**Tests** (`packages/schema/src/endpoint-key.test.ts`, additions):

- `refuses router pattern syntax` — each of `GET /x/:id{(a+)+$}`,
  `GET /x/:id{(?:a+)+$}`, `GET /:a{.*}`, `GET /x/:id?`, `GET /files/*`,
  `GET /a?b=1`, `GET /a#x`, `GET /a\b`, `GET /a|b`, `GET /{x}` → `ok: false`.
- `refuses empty, dot and percent segments` — `GET //x`, `GET /a//b`,
  `GET /a/`, `GET /a/./b`, `GET /a%20b`, `GET /a/%2e%2e/x` → `ok: false`.
- `refuses a colon inside a literal and duplicate params` — `GET /orders/a:b`,
  `GET /a/:id/b/:id` → `ok: false`.
- `accepts the documented grammar` — `/`, `/users`, `/users/:id`,
  `/v1.2/a-b_c~d/:orderId`, `/café`, `/files/report.pdf`, `/a..b`,
  `/items/(1)`, `/a/:id_2` → `ok: true`, path unchanged.
- `packages/server/src/mock-app.test.ts` (new case, this ticket owns only the
  test): `every accepted path registers without UnsupportedPathError and
matches itself` — for the accepted list above, build a `Hono` app with
  `new RegExpRouter()` and another with `new TrieRouter()`, register, request
  the literal path with `:id` replaced by `1`, expect 200 on both. This is the
  test that proves the grammar is a subset of what both routers treat
  identically.

## Finding 3 — statuses the runtime cannot serve

**Current behaviour.** `STATUS_MIN = 100` (`status-codes.ts:12`), the
catalogue lists 100 and 101 (`:39-40`), `ResponseSchema.status` is
`int().min(100).max(599)` (`response.ts:9-13`) and `body` is `z.unknown().optional()`
(`:14`) with no relation to `status`. The scaffold already knows the rule
(`scaffold.ts:21-27`: 204 is built without a `body` key); the schema does not.

**Failure.** A user picks `100 Continue` in the panel combobox, or an agent
writes `{ "status": 204, "body": {} }`. The write succeeds; every request then
answers `500 ERR` (verification log).

**Designed behaviour.**

- `STATUS_MIN` **must** be `200`. `STATUS_CODES` **must not** contain 1xx;
  `StatusGroup` drops `'informational'`. `parseStatusCode('100')` returns
  `null`. The panel's range message (`CreateEndpointRow.tsx:127`) follows the
  constant and needs no change beyond its test.
- `BODYLESS_STATUSES = [204, 205, 304]` is exported. `ResponseSchema`
  **must** refuse a response whose status is in that list and which has a
  `body` key at all (`undefined` from a missing key is fine; `null` is a body:
  `c.json(null)` serialises `null`). Message:
  `a 204 response cannot have a body — remove "body" or pick another status`.
- 101 and 103 are also null-body statuses in Fetch, but they are below 200 and
  already excluded.

**Migration.** A stored 1xx or a 204 with a body is a per-endpoint load error
naming the response and the fix. Those mocks were returning 500 before, so no
working mock changes behaviour.

**Tests** (`packages/schema/src/response.test.ts`, `status-codes.test.ts`):

- `rejects 1xx` — `{status: 100}`, `{status: 101}`, `{status: 199}` →
  `success === false`; `{status: 200}` → true. `STATUS_CODES.every(c => c.code >= 200)`.
- `rejects a body on 204, 205 and 304` — for each status, `{status, body: {}}`
  and `{status, body: null}` → false; `{status}` → true; the issue `path` is
  `['body']`.
- `status-codes.test.ts:66-82`: `parseStatusCode('100')` → `null`,
  `parseStatusCode('199')` → `null`, `'200'` → 200.
- `packages/editor/src/components/CreateEndpointRow.test.tsx:234-240`: the
  alert text contains `200` and `599` (replaces `100`).

## Finding 4 — headers are unchecked

**Current behaviour.** `headers: z.record(z.string(), z.string())`
(`response.ts:16`); `mock-app.ts:70-72` calls `c.header(name, value)` for each.
Only `X-Laqi-Resolved` is protected, by being set last (`:74-76`).

**Failure and threat.** A name with a space or a value with a newline is a
500 per request (verification log). A mock `Access-Control-Allow-Origin: *`
plus `Access-Control-Allow-Credentials: true` overrides the allowlist for any
origin, locally and through `--share` — the exact state ADR-0007 forbids. A
`Content-Length` that does not match the body produces a framing lie the client
has to deal with.

**Designed behaviour.** `HeadersSchema` in `@laqi/schema`:

- A name **must** match RFC 9110 `token`: `/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/`,
  at most 256 characters. Checked in a `superRefine` so the message can name
  the header (Zod's record-key message cannot, verification log):
  `header name "a b" is not valid: letters, digits and !#$%&'\*+-.^\_`|~ only`.
- A value **must** match `/^[\t\x20-\x7e\x80-\xff]*$/` and be at most 8192
  characters: `header "x-a" has a line break or control character in its value`.
- At most 64 headers per response.
- Names in `FRAMING_HEADERS = ['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'host']`
  (compared lower-case) are refused: `"content-length" is set by the server from the body and cannot be mocked`.
- Names starting with `access-control-` (lower-case compare) are refused:
  `CORS headers are not mocked — allowed origins are declared as "cors" in laqi.config.json (ADR-0007)`.
- Everything else, including `Set-Cookie`, `Location`, `Content-Type`,
  `Cache-Control` and `X-Laqi-Resolved`, stays allowed. Whether a mock
  `Content-Type` wins over `c.json`'s default is **unverified** and unchanged.

The refusal lives in the schema rather than in `mock-app.ts` on purpose: the
schema is the one gate the three writers share, and NIW2-309 owns `mock-app.ts`.
NIW2-309 may add a belt-and-braces strip of `access-control-*` after the mock
headers; this spec does not require it.

**Migration.** A mock with a refused header is a per-endpoint load error
naming the header. `Access-Control-*` in a committed mock is the one case that
"worked" before; the message says where the setting moved.

**Tests** (`packages/schema/src/response.test.ts`):

- `accepts ordinary headers` — `{'X-Custom': 'yes', 'Cache-Control': 'no-store', ETag: '"a b"\tc', 'Set-Cookie': 'sid=1; Path=/', 'X-Latin1': 'café'}` → true.
- `rejects names that are not tokens` — `'a b'`, `'a:b'`, `''`, `'a\nb'`,
  `'héader'`, `'a(b)'` → false, message contains the name.
- `rejects values with CR, LF, NUL or non-latin1` — `'a\r\nSet-Cookie: x=1'`,
  `'a\nb'`, `'a\0b'`, `'\u0100'` → false; `'a\x7fb'` → true (undici accepts it).
- `rejects framing and hop-by-hop headers in any case` — `Content-Length`,
  `transfer-encoding`, `Connection`, `Host` → false.
- `rejects every access-control-* header and names the config key` —
  `Access-Control-Allow-Origin`, `access-control-allow-credentials` → false,
  message contains `cors` and `laqi.config.json`.
- `bounds` — 65 headers → false; a 8193-character value → false.

## Finding 5 — invalid config falls open

**Current behaviour.** `loadConfig` (`apps/cli/src/index.ts:44-77`): invalid
JSON → `notice` + `fromFile = {}`; schema failure → `notice` + `ConfigSchema.parse({})`.
Both outcomes read `using defaults · laqi starts anyway`. The same function
feeds `laqi mcp` (`:160-166`) and `laqi migrate` (`:169-174`). `--port abc` is
caught before the merge (`:141-150`), so the remaining triggers are the file's
own content.

**Failure.** `{"cors": ["https://app.example"], "port": "8001"}` starts with
`cors: '*'`. `{"mcp": {"modules": [{"file": "src/types.ts"}]}}` (missing
`exportName`) starts with an empty allowlist — safe by accident — but
`{"cors": [...], "schemaSources": {"root": 5}}` drops the allowlist. The notice
is easy to miss under the start screen.

**Designed behaviour.**

- `loadConfig` **must** return `null` after a `fatal` report when the file is
  not valid JSON or fails `ConfigFileSchema`. `main` **must** set
  `process.exitCode = 5` and return before any listener, watcher or MCP
  transport starts. Outcome line: `nothing was started · exit 5`.
- The fatal report lists every issue as `path: message`, one per line, and
  the remedy `laqi start --help` is not offered (it is not a flag problem);
  instead the evidence names the file.
- For `laqi mcp` the report goes to stderr (stdout is the protocol channel,
  `index.ts:161-164`), then exit 5.
- Terminal-output exit-code table: row 5 becomes
  `bad flag, argument or laqi.config.json` (or a new row 9, open question 3).

```ts
// apps/cli/src/index.ts — illustrative
function loadConfig(root: string): LaqiConfig | null   // file only, fails closed
function applyFlags(config: LaqiConfig, flags: { port?, host?, dir?, file? }): LaqiConfig
```

**File boundary.** NIW2-309 owns `apps/cli/src/index.ts` for lifecycle work.
This change is confined to `loadConfig` (`:44-77`), `stripUndefined` (`:79-81`)
and the call site (`:152-158`); NIW2-309's edits are in `main` below `:195`.
Land this ticket's change first; it is the smaller diff.

**Tests** (`apps/cli/src/index.test.ts`, with `runToExit`):

- `exits 5 for invalid JSON` — write `{ nope`, expect `exitCode === 5`,
  stderr contains `laqi.config.json` and `not valid JSON`, no start screen.
- `exits 5 for a schema failure and does not fall back to cors "*"` — write
  `{"cors":["https://app.example"],"port":"8001"}`, expect exit 5 and stderr
  contains `port`.
- `exits 5 for an unknown key` — `{"cros":["https://app.example"]}`, stderr
  contains `cros`.
- `laqi mcp exits 5 with the report on stderr` — same file, args `['mcp']`,
  stdout empty.
- `packages/schema/src/config.test.ts`: `refuses "*" and "null" inside the cors list`
  and `refuses a cors entry that is not an exact origin` (`https://a.test/`,
  `https://a.test/path`, `a.test`, `''`) → false; `https://a.test`,
  `http://localhost:5173` → true.

## Finding 6 — unknown keys vanish

**Current behaviour.** `ConfigSchema`, `EndpointSchema` (`endpoint.ts:4`),
`ResponseSchema` (`response.ts:8`) and `StateSchema` (`state.ts:3`) are
`z.object`, which strips. `SchemaSnapshotSchema` and the source descriptors are
already `strictObject`, so the package is inconsistent with itself.
`updateEndpointInFile` writes `validated.data` (`writer.ts:225`), as do
`createEndpointInFile` (`:263`) and `createEndpointsInFile` (`:295`): a key the
human added by hand is gone after the panel's next save, with no diagnostic.

**Failure.** `"header": {"X-Trace": "1"}` (singular) is accepted and ignored;
`"delays": 2000` never delays; the `cros` case above. Audit Q2 called the
write-path loss unverified; the three writer lines above verify it.

**Designed behaviour.**

- `ConfigFileSchema`, `EndpointSchema` and `ResponseSchema` **must** be
  `z.strictObject` at every nesting level (`mcp`, `mcp.modules[]`,
  `schemaSources`, `response.headers` is a record and unaffected).
  `ConfigFileSchema` additionally allows `$schema: z.string().optional()`.
  `StateSchema` stays as is: `.laqi/state.json` is machine-written.
- **Config**: an unknown key is one of the fatal issues of Finding 5.
- **Mock files, on load** (`core/src/loader.ts:155-163`): when
  `EndpointSchema.safeParse` fails and **every** issue has
  `code === 'unrecognized_keys'`, the endpoint **must** still be served from
  `validated.data`-equivalent (the strict parse has no data; re-parse with the
  issues' keys removed, or parse once with a `looseObject` twin — implementation
  detail) and a `LoadError` with `kind: 'unknown-key'` **must** be reported:
  `GET /users: unknown key "header" in response "ok" — did you mean "headers"? Edits to this endpoint are refused until it is removed`.
  Any other issue keeps today's behaviour (endpoint pulled).
- **Mock files, on write**: `writer.ts` already parses with `EndpointSchema`;
  with `strictObject` a definition carrying unknown keys is refused with
  `Unrecognized key: "header"` → the panel and MCP get a 400 / `isError`.
  Because the writer validates the **incoming** definition and the panel sends
  what the control plane served (stripped), the refusal reaches a human only
  when the file itself holds the unknown key, which is the case we want loud.
- `index.ts` `report()` (`:499-515`) treats `kind: 'unknown-key'` like
  `lossy-number`: `degraded`, headline `<file> has a key laqi does not know`,
  outcome `served, but edits to this endpoint are refused until the key is fixed`.
  This touches `report()` in NIW2-309's file; it is a two-branch addition.
- Reserved names: a response name or scenario name of `__proto__`,
  `constructor` or `prototype` is refused (Zod 4 drops `__proto__` silently
  today, audit Q10).
- `isDiagnosticCode` (`diagnostics.ts:169`) uses `Object.hasOwn` (audit Q5).

**Why not keep unknown keys as extension data** (loose + round-trip): the
typo case stays silent, and "unknown keys are preserved" becomes a contract
agents will exploit to stash state in mock files. Refuse, with a good message.

**Tests**:

- `packages/schema/src/config.test.ts`: `refuses unknown keys at every level but tolerates $schema`
  — `{cros: []}`, `{schemaSources: {rot: 'src'}}`, `{mcp: {module: []}}`,
  `{mcp: {modules: [{file: 'a.ts', exportName: 'A', sdie: 'x'}]}}` → false;
  `{$schema: 'https://laqi.dev/config.schema.json'}` → true.
- `packages/schema/src/endpoint.test.ts` / `response.test.ts`:
  `refuses a misspelled key instead of dropping it` — `{status: 200, header: {}}`,
  `{default: 'ok', responses: {ok: {status: 200}}, respones: {}}` → false,
  issue code `unrecognized_keys`, `keys` lists the name.
- `packages/core/src/loader.test.ts`: `serves an endpoint with an unknown key and reports it`
  — file with `"delays": 5`, expect the endpoint in `endpoints`, one error with
  `kind: 'unknown-key'`, `line` of the key, message contains `delays`.
  `pulls an endpoint whose issues are not only unknown keys` — `"delays": 5`
  plus `"default": "missing"` → not served, no `kind`.
- `packages/core/src/writer.test.ts`: `refuses to save a definition with an unknown key`
  — `updateEndpointInFile` with `{…, respones: {}}` → `ok: false`, message
  contains `respones`; the file on disk is byte-identical afterwards.
- `packages/schema/src/endpoint.test.ts`: `refuses __proto__, constructor and prototype as response names`.

## Compatibility and release

**Which package is public.** `@laqi/schema` is `private: true`; the public
package is `laqi` (CLI, 2.1.0, standard semver per
[ADR-0010](/decisions/0010-release-and-npm/): `feat!` from 2.x lands on
`3.0.0`). Its public contract is the on-disk formats (`laqi.json`, `laqi/*.json`,
`laqi.config.json`), the control-plane and MCP responses, and exit behaviour.
Every rule above changes what a committed file may contain, so every rule is a
breaking change under semver, regardless of how rarely it bites.

**One major, not six.** All rules ship in a single release train tagged
`3.0.0`. The first `feat!` commit makes release-please open a 3.0.0 PR; it
stays unmerged until every step in the rollout below has landed. Coordinate
with NIW2-312 (release pipeline) so the Trusted Publishing switch does not
land in the same release as a format change — two unrelated reasons for a
release to go wrong should not share a tag.

**Why no warn-then-error phase.** A warning phase makes sense when the user
cannot act on the message or the fix is unclear. Here every refusal names the
file, the line and the fix, and mock-file errors are already non-fatal by
design ([three-writers](/concepts/three-writers/), ADR-0008). The config
rules protect against repository content, where a warning is a notice the
attacker's victim scrolls past. Precedents: TypeScript refuses an unknown
compiler option outright (TS5023); Prettier warns and ignores, which is the
behaviour that produced the `cros` class of bug. See references.

**Why no `laqi migrate` rewrite.** `laqi migrate` converts v1 to v2
(`apps/cli/src/migrate.ts`). None of the new refusals has a mechanical fix
that preserves meaning: 1xx has no replacement, dropping a 204 body changes
the mock, a regex route has no literal form, and an unknown key cannot be
guessed. The honest tool is the error band, which already carries file, line,
excerpt and remedy ([terminal-output](/design/terminal-output/)).

**What existing users see after upgrading.** `laqi start` either starts as
before, or reports: (a) a fatal config error with exit 5, or (b) degraded
per-endpoint errors with the rest served. Both are visible on the first run.
`npx laqi` users on CI get a non-zero exit instead of a server with the wrong
CORS policy.

**CHANGELOG footer** (one `feat!` commit per step, or one squashed commit;
the footer is the user-facing list):

```
BREAKING CHANGE: laqi.config.json must be valid, closed and project-relative;
an invalid config stops laqi (exit 5). Endpoint paths accept literal segments
and whole-segment :params only. Status must be 200-599; 204/205/304 take no
body. Header names must be tokens; framing and Access-Control-* headers are
refused. Unknown keys in config, endpoint and response objects are refused.
```

## Alternatives considered and rejected

- **Reject absolute paths on the flags too** (what the ticket's acceptance
  line reads literally). Strongest argument for it: one rule for one field is
  easier to document and test. Rejected because the flag is typed by the person
  running laqi and an external `--dir` is a tested capability; the threat is
  the file, not the shell.
- **Allow `..` in `schemaSources.root` behind a config key** (`trustOutside`).
  Strongest argument: monorepos. Rejected: approval inside the untrusted file
  is not approval. Reopened by NIW2-310's trust prompt (open question 1).
- **Keep Hono syntax but reject only `{…}`** (narrowest fix for ReDoS).
  Strongest argument: wildcards and optional params are features some users
  may want. Rejected: `?`, `#`, `%` keys are dead endpoints today; `*` and
  `:x?` change id semantics the panel and MCP do not model; and the mock-app's
  own `cors()` and 404 handlers use `*`. A literal grammar is also the only one
  that both Hono routers treat identically (test in Finding 2). Wildcards can
  be added later as an explicit, documented feature with their own ADR.
- **Compile routes with a linear-time matcher** (replace `app.on` with a
  manual table). Strongest argument: it also protects against future Hono
  changes. Rejected: it is a server change (NIW2-309), it duplicates routing,
  and it leaves the dead-endpoint problem.
- **Strip `access-control-*` in `mock-app.ts` instead of refusing in the
  schema.** Strongest argument: the serving layer knows whether a tunnel is up
  and could allow them locally. Rejected: locally the middleware already sets
  them, so a mock value only ever overrides policy; refusing in the schema
  keeps one gate for three writers and stays inside this ticket's files.
  NIW2-309 may still add the strip as defence in depth.
- **Warn and ignore unknown keys** (Prettier model). Rejected above.
- **Preserve unknown keys as extension data.** Rejected above.
- **Pull the endpoint on an unknown key** (uniform strictness). Strongest
  argument: simplest implementation, no `kind`. Rejected: hostile for a typo
  in a working mock; the `lossy-number` precedent shows the serve-but-refuse-
  edits shape already exists and reads well.
- **Spread the rules over two majors or ship as a minor with a flag**
  (`"strict": true`). Rejected: a flag inside the file being validated is the
  `trustOutside` problem again, and users pay per major.
- **New exit code for config.** Open question 3.

## Cross-ticket dependencies and file boundaries

| File                                                 | This ticket                                                             | Other owner                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/schema/src/**`                             | owns                                                                    | NIW2-314 reads `SourceRequestSchema`; no overlap in lines          |
| `apps/cli/src/index.ts`                              | `loadConfig` `:44-81`, call site `:152-158`, two branches in `report()` | NIW2-309 (lifecycle, `main` below `:195`). This ticket lands first |
| `apps/cli/src/index.test.ts`                         | adds config cases                                                       | NIW2-309 adds lifecycle cases; separate `describe` blocks          |
| `packages/core/src/loader.ts`                        | `:155-163` issue classification, `LoadError.kind` union                 | NIW2-313 owns `findKeyLine` `:190-194`. Sequence, do not overlap   |
| `packages/core/src/writer.ts`                        | no change (strictness arrives through `EndpointSchema`)                 | NIW2-313 (locks, write failures)                                   |
| `packages/server/src/mock-app.ts`                    | no change; one new test file case                                       | NIW2-309 (may add `access-control-*` strip)                        |
| `packages/editor/src/components/CreateEndpointRow.*` | test expectation `100` → `200`                                          | NIW2-316 (editor); trivial, coordinate on rebase                   |
| `README.md`, `apps/cli/README.md`, docs `concepts/`  | format and config sections                                              | NIW2-314 agent-facing docs: mention the grammar in one line        |
| NIW2-310                                             | consumes `ProjectRelativePath` for `mcp.modules[].file`; owns trust     |                                                                    |
| NIW2-312                                             | release train for 3.0.0                                                 |                                                                    |

Contradictions with existing ADRs: none. ADR-0003 promised "errors at startup
instead of at runtime" — Findings 3 and 4 deliver it. ADR-0008's "not fatal"
applies to mock files and is preserved (per-endpoint `degraded`); the config
file was never covered by it. ADR-0007 is strengthened by D7.

## Rollout

Small PRs, in this order, each green on its own; the 3.0.0 release PR merges
after step 7.

1. `ProjectRelativePath`, closed `ConfigFileSchema`, `cors` origin rule, tests.
   `feat!(schema)`.
2. Fail-closed `loadConfig`, `applyFlags`, CLI tests, exit-code table row.
   `feat!(cli)`.
3. Endpoint path grammar, tests, the two-router registration test. `feat!(schema)`.
4. `STATUS_MIN = 200`, bodyless statuses, catalogue, editor test. `feat!(schema)`.
5. `HeadersSchema`, tests. `feat!(schema)`.
6. `strictObject` for endpoint and response; loader `unknown-key`
   classification; `report()` branch; writer and loader tests; reserved names;
   `Object.hasOwn`. `feat!(schema, core)`.
7. Docs: README config and format sections, `concepts/` page for the grammar,
   terminal-output exit table, the ADRs below numbered. `docs:`.

## References

- Hono routing syntax: https://hono.dev/docs/api/routing (regexp params
  `:date{[0-9]+}`, optional `:type?`, wildcard `*`); routers:
  https://hono.dev/docs/concepts/routers. Source read:
  `hono@4.12.3/dist/utils/url.js`, `router/reg-exp-router/{node,trie,router}.js`,
  `router/trie-router/node.js`, `router/smart-router/router.js`,
  `middleware/cors/index.js`, `context.js`.
- `@hono/node-server@1.19.17/dist/listener.js` (`responseViaResponseObject`,
  `handleResponseError`).
- Fetch Standard, null body status (101, 103, 204, 205, 304):
  https://fetch.spec.whatwg.org/#null-body-status; `Response` constructor
  throws `RangeError` outside 200–599 and `TypeError` for a body on a null body
  status (verified against undici in Node 24).
- RFC 9110, field names are `token`, `tchar` set, `field-value` /
  `obs-text`: https://www.rfc-editor.org/rfc/rfc9110.html (§5.1, §5.5, §5.6.2).
- OWASP, ReDoS and evil regex `(a+)+$`:
  https://community.owasp.org/attacks/Regular_expression_Denial_of_Service_-_ReDoS
- Vite `server.fs.allow` / `server.fs.deny` / `server.allowedHosts` (a dev
  server bounding what repository config may reach; "we recommend always using
  an explicit list"): https://vite.dev/config/server-options
- webpack-dev-server host check history (1.16.4 release notes; CVE-2025-30360
  advisory on Origin checks): https://github.com/webpack/webpack-dev-server/releases
- VS Code Workspace Trust — repository-local `tasks.json` and settings as a
  code-execution vector: https://code.visualstudio.com/docs/editing/workspaces/workspace-trust
- MSW request matching — `path-to-regexp@6`, "do not include query parameters
  in your request predicate": https://mswjs.io/docs/basics/request-matching
- Mockoon routing — Express/path-to-regexp syntax, no validation documented:
  https://mockoon.com/docs/latest/api-endpoints/routing/
- Zod 4 objects (`strictObject`, record key schemas) and `toJSONSchema`
  (`strictObject` → `additionalProperties: false`; refinements unrepresentable):
  https://zod.dev/api, https://zod.dev/json-schema
- TypeScript TS5023 "Unknown compiler option" (refuse-unknown precedent);
  Prettier `[warn] Ignored unknown option` (warn-and-ignore precedent).
- Project: [ADR-0003](/decisions/0003-declarative-json/),
  [ADR-0007](/decisions/0007-public-url/), [ADR-0008](/decisions/0008-multifile-and-names/),
  [ADR-0010](/decisions/0010-release-and-npm/),
  [json-schema-adapters](/design/json-schema-adapters/) (Configuration, Path
  bases and confinement), [three-writers](/concepts/three-writers/),
  [terminal-output](/design/terminal-output/) (severities, exit codes).
- Hub: `general-knowledge/conventions/adr-pattern.md` (when an ADR is
  warranted), `conventions/design-workflow.md` (spec shape),
  `conventions/schemas-first.md` (Zod 4 conventions).
- Audit: `workspace-temp/audits/schema.md` (Q1–Q11, P1–P3, S1–S7),
  `SUMMARY.md` items 2 and 11. Partial patch
  `partial-fixes/fix-schema-validation.patch` was read; its grammar and
  header rules are close to this spec; its case-insensitive reserved-prefix
  check and its pull-the-endpoint strictness for mock files are not adopted.
