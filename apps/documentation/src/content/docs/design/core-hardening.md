---
title: Core hardening — design spec
---

# Core hardening — design spec

**Status:** proposed, not implemented
**Date:** 2026-10-12
**Ticket:** [NIW2-313](https://linear.app/niway/issue/NIW2-313) — Fix file-read leaks, state caching and file locking in `@laqi/core` (audit umbrella NIW2-302)
**Scope:** `packages/core` (loader, json-position, refresh-source, writer's `resolveSourcePath`, state-store, atomic-file, project), plus the mechanical call-site changes the type checker forces in `apps/cli/src/serve.ts`, `packages/server/src/control-plane-app.ts` and `packages/mcp/src/server.ts`.

Normative statements use **must** / **must not**. Code blocks marked _illustrative_ show intent, not final declarations. Every `file:line` below was re-located on the read-only export of `origin/main` taken on 2026-10-12; the audit was written against an older branch and is cited only as "audit S1" and so on. Anything not checked in code is marked **unverified**.

## One-minute summary

`@laqi/core` is the file layer every laqi process shares: the CLI server (`laqi`), the MCP server (`laqi mcp`) and the panel all go through it. Three things are wrong with it today and all three are confirmed on `main`:

1. **Content from outside the mocks folder can reach the panel, `/api/status` and MCP tool results.** The loader follows a symlinked `*.json` and, when the target is not JSON, puts its first lines in a `LoadError.excerpt` (`loader.ts:92-111`, `json-position.ts:27-42`). `refreshRequestFor` reads any file under `schemaSources.root` (default `.`, the whole project) and forwards V8's parse message, which quotes the first bytes of the file (`refresh-source.ts:53-64`; verified on Node 24: `Unexpected token 'A', "API_KEY=se"... is not valid JSON`). `resolveSourcePath` checks the real path but returns the lexical one (`writer.ts:110-114`), so what is read or imported is re-resolved at use time.
2. **State is read, parsed and Zod-validated from disk on every mock request** (`state-store.ts:20-29`, called from `mock-app.ts:35` through `serve.ts:137,150,157`), including the tunnel-facing app.
3. **The cross-process lock has a reclaim race, blocks the event loop while waiting, swallows write failures and leaks a descriptor** (`atomic-file.ts:90-93`, `:167-170`, `state-store.ts:42-49`, `:82-87`). `Project.setResponse`/`setScenario`/`deleteEndpoint` do read-modify-write _outside_ the lock (`project.ts:385-390`, `:407-414`, `:432-434`), so the lock does not protect the one case it was written for: the panel and `laqi mcp` flipping state at the same time.

Also in scope: `findKeyLine` is O(keys × file size) per reload (`loader.ts:147`, `:190-194`), and excerpts are unbounded (a one-line minified file leaks its entire line into every error channel).

### Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                     | ADR                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| D1  | The loader **never follows a symlink** found inside the mocks area (file or directory); it reports it by name with no excerpt. The `--dir`/`--file` path itself may still be a symlink.                                                                                                                                                  | Closes the exfiltration path from a cloned repo with zero disk-content exposure; a "follow if it resolves inside" rule keeps a check-then-read window and adds code for a layout laqi never promised.                   | creates [ADR — mocks are never read through symlinks](/decisions/0021-loader-symlinks/) |
| D2  | Excerpts are built only from files that passed D1 and are regular files; excerpt lines are clipped to 200 characters; mock files over 10 MB are refused by size before being read.                                                                                                                                                       | The excerpt is the leak channel; bounding it bounds every consumer (panel, `/api/status`, SSE, MCP).                                                                                                                    | none (spec)                                                                             |
| D3  | `resolveSourcePath` **returns the real path**, requires the target to exist and be a regular file, refuses hidden segments (`.env`, `.git`, …) and `node_modules` under any source root, and takes an optional extension allowlist. `refreshRequestFor` passes `['.json']`.                                                              | Fixes the TOCTOU (check real, use lexical) and gives the default `schemaSources.root: "."` a deny list like Vite's `server.fs.deny`, without changing the config default, which NIW2-315 owns.                          | none (spec); reuses the adapters spec's confinement rules                               |
| D4  | Error text for a failed source read **must not** contain anything derived from the file's bytes. ENOENT, EACCES and "not valid JSON" are reported as fixed phrases.                                                                                                                                                                      | V8 and JSC both quote the input in `JSON.parse` messages (verified, see §3).                                                                                                                                            | none (spec)                                                                             |
| D5  | `StateStore` serves state from memory and revalidates with one `stat` per read (fingerprint `ino:size:mtimeMs`), writes through its own writes, and exposes `invalidate()`. No `fs.watch`.                                                                                                                                               | Removes read+parse+validate from the hot path while staying correct with another process writing the same file; `fs.watch` cannot be trusted alone (inode and platform caveats) and would still need the stat fallback. | none (spec)                                                                             |
| D6  | Keep the `O_EXCL` sidecar lock, no new dependency. Owner token `pid:host:random`; **async wait** with `setTimeout` polling; reclaim and release both run under a short-lived `.reclaim` guard and re-check the lock's identity (content + inode + mtime) before removing; `work()` stays synchronous; its throws become `{ ok: false }`. | Fixes the two-contender reclaim race and the 5 s event-loop stall without `proper-lockfile`, whose 5 s minimum stale window and `rmdir`-then-`mkdir` reclaim do not improve on ours.                                    | creates [ADR — cross-process file lock](/decisions/0020-file-lock/)                     |
| D7  | State and mock write failures **surface**: `StateStore.write/update` return a result, `Project` mutators return `code: 'unavailable'`, the control plane answers **503**, MCP returns `isError`. `Project` does its read-modify-write of state **inside** the lock via `update()`.                                                       | A flip that did not persist must not be reported as done; the lock is pointless if callers read before taking it.                                                                                                       | none (spec)                                                                             |
| D8  | Every function that takes the lock becomes `async` (`withFileLock`, the writer's `*InFile` functions, `StateStore.write/update`, `Project` mutators). Reads stay synchronous.                                                                                                                                                            | A synchronous function cannot wait without blocking. Reads never take the lock, so `getState()` on the hot path stays sync.                                                                                             | none (spec) — consequence of D6                                                         |
| D9  | `findKeyLine` is replaced by a single-pass scan that maps every top-level key to its line.                                                                                                                                                                                                                                               | O(file) per reload instead of O(keys × file); the scan is also correct where `indexOf` was a heuristic.                                                                                                                 | none (spec)                                                                             |

### Open questions for the owner

1. **D1 strictness.** "Never follow" breaks nobody today for directories (a symlinked subfolder is already skipped, because `Dirent.isDirectory()` is false for links) but does change file symlinks inside `laqi/`, which currently load. Do you know of any user layout that symlinks individual mock files? If yes, the alternative is "follow only when the real path stays inside the real mocks root" (see Alternatives); it costs about 20 lines and keeps a small check-then-read window.
2. **D3 deny list vs. narrowing the default root.** NIW2-315 owns `schemaSources.root`. This spec keeps `"."` and adds a deny list. Do you want NIW2-315 to also narrow the default (for example to `src`)? That is a breaking change for stored snapshots whose `source.file` is relative to `.`; the deny list is not.
3. **Lock timeout on the server process.** With the wait now async, a 5 s `LOCK_TIMEOUT_MS` no longer freezes requests, so the timeout can stay. Do you want a shorter timeout for the control plane (panel click) than for MCP (agent call)? Default here: one value, 5 s, unchanged.
4. **Panel freshness after an MCP flip.** With D5 the server notices the new state on the next request, but the panel is not told (there is no `state-changed` event; `events.ts:1-25`). Emitting one from `serve.ts` when the fingerprint changes is cheap but belongs to NIW2-309/316. Should this ticket add the event type to `events.ts` so those tickets can use it?
5. **`ProjectFailure` extension.** D7 adds `'unavailable'` to `ProjectFailure` and `WriteFailure`. The server's `STATUS` map (`control-plane-app.ts:26-30`) is NIW2-309's file. Is it acceptable for this ticket to add the one line (`unavailable: 503`) there, or should NIW2-309 own it and this ticket ship with core returning the code unmapped?

### Out of scope

- The control plane's `PUT /api/state` replaces the whole state (`control-plane-app.ts:335-427`). A panel tab holding an old state can erase an override `laqi mcp` wrote in between. That is a transport contract (NIW2-309), not a core lock problem; core's `update()` makes it possible to fix later with a patch-style endpoint.
- Module approval tokens built from `Math.random` (`module-permission.ts:80-82`, audit S4), the allowlist normalisation (S5), the pending-map growth (P5) and binding the executed bytes to the confirmed digest (S3's second half) belong to NIW2-310. This spec only changes what `resolveSourcePath` returns to them.
- `__proto__` as a response name in the writer (audit Q4), silent merge of duplicate `scenarios.json` files (Q8), one full reload per `Project` call (P4), `formatJson` double serialisation (P7). Not security, not in the ticket.
- The default value of `schemaSources.root` and any config grammar (NIW2-315).
- Host/Origin checks, CSRF, SSE and anything in `packages/server` beyond the mechanical changes D7/D8 force (NIW2-309).
- A watcher for `.laqi/state.json` or a `state-changed` SSE event (see open question 4).

---

## 1. Loader: symlinks and excerpts (audit S1, P6)

### Current behaviour on `main`

- `loader.ts:54-60`: `existsSync` + `statSync` follow symlinks, for both the folder and the single file. A `laqi.json` that is a symlink is read through.
- `loader.ts:66-80`: the walk skips dotfiles (`:72`) and only recurses into entries where `entry.isDirectory()` is true (`:75`), which is false for a symlinked directory, so those are already skipped — silently. A symlinked _file_ whose name ends in `.json` is pushed (`:76`) and read (`:92`).
- `loader.ts:101-111`: when `JSON.parse` fails, `parseJsonWithPosition` builds an excerpt of up to four source lines around the failure (`json-position.ts:27-42`) and the loader stores it in `LoadError.excerpt`. Lossy-number reports also carry an excerpt (`:126`).
- Consumers of `LoadError` verbatim: `/api/status` (`serve.ts:172`), the panel error banner (json-position.ts comment, line 25), the MCP `list_endpoints` result (`mcp/server.ts:108`, through `reply`, `:31-36`).
- No size cap anywhere: `readFileSync` of whatever is there, `source.split('\n')` of the whole file for every excerpt.

### Threat

A cloned repository (or a dependency's postinstall, or any process that can write in the project) ships `laqi/leak.json -> ~/.aws/credentials`. The developer runs `npx laqi`. The INI file fails to parse at line 1, and lines 1-2 (`[default]`, `aws_access_key_id = AKIA…`) are now in `/api/status`, in the panel and in the next `list_endpoints` an agent calls. The agent is the exfiltration channel: a prompt-injected agent can be told to "report the errors". The same holds for `.env` style targets and for `--file laqi.json -> .env` in file mode. A valid-JSON target (`~/.config/**/*.json`) is loaded as endpoints and its top-level keys appear in per-key error messages (`loader.ts:151,160`).

CWE-59 ("Improper Link Resolution Before File Access") names exactly this class; its mitigation is to not follow links out of the trusted compartment.

### Designed behaviour

**L1.** When walking the mocks folder, the loader **must** classify every entry with `lstat` semantics (`Dirent.isSymbolicLink()`, which `readdirSync(..., { withFileTypes: true })` already provides). A symbolic link **must not** be read or recursed into, whatever it points at. It **must** be reported as a `LoadError` with `kind: 'symlink'`, the link's display path, and a fixed message: `symbolic links are not loaded — copy the file into the mocks folder instead`. No `excerpt`, no `line`, no target path.

**L2.** In file mode, if the configured file (`join(root, file)`) is itself a symbolic link, the loader **must** return `source: 'file'` with no endpoints and the same `kind: 'symlink'` error. This closes `laqi.json -> .env`. (Today's `--dir` pointing at a symlinked folder keeps working: the user chose that path, and the writer explicitly supports "a mocks directory reached through a symlink", `writer.test.ts:206-327`.)

**L3.** Before reading, the loader **must** `statSync` the path (which now cannot be a link) and refuse anything that is not a regular file, and any regular file larger than `MAX_MOCK_FILE_BYTES = 10 * 1024 * 1024`, with a fixed message carrying the size and the limit. The size check happens before `readFileSync`.

**L4.** `buildExcerpt` **must** clip each rendered line to `MAX_EXCERPT_LINE = 200` characters (an ellipsis marks the cut) and clamp the caret column to the same bound. It **must** keep producing exactly the `N | text` / caret layout the panel consumes.

**L5.** The error for a file that cannot be read (`loader.ts:93-99`) **must** keep the OS error text (`ENOENT: no such file or directory, open '…'`): it names a path inside the mocks area and never content. The C2 test (`loader.test.ts:142-157`) uses a _dangling symlink_ to simulate "deleted between scan and read"; under L1 that case becomes a `symlink` error. The test must be rewritten to delete a regular file between scan and read (inject the file list, or `vi.spyOn(fs, 'readFileSync')`), so it keeps testing what its title says.

**L6.** Dotfile skipping (`:72`) is unchanged; a dot-prefixed symlink is skipped silently like any dotfile.

### Interfaces (illustrative)

```ts
// packages/core/src/loader.ts — illustrative
export type LoadError = {
  kind?: 'lossy-number' | 'symlink' | 'too-large'
  file: string
  line?: number
  col?: number
  message: string
  excerpt?: string
}

export const MAX_MOCK_FILE_BYTES = 10 * 1024 * 1024
```

`kind` is optional and additive. The panel and MCP ignore unknown kinds today (they print `message`), so no consumer change is required. The CLI's boot report counts them as failed files, which is the intended "noisy, not fatal" behaviour from [three writers](/concepts/three-writers/).

### Migration and breaking changes

- A project that relied on a symlinked `*.json` inside `laqi/` stops serving those endpoints and sees one error per link. The message says what to do. This is a documented, deliberate change (ADR); it goes in the changelog under "security".
- A `--file` that is a symlink stops loading. Same message.
- Files over 10 MB stop loading. **Unverified:** no known user has one; the limit is ten times the adapters spec's `MAX_SOURCE_LENGTH`-style budgets and is a constant, so it can be raised.

### Tests (`packages/core/src/loader.test.ts`, new `json-position.test.ts` cases)

| Test name                                                                                             | Setup                                                                                                                     | Expected                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skips a symlinked .json inside the mocks folder and reports it by name only`                         | `laqi/api.json` valid; `laqi/leak.json -> <tmp>/creds.ini` where the INI contains `aws_secret_access_key = SECRET-MARKER` | `endpoints` = `['GET /users']`; one error with `kind: 'symlink'`, `file` containing `leak.json`, no `excerpt`; `JSON.stringify(result)` does **not** contain `SECRET-MARKER` nor the target path |
| `skips a symlinked .json even when its target is valid JSON inside the project`                       | `laqi/alias.json -> ../shared.json` (valid endpoint file)                                                                 | endpoints from `shared.json` are **not** loaded; one `symlink` error                                                                                                                             |
| `refuses a symlinked single file in file mode`                                                        | no `laqi/`; `laqi.json -> <tmp>/.env` containing `API_KEY=SECRET-MARKER`                                                  | `source: 'file'`, `endpoints: []`, one `symlink` error; serialized result lacks `SECRET-MARKER`                                                                                                  |
| `still loads a mocks folder that is itself a symlink`                                                 | `laqi -> <tmp>/real-mocks` with `api.json` inside                                                                         | endpoints load; no error (parity with the writer)                                                                                                                                                |
| `refuses a file over the size limit before reading it`                                                | `laqi/huge.json` of `MAX_MOCK_FILE_BYTES + 1` bytes; spy on `readFileSync`                                                | one `too-large` error naming the size; `readFileSync` not called for that path                                                                                                                   |
| `reports a per-file error … (C2)` (rewritten)                                                         | regular file removed between scan and read via a spy that unlinks on first `readFileSync`                                 | unchanged assertions: one error, `could not read file`                                                                                                                                           |
| `clips excerpt lines to 200 characters and keeps the caret inside the clip` (`json-position.test.ts`) | a 5,000-character single-line invalid JSON with the error at column 3,000                                                 | each excerpt line ≤ 201 chars (200 + ellipsis); caret line length ≤ 203                                                                                                                          |
| `keeps short excerpts byte-for-byte`                                                                  | existing excerpt fixtures                                                                                                 | unchanged output (golden)                                                                                                                                                                        |

---

## 2. `resolveSourcePath`: real path, existence, deny list (audit S2, S3)

### Current behaviour on `main`

- `writer.ts:103-119`: `resolveSourcePath` resolves `base = resolve(root, sourceRoot)` and `target = resolve(base, file)`, compares `realish(target)` against `realish(base)`, and on success returns **`target`** (`:114`), the lexical path. `realish` (`:65-87`) is correct for the check; the bug is only what is returned.
- Three callers use the returned path for a read or an import: `refresh-source.ts:53-58` (`readFileSync(resolved.path)`), `generate/import-schema.ts:315-331` (`loadModuleSchema({ resolvedPath: resolved.path })`, the child-process import), `module-permission.ts:68-85` (`digestOf(resolved.path)`, and stores it as `resolvedPath` shown to the person at confirm time; `:122` re-digests it).
- `packages/schema/src/config.ts:21`: `schemaSources.root` defaults to `'.'`. The adapters spec (§"Path bases and confinement") chose this so `src/types/api.ts` is reachable; it says nothing about hidden files.
- The existing test `does not require the file to exist yet` (`writer-response.test.ts:254-258`) pins the current "may not exist" behaviour.

### Threat

1. **TOCTOU (CWE-367 class).** The check resolves symlinks; the use re-resolves them. A link created or swapped between the two makes the read or import land outside the source root. For `module-permission`, the digest is taken on the lexical path and the import later happens on the same lexical path in another process, so the window is real even without an attacker racing: a `postinstall` or a watcher-driven codegen that rewrites `src/types` through a symlink is enough to make "what you approved" and "what runs" differ. The second half (binding the executed bytes to the digest) is NIW2-310's.
2. **Default root is the project.** With `.`, an MCP agent can ask `refresh_response_schema`/`refreshResponseSchema` to re-read a snapshot whose `source.file` it controls (it wrote the response through `update_endpoint`), pointed at `.env`, `.git/config`, `node_modules/x/package.json`. For a JSON target the document is stored as `schema` in the mock file (and returned). For non-JSON the parse message leaks the first bytes (§3).

Vite ships the same shape of control for its dev server: `server.fs.allow` is the root, and `server.fs.deny` defaults to `['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**']` and "takes priority over `server.fs.allow`". The deny list here is the same idea, phrased by path segment instead of glob so it cannot be bypassed by spelling.

### Designed behaviour

**R1.** `resolveSourcePath` **must** return the **canonical real path** (`realpathSync`) of the target and callers **must** use only that path for every subsequent `stat`, read, digest or import. The lexical path may be kept for display of what the caller typed (`PreparedModule.file` already does this).

**R2.** The target **must exist** and **must** be a regular file. A missing path is `{ ok: false, reason: 'missing' }`; a directory, FIFO or socket is `{ ok: false, reason: 'not-a-file' }`. The old "does not require the file to exist" test is deleted: every caller reads or imports, so a non-existent target was always a failure one step later, with a worse message.

**R3.** After the containment check, the path **relative to the real source root** **must not** contain a segment that starts with `.` or equals `node_modules`. The refusal message names the rule, not the target: `refusing to read "<file as typed>": hidden files and node_modules are never schema sources`. This applies whatever `schemaSources.root` is; a user who sets `root: ".config"` still cannot read `.git` under it, but can read non-hidden files under `.config` (the rule is on the path _below_ the root).

**R4.** `resolveSourcePath` accepts an optional `extensions: readonly string[]` (lowercase, with dot). When given, `extname(real).toLowerCase()` **must** be in it, else `{ ok: false, reason: 'extension' }`. `refreshRequestFor` **must** pass `['.json']`. The adapters' `project-module` path (NIW2-310/311) may pass `['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']`; this spec does not decide that.

**R5.** `resolveInside` (writes, `writer.ts:34-52`) is **unchanged**: it must keep accepting a not-yet-existing tail, and the write path never follows a link (it renames over it).

### Interfaces (illustrative)

```ts
// packages/core/src/writer.ts — illustrative
export type SourceRefusal = 'outside' | 'denied' | 'missing' | 'not-a-file' | 'extension'

export function resolveSourcePath(params: {
  root: string
  sourceRoot: string
  file: string
  /** Lowercase extensions with the dot. Any extension when omitted. */
  extensions?: readonly string[]
}): { ok: true; path: string } | { ok: false; error: string; reason: SourceRefusal }
```

`reason` lets `module-permission.prepare` keep returning `code: 'not-found'` for `missing` and `'invalid'` for the rest, and lets `refreshRequestFor` do the same.

### Migration and breaking changes

- `resolved.path` is now canonical. On macOS `tmpdir()` tests, that means `/private/var/...` instead of `/var/...`; test fixtures that compare paths **must** compare against `realpathSync(expected)` (the writer tests already do this for the symlinked-root cases).
- A stored snapshot whose `source.file` points at a hidden path or into `node_modules` can no longer be refreshed. It can still be re-imported from a paste or a non-hidden file. **Unverified:** no example project or docs page uses such a path; `examples/` was not grepped for `node_modules` sources.
- `PreparedModule.resolvedPath` shown at confirm time becomes the real path. The code comment at `module-permission.ts:15-22` asks for exactly that.

### Tests (`packages/core/src/writer-response.test.ts` "resolving a schema source", plus a new `refresh-source.test.ts`)

| Test name                                                                 | Setup                                                                      | Expected                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `returns the real path, not the typed one`                                | `src/types/api.ts` reached through `src/alias -> types`                    | `path === realpathSync(join(root, 'src/types/api.ts'))`               |
| `refuses a symlink that escapes the source root` (kept)                   | `src/out -> tmpdir()`                                                      | `reason: 'outside'`                                                   |
| `refuses a traversal out of the source root` (kept)                       | `sourceRoot: 'src'`, `file: '../../secrets.json'`                          | `reason: 'outside'`, error contains `outside`                         |
| `refuses a missing file instead of handing back a path`                   | `file: 'nope.ts'`                                                          | `reason: 'missing'`; error does not contain `nope.ts`'s absolute path |
| `refuses a directory`                                                     | `file: 'src'`                                                              | `reason: 'not-a-file'`                                                |
| `refuses hidden files under any root`                                     | `.env` at root, `sourceRoot: '.'`                                          | `reason: 'denied'`                                                    |
| `refuses .git and node_modules even when the root is the project`         | `.git/config`, `node_modules/x/package.json`                               | `reason: 'denied'` both                                               |
| `refuses a hidden segment under a hidden root only below the root`        | `sourceRoot: '.config'`, files `.config/a.json` and `.config/.secret.json` | first ok, second `denied`                                             |
| `refuses an extension outside the allowlist`                              | `extensions: ['.json']`, `file: 'src/types/api.ts'`                        | `reason: 'extension'`                                                 |
| `accepts a source under the source root, outside the mocks folder` (kept) | `src/types/api.ts` exists                                                  | ok                                                                    |

---

## 3. `refreshRequestFor`: no file bytes in errors (audit S2)

### Current behaviour on `main`

`refresh-source.ts:56-64`: `JSON.parse(readFileSync(resolved.path, 'utf8'))` in one `try`; the `catch` forwards `cause.message`. Verified on this machine:

- Node 24.21: `JSON.parse("API_KEY=secret123\nDB_PASS=hunter2")` → `Unexpected token 'A', "API_KEY=se"... is not valid JSON`; an AWS credentials file → `Unexpected token 'd', "[default]\na"... is not valid JSON`.
- Bun 1.4.2 (dev only): `JSON Parse error: Unexpected identifier "API_KEY"`.

Both quote input. The published CLI runs on Node (`json-position.ts:44-48`), so production leaks 10 bytes per attempt; an agent can only move the failure position by changing the file, which it cannot, so this is a bounded but real oracle for the first bytes of any readable file under the root. The error travels through the control plane (`serve.ts:506-515`) and MCP (`mcp/server.ts:644-650`).

### Designed behaviour

**F1.** `refreshRequestFor` **must** call `resolveSourcePath` with `extensions: ['.json']` (R4) and read `resolved.path` (R1).

**F2.** Read and parse **must** be separate `try` blocks. A read failure **must** map by `errno` to a fixed phrase: `ENOENT` → `could not read <file as typed>: the file does not exist`; `EACCES`/`EPERM` → `…: permission denied`; anything else → `…: it is not readable`. A parse failure **must** produce `could not read <file as typed>: it is not valid JSON` — **no** `cause.message`, no position, no excerpt. (`json-position.ts`'s excerpt machinery is for files inside the mocks area, where content is already the user's own; it **must not** be used here.)

**F3.** The parsed document is handed to `importSchema` unchanged. Budgets on document size and nesting are the adapters' (`MAX_SOURCE_LENGTH`, `MAX_SHAPE_DEPTH`); this spec adds a `statSync(...).size > MAX_SOURCE_LENGTH` pre-check **unverified** against where `MAX_SOURCE_LENGTH` is exported from (`@laqi/generate` or `@laqi/schema`); if it lives in `@laqi/generate`, core cannot import it (dependency direction) and the pre-check is dropped in favour of the adapters' own budget.

### Tests (new `packages/core/src/refresh-source.test.ts`; the audit notes the file has no tests today)

| Test name                                                   | Setup                                                                   | Expected                                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `re-reads a json-schema snapshot from its file`             | snapshot with `source: { kind: 'json-schema', file: 'schemas/a.json' }` | `ok`, `value.document` equals the file's JSON                                                                                        |
| `does not quote the file when it is not JSON`               | `schemas/not.json` containing `API_KEY=SECRET-MARKER`                   | `ok: false`; `error === 'could not read schemas/not.json: it is not valid JSON'`; error lacks `SECRET-MARKER` and `Unexpected token` |
| `refuses a non-.json source even if it parses`              | `schemas/a.txt` containing `{}`                                         | `ok: false`, error mentions `.json`                                                                                                  |
| `refuses hidden and dependency paths`                       | `.env`, `node_modules/p/package.json`                                   | `ok: false`, error contains `never schema sources`; no file content                                                                  |
| `says a missing file is missing, without the absolute path` | `schemas/gone.json`                                                     | error `could not read schemas/gone.json: the file does not exist`                                                                    |
| `keeps the paste and project-module answers`                | `typescript-paste`, `project-module` snapshots                          | unchanged messages (existing strings at `refresh-source.ts:29-43`)                                                                   |

---

## 4. `StateStore`: state from memory with invalidation (audit P1)

### Current behaviour on `main`

- `state-store.ts:20-29`: `read()` does `existsSync`, `readFileSync`, `JSON.parse`, `StateSchema.safeParse` — on every call.
- Called per mock request: `mock-app.ts:35` via `getState: () => store.read()` (`serve.ts:137` public app, `:150` local app, `:157` control plane). `Project.listEndpoints/getState` also call it (`project.ts:145,156`).
- Writers of the same file: this process's control plane (`serve.ts:160-163`) and `Project` in this process, **and** `Project` in the separate `laqi mcp` process (`mcp/server.ts:56`; `index.ts:160-166` shows it is a different process). The chokidar watcher deliberately ignores `.laqi/` (`watcher.ts:39-41`), so nothing in the server process is told when MCP writes.

### Failure scenario

At a few hundred requests per second each request pays a disk read and a Zod parse on the event loop; on a slow or network-mounted project directory, tail latency follows the disk. The tunnel-facing app pays it too, so a public URL under load multiplies it.

### Designed behaviour

**S1.** `StateStore` **must** keep `cache: { fingerprint, state } | null`. `read()` **must** `statSync` the file; if `stat` fails (ENOENT) it **must** drop the cache and return `DEFAULT_STATE`. Otherwise the fingerprint is `${ino}:${size}:${mtimeMs}`; if it equals the cached one, return the cached `state`; else read, parse, validate (today's logic, `:23-28`), cache, return.

**S2.** `read()` **must** return the same object identity between two reads with no change on disk (so callers can compare cheaply) and callers **must not** mutate it. `Project` already copies (`{ ...state, overrides }`); the control plane's `liveState` builds new objects. **Unverified:** no consumer mutates the returned state in place; the implementer greps for `.overrides[` assignments on a `getState()` result.

**S3.** `write()` and `update()` **must** `invalidate()` after a successful atomic rename (the rename changes the inode, so the next `read()` reloads from disk; predicting the fingerprint is not worth the risk of a stale cache). `invalidate()` is public so a future watcher (open question 4) can call it.

**S4.** `update()` **must** `invalidate()` _before_ calling `change(this.read())` inside the lock, so the transform always sees what another process wrote while this one was waiting.

**S5.** Why one `stat` per read is acceptable, and the bound on staleness: the fingerprint is read on the request path, so another process's write is visible on the very next request. A coarse-mtime filesystem (FAT, 2 s; HFS+, 1 s) plus an immediately recycled inode plus an identical size would defeat the fingerprint; the atomic write always creates a new inode, so this needs inode reuse inside the same mtime tick with the same byte length. Accepted; noted in the code.

### Interfaces (illustrative)

```ts
// packages/core/src/state-store.ts — illustrative
export type StateWriteResult = { ok: true } | { ok: false; error: string }

export class StateStore {
  readonly path: string
  read(): LaqiState                                   // sync, cached, revalidated by stat
  invalidate(): void
  write(state: LaqiState): Promise<StateWriteResult>
  update(change: (current: LaqiState) => LaqiState): Promise<LockOutcome<LaqiState>>
}
```

### Migration

`read()` keeps its signature. `write()`/`update()` become async and return results (D7/D8); the only non-test consumers are `Project` and `serve.ts:161`.

### Tests (`packages/core/src/state-store.test.ts`)

| Test name                                                | Setup                                                                                                                                                                                 | Expected                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `serves a cached state without re-reading the file`      | write, read, `vi.spyOn(fs, 'readFileSync')`, read ×100                                                                                                                                | spy called 0 times; results `toBe` the same object |
| `notices a write made by another store on the same file` | store A reads; store B (new instance, same root) writes a different state                                                                                                             | A's next `read()` returns B's state                |
| `notices a file replaced by hand`                        | write `state.json` directly with `writeFileSync` (new content, then `utimesSync` to the same mtime as before, size differs)                                                           | next read reflects it                              |
| `notices a same-size replacement in a later mtime tick`  | overwrite with same byte length after advancing mtime via `utimesSync`                                                                                                                | reflects it                                        |
| `drops the cache when the file is removed`               | read, `rmSync(state.json)`                                                                                                                                                            | read returns `DEFAULT_STATE`                       |
| `invalidate forces a re-read`                            | read, external write with identical fingerprint forged via `utimesSync` and same size (document as the known blind spot), `invalidate()`                                              | read reflects the external write                   |
| `update sees a concurrent write from another process`    | store B writes while A's lock is held (A's `change` writes through B in the callback via a second process is overkill; simulate: B writes before A calls `update`, A's cache is warm) | A's `change` receives B's state                    |
| existing six tests                                       | unchanged inputs, `await` on writes                                                                                                                                                   | unchanged expectations                             |

---

## 5. `withFileLock`: race-free, non-blocking, failure-surfacing (audit Q1, Q2, Q3, Q5, Q6, P3)

### Current behaviour on `main`

- `atomic-file.ts:79-103`: loop: `openSync(lockPath, 'wx')` (`O_CREAT|O_EXCL`), write pid (`:84`); on `EEXIST`, `isAbandoned` (`:123-135`) decides by pid liveness (`process.kill(pid, 0)`) with age as the fallback only when the pid is unreadable; abandoned → `rmSync` and retry (`:90-93`); else wait `5 ms` with `Atomics.wait` on the main thread (`:167-170`) until `LOCK_TIMEOUT_MS = 5_000` (`:23`).
- `:105-110`: `work()` runs; `finally` closes the fd and removes the lock unconditionally.
- `:82-87`: if `writeFileSync(handle, pid)` throws, the fd stays open and the lock file stays, with no pid.
- `state-store.ts:42-49`: `write()` ignores the outcome (deliberately, per the comment). `update()` (`:58-67`) returns the pre-lock state when the lock fails and is not used by any non-test code.
- `writer.ts:169-175`: `locked()` adapts lock failures but a throw from `work()` (EACCES, ENOSPC, EISDIR, a `RangeError` from `formatJson`) propagates out of `Project` as a raw exception.
- `project.ts:385-390`, `:407-414`, `:432-434`, `:444-449`: read state, compute, `store.write(next)` — the read is outside the lock.

### Failure scenarios

1. **Two writers in the critical section.** Processes B and C both see A's lock with a dead pid. C removes it and acquires. B removes _C's_ lock and acquires. Both run `work()`; whichever renames last wins and the other's write is lost. Needs a crash plus two contenders, but the contenders are exactly the configuration laqi documents: `laqi` + `laqi mcp`.
2. **Server freeze.** While `laqi mcp` holds the lock for a large `import_openapi` write, every control-plane write in the server blocks the whole process — mock requests, SSE, panel — for up to 5 s, in 5 ms `Atomics.wait` slices.
3. **Lost flip reported as success.** Lock timeout or `ENOSPC` → `write()` returns `void` → control plane answers `200 {state}` (`control-plane-app.ts:426-427`) → the panel shows the flip, the server keeps serving the old response.
4. **Same-process contention after D8.** Once waiting is async, two `withFileLock` calls in the same process can overlap (panel click while an MCP-triggered... no: different processes; but two panel requests, or `createEndpoint` and `setResponse` from the server's own handlers). The old "owner pid === mine ⇒ abandoned" rule (`:132`) would then make the second caller delete the first caller's live lock.
5. **Descriptor leak** (`:82-87`) and **foreign pid** (`:116-121` comment contradicts behaviour: a readable pid from another host or pid namespace is judged dead and stolen at once, and a recycled pid is "alive" forever).

### Designed behaviour

**K1 — primitive.** Keep the sidecar `<file>.lock` created with `O_CREAT|O_EXCL` (`'wx'`). No new dependency. (`O_EXCL` is unreliable on NFSv2; laqi's project directory is local by assumption, the same assumption chokidar already makes. Documented, not mitigated.)

**K2 — owner token.** The lock content **must** be `${pid}:${hostname()}:${randomBytes(8).toString('hex')}`. The fd **must** be closed right after the token is written, before `work()`. If writing the token throws, the fd **must** be closed and the lock file removed before the error is returned (fixes Q5).

**K3 — wait.** Waiting **must** be `await new Promise(r => setTimeout(r, LOCK_POLL_MS))` with `LOCK_POLL_MS = 10`. `LOCK_TIMEOUT_MS` stays `5_000`, `LOCK_STALE_MS` stays `2_000`. `Atomics.wait` and `SharedArrayBuffer` are removed from the package.

**K4 — judging abandonment.** Given a snapshot `{ raw, ino, mtimeMs }` of the lock file:

- unparsable `raw` → abandoned iff older than `LOCK_STALE_MS` (unchanged fallback);
- `raw` in this process's `heldTokens` set → **alive** (another call in this process holds it; wait);
- host ≠ `hostname()` → judged by age only (the pid is not ours to test; fixes Q6);
- host = ours and pid = `process.pid` but token not held → abandoned (left over from a crash between open and release, as today);
- otherwise → abandoned iff `process.kill(pid, 0)` says the process is gone (`ESRCH`; `EPERM` means alive, unchanged).

**K5 — reclaim, serialized and identity-checked.** Removing somebody else's lock **must** happen only while holding a guard file `<file>.lock.reclaim`, created with `'wx'`. Under the guard the lock **must** be re-read; it is removed only if `raw`, `ino` and `mtimeMs` all equal the snapshot that was judged dead. If the guard exists, the waiter does not reclaim this round (it polls again); a guard older than `LOCK_STALE_MS` is swept (a crashed reclaimer). The guard is held for microseconds (one `stat`, one `read`, one `unlink`), so contention on it is negligible.

Why this closes scenario 1: only guard holders remove locks, and a guard holder removes only the exact file it judged dead. For B to delete C's fresh lock, C's lock would have to carry the dead lock's content, inode and mtime — impossible, since C's file is a new inode with a new random token.

**K6 — release, also under the guard.** `finally` **must** take the guard (polling if a reclaimer holds it, bounded by `LOCK_STALE_MS`), re-read the lock and remove it only if `raw === myToken`. Then `heldTokens.delete(myToken)`. This closes the mirror race: a holder that was misjudged dead (recycled pid, other host) would otherwise `rmSync` a reclaimer's new lock on its way out. If the guard cannot be taken in time, the release **must** fall back to the identity-checked remove without the guard and log nothing (an orphan guard is swept by age on the next contention).

**K7 — `work()` stays synchronous.** The critical section is read → modify → format → atomic write; all sync today (`writer.ts:216-226` and siblings). Keeping it sync means no interleaving inside one process once the lock is held, so `heldTokens` is only about _waiters_, never about two holders. A throw from `work()` **must** become `{ ok: false, error: 'write to <path> failed: <os message>' }` (fixes Q3); OS messages contain paths, never file content.

**K8 — outcome contract.** `withFileLock` returns `Promise<LockOutcome<T>>`. Errors are: `could not lock <path>: <os message>` (non-EEXIST open failure), `timed out waiting for the lock on <path>` (deadline), `write to <path> failed: <message>` (K7).

**K9 — `Project` uses the lock for its read-modify-write.** `setResponse`, `setScenario`, `deleteEndpoint`'s override cleanup **must** go through `store.update()` and `resetState` through `store.write()`. Validation of the endpoint/response/scenario name stays _before_ the lock (it needs the loaded mocks, not the state). A failed outcome **must** return `fail(message, 'unavailable')`. `deleteEndpoint` whose file delete succeeded but whose override cleanup failed **must** report `ok: false, code: 'unavailable'` with a message that says the endpoint _was_ deleted; the dangling override is harmless (the resolver ignores unknown ids, `project.ts:158-170`) and is dropped on the next successful state write.

**K10 — control plane and MCP surface the failure.** `ProjectFailure` and `WriteFailure` gain `'unavailable'`; `STATUS` maps it to `503`; `ControlPlaneRuntime.setState` becomes `(state) => Promise<{ ok: true } | { ok: false; error: string }>` and `PUT /api/state` answers `503 { error: 'laqi-control-plane', message }` on failure instead of `200`. `serve.ts:160-163` **must** only `counters.recordFlip()` when the write succeeded. MCP's `reply()` already turns `ok: false` into `isError: true` (`mcp/server.ts:31-36`); the handlers only need `await`.

### Interfaces (illustrative)

```ts
// packages/core/src/atomic-file.ts — illustrative
export const LOCK_TIMEOUT_MS = 5_000
export const LOCK_STALE_MS = 2_000
export const LOCK_POLL_MS = 10

export type LockOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

export function withFileLock<T>(fullPath: string, work: () => T): Promise<LockOutcome<T>>

// packages/core/src/project.ts — illustrative
export type ProjectFailure = 'invalid' | 'conflict' | 'not-found' | 'unavailable'

// packages/server/src/control-plane-app.ts — illustrative, mechanical
export type WriteFailure = 'invalid' | 'conflict' | 'not-found' | 'unavailable'
const STATUS: Record<WriteFailure, 400 | 404 | 409 | 503> = { invalid: 400, conflict: 409, 'not-found': 404, unavailable: 503 }
```

### Migration and breaking changes

- `@laqi/core` is `private: true` (`packages/core/package.json`); the only published package is `laqi` (the bundled CLI). The async signatures are therefore an **internal** break with no npm consumer. Call sites that must gain `await` (mechanical, compiler-enforced): `serve.ts:192,208,215,372,487,526` and `:161`; `mcp/server.ts:126,140,152,173,192,223,236,267,296,589`; the `packages/server` runtime types for `createEndpoint/updateEndpoint/deleteEndpoint/setState/applyGeneratedBody/refreshResponseSchema` become `Promise`-returning (several already are).
- On-disk lock format changes from `<pid>` to `<pid>:<host>:<random>`. A lock left by an older laqi version (bare pid) still parses (host `null`, token unknown) and is judged by pid liveness as before, so a mixed-version overlap during upgrade is safe.
- Panel and MCP users will now _see_ a failed flip (503 / tool error) instead of a silent no-op. That is the point.

### Tests (`packages/core/src/atomic-file.test.ts`, `project.test.ts`, `packages/server/src/control-plane-app.test.ts`)

| Test name                                                                       | Setup                                                                                                                                            | Expected                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runs the work and returns its value` (kept, async)                             |                                                                                                                                                  | `{ ok: true, value: 42 }`                                                                                                                                    |
| `returns a failed outcome when the work throws, and releases the lock`          | `work` throws `boom`                                                                                                                             | `ok: false`, error contains `boom`; no `.lock` left                                                                                                          |
| `reclaims a lock whose owner process is gone, without waiting` (kept)           | lock with pid `999999`                                                                                                                           | ok within 1 s                                                                                                                                                |
| `does not reclaim a lock held by another call in this process`                  | hold the lock in an async call that resolves after 300 ms; start a second call                                                                   | second call waits and then succeeds; both `work`s ran, in order                                                                                              |
| `judges a lock from another host by age only`                                   | lock content `${process.pid}:other-host:abc`, fresh mtime                                                                                        | times out (shorten `LOCK_TIMEOUT_MS` via fake timers or a test-only option); with mtime 60 s old → reclaimed                                                 |
| `two waiters cannot both reclaim one dead lock`                                 | dead lock; two processes spawned with `child_process.fork` running a tight loop of 200 `withFileLock` increments of a counter file; main asserts | counter equals 400 and no `.lock`/`.reclaim` left; run 20 times in CI (it is the audit's "600 writes, 300 survived" experiment, now expected to be lossless) |
| `a holder misjudged dead does not delete the reclaimer's lock on release`       | simulate: write a lock with our token; from the test, replace it with a different token mid-`work` (the test's `work` does it); release          | the foreign lock file is still present after release; the test removes it                                                                                    |
| `closes the descriptor and removes the lock when writing the token fails`       | `vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw … })`                                                                        | `ok: false`; no `.lock` file; `openSync` count equals `closeSync` count                                                                                      |
| `does not block the event loop while waiting`                                   | hold the lock in a forked child for 500 ms; in the parent start `withFileLock` and a `setInterval(…, 10)` counter                                | counter advanced ≥ 20 ticks before the lock resolved                                                                                                         |
| `releases the lock even when the work throws` (rewritten per patch)             |                                                                                                                                                  | outcome `ok: false`, no lock left                                                                                                                            |
| `project: setResponse reports a failed state write` (`project.test.ts`)         | hold `.laqi/state.json.lock` from a live foreign pid (`process.ppid`)                                                                            | `ok: false`, `code: 'unavailable'`; `state.json` unchanged                                                                                                   |
| `project: setResponse keeps another process's override`                         | store B writes `{ 'POST /orders': 'error' }` after `Project` loaded; `setResponse('GET /users', 'boom')`                                         | file contains both overrides                                                                                                                                 |
| `PUT /api/state answers 503 when the write fails` (`control-plane-app.test.ts`) | `setState` resolves `{ ok: false, error: 'timed out…' }`                                                                                         | status 503, body `{ error: 'laqi-control-plane', message }`                                                                                                  |
| `PUT /api/state does not count a flip that failed` (`serve.test.ts`)            | same                                                                                                                                             | `counters.flips` unchanged                                                                                                                                   |

---

## 6. `findKeyLine` (audit P2, Q7)

### Current behaviour on `main`

`loader.ts:190-194`: `source.indexOf(JSON.stringify(key))` then `slice(0, index).split('\n').length`, called once per top-level key (`:147`). For a 5 MB file with 5,000 keys that is ~25 GB of character work per reload, and the watcher reloads on every save. `indexOf` also finds the first textual match, which can be inside a string value or a nested object.

### Designed behaviour

**N1.** The loader **must** compute `Map<key, line>` for the top-level object in **one pass** over the source: track line number, bracket depth and string state (with escape handling); a string at depth 1 followed by optional whitespace and `:` is a key; `JSON.parse` the string literal to get the exact key text. Later duplicates overwrite earlier ones, matching `JSON.parse`'s last-wins. Keys not found map to line `1` (today's fallback).

**N2.** The scan runs only after `parseJsonWithPosition` succeeded (the source is known to be valid JSON, so the scanner needs no error recovery).

### Tests (`loader.test.ts`)

| Test name                                                                     | Setup                                                                                          | Expected                                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `records the line of each endpoint key` (kept)                                | existing fixture                                                                               | unchanged                                                                                        |
| `finds the key's own line even when the same text appears earlier in a value` | `{"GET /a": {"default":"ok","responses":{"ok":{"status":200,"body":"GET /b"}}},\n"GET /b": …}` | `GET /b` line is the second key's line, not the body's                                           |
| `handles escaped quotes and newlines inside strings`                          | a body string with `\"` and `\n` before the next key                                           | lines correct                                                                                    |
| `is linear in file size`                                                      | 2,000 keys, 2 MB; `performance.now()`                                                          | reload under 200 ms on CI (10× headroom over a local run; **unverified** figure, calibrate once) |

---

## 7. Alternatives considered and rejected

**Loader: follow a symlink when its real path stays inside the real mocks root (instead of never).** Strongest argument for it: it is what `resolveInside` does for writes, and it would let a monorepo share a mock file between two packages by link. Rejected because (a) it keeps a check-then-read window that only `O_NOFOLLOW` would close, and Node does not expose `O_NOFOLLOW` on Windows; (b) directory links are already not followed, so the feature would be half-present; (c) the write path breaks links anyway (rename over the link), so a linked mock would silently become a copy on first panel edit. Open question 1 can reopen this.

**Loader: `O_NOFOLLOW` on open.** Closes the race fully on POSIX. Rejected as the primary mechanism because it is not portable (no Windows constant) and `readFileSync` does not take flags for it; kept as an optional belt-and-braces in the implementation if `fs.constants.O_NOFOLLOW` is defined.

**Narrow `schemaSources.root` default to `src`.** Strongest argument: a smaller root needs no deny list. Rejected here because it breaks stored `source.file` paths and belongs to NIW2-315; the deny list protects whatever the root is, including user-widened roots.

**State cache invalidated by `fs.watch` on `.laqi/` with no `stat` on the hot path.** Strongest argument: zero syscalls per request. Rejected because `fs.watch` events are not guaranteed (network mounts, some containers), the watcher has inode and platform caveats (Node docs "Caveats" section, **unverified** verbatim in this spec), and a missed event means `laqi mcp`'s flips become invisible to the server until restart — a correctness bug, not a performance one. A `stat` is a few microseconds on a local filesystem; the expensive parts (read, parse, Zod) are what the cache removes. Can be added later as an _additional_ invalidation source via `invalidate()`.

**State cache with a time floor (re-`stat` at most every N ms).** Rejected for now: it saves little and adds up to N ms of staleness plus clock injection in tests. Reconsider with a measurement if `stat` shows up in a profile.

**`proper-lockfile`.** Strongest argument: battle-tested, `mkdir`-based so it works on NFS, mtime-refresh detects a compromised lock. Rejected because (a) its minimum `stale` is 5 s and default 10 s, so an orphan from a crash stalls every writer for ≥ 5 s where ours reclaims by pid at once; (b) its reclaim is `rmdir` then `mkdir`, and its README lists "a lockfile is manually removed and someone else acquires the lock right after" as undetected — the same class as Q1; (c) it adds `graceful-fs`, `retry`, `signal-exit` to the published bundle; (d) its mtime refresh timer is for long critical sections, which laqi does not have. See the ADR.

**`flock`/`fcntl` byte-range locks.** Kernel-enforced and released on crash automatically. Rejected: not in Node core; `fs-ext` is a native addon, which the CLI will not ship.

**A single writer process (MCP forwards writes to the running server over HTTP).** Removes cross-process locking entirely. Rejected: ADR-0006 and the `Project` docstring (`project.ts:72-80`) promise that MCP works with the server stopped.

**Keep the lock API synchronous and shorten the timeout in the server.** Rejected: still freezes requests for the shortened time, and the audit's 600-write experiment shows contention is real.

**Make `work()` async too.** Rejected: nothing in the critical section awaits, and allowing it would reintroduce in-process interleaving inside the lock.

---

## 8. Cross-ticket dependencies and file boundaries

| File                                                                                                   | Owner                                                                                                     | What this ticket does there                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/{loader,json-position,refresh-source,state-store,atomic-file,project}.ts` and tests | **NIW2-313**                                                                                              | everything above                                                                                                                                                                     |
| `packages/core/src/writer.ts`                                                                          | **NIW2-313** for `resolveSourcePath`, `locked()` and the `async` signatures; NIW2-311/315 do not touch it | R1-R4, K7                                                                                                                                                                            |
| `packages/core/src/module-permission.ts`                                                               | NIW2-310                                                                                                  | nothing; it receives the real path from R1. NIW2-310 must rebase onto R1 and may rely on `reason`                                                                                    |
| `packages/generate/src/import-schema.ts:315-331`                                                       | NIW2-311 (file refs, SSRF) / NIW2-310 (child env)                                                         | nothing; `resolved.path` is now real. If NIW2-311 adds `extensions` for modules, it passes R4's option                                                                               |
| `packages/schema/src/config.ts`                                                                        | NIW2-315                                                                                                  | nothing; default root unchanged (open question 2)                                                                                                                                    |
| `packages/server/src/control-plane-app.ts`                                                             | NIW2-309                                                                                                  | mechanical only: `'unavailable'` in `WriteFailure`, `STATUS`, `setState` signature, `PUT /api/state` 503 branch, `await` where the compiler demands (open question 5)                |
| `apps/cli/src/serve.ts`                                                                                | NIW2-309                                                                                                  | mechanical only: `await` on `Project` calls, `setState` returns the result, `recordFlip` on success                                                                                  |
| `packages/mcp/src/server.ts`                                                                           | NIW2-314                                                                                                  | mechanical only: `await` on `Project` calls. NIW2-314's annotations and output caps are unaffected; its "output caps" item should note that `LoadError.excerpt` is now bounded by D2 |
| `apps/cli/src/watcher.ts`                                                                              | NIW2-309                                                                                                  | nothing (`.laqi/` stays ignored)                                                                                                                                                     |
| `packages/editor/*`                                                                                    | NIW2-316                                                                                                  | nothing; the panel should render a 503 from `PUT /api/state` as "could not save" — note for NIW2-316                                                                                 |

Order of merges: this ticket first for `packages/core` (others rebase onto the async API), or NIW2-309 first with this ticket adapting — either works; what must not happen is both tickets editing `control-plane-app.ts`'s `STATUS`/`setState` lines in parallel. Suggested: NIW2-313 lands step 1-3 (no API change) immediately; step 4-6 (async) land after NIW2-309's first PR or in coordination.

---

## 9. Rollout — small steps, each shippable

1. **Loader symlinks and excerpt bounds (D1, D2, L1-L6).** Core only, no API change. Rewrite the C2 test. Changelog entry under security.
2. **`resolveSourcePath` real path + deny list + `refreshRequestFor` fixed messages (D3, D4, R1-R5, F1-F3).** Core only; signature gains optional `extensions` and `reason` (additive). New `refresh-source.test.ts`. Tell NIW2-310/311 that `path` is now canonical.
3. **`findKeyLine` one-pass scan (D9, N1-N2).** Core only.
4. **`StateStore` cache (D5, S1-S5).** `read()` unchanged in signature; land before the async change so the cache is tested in isolation.
5. **Async lock with guarded reclaim (D6, D8, K1-K8).** `withFileLock`, writer `*InFile`, `StateStore.write/update`, `Project` mutators go async. Mechanical `await`s in `serve.ts`, `control-plane-app.ts`, `mcp/server.ts`. Multi-process test with `fork`.
6. **Surface write failures (D7, K9-K10).** `'unavailable'`, 503, `recordFlip` on success, `Project` read-modify-write under the lock. Server and MCP tests.
7. Docs: add the two ADRs to `decisions/index.md`; one paragraph in `concepts/three-writers.md` ("what the lock guarantees between the three writers"); mention the symlink rule in the mocks-folder docs page (**unverified** which page documents `--dir`).

Steps 1-3 can go in one PR; 4, 5 and 6 are one PR each.

---

## 10. References

- Audit: `workspace-temp/audits/core.md` (S1, S2, S3, Q1, Q2, Q3, Q5, Q6, Q7, P1, P2, P3, P6); partial patch `workspace-temp/audits/partial-fixes/fix-core-hardening.patch` (ideas for the guard file, the fingerprint cache and the key-line scan were taken from it; its loader rule "follow if inside" was not).
- Project docs: [ADR-0004 — Active state is not tracked](/decisions/0004-state-outside-git/); [ADR-0006 — MCP server](/decisions/0006-mcp-server/) ("must be strictly scoped to the mocks directory"); [ADR-0012](/decisions/0012-effect-first-in-generate/) (core stays plain TypeScript: the async lock uses Promises, not Effect); [State resolution](/concepts/state-resolution/); [The three writers](/concepts/three-writers/); [JSON Schema and adapters — design spec](/design/json-schema-adapters/) §"Path bases and confinement".
- Hub: `general-knowledge/architecture/security-hardening.md` (TOCTOU: make the check and the use the same operation); `general-knowledge/error-handling/result-types.md` (results over throws, the pattern `withFileLock` already follows); `general-knowledge/conventions/adr-pattern.md`.
- [proper-lockfile README](https://github.com/moxystudio/node-proper-lockfile) — `mkdir` primitive, `stale` default 10 000 ms minimum 5 000, `update` = `stale/2`, "O_EXCL is broken on NFS file systems", undetected manual-removal race.
- [Vite `server.fs` options](https://vite.dev/config/server-options) — `server.fs.strict` default `true`; `server.fs.deny` default `['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**']`, "takes priority over `server.fs.allow`".
- [CWE-59 Improper Link Resolution Before File Access](https://cwe.mitre.org/data/definitions/59.html); children CWE-61 (UNIX symlink following), CWE-363 (race condition enabling link following).
- [MCP security best practices](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices) — local servers: "Restrict file system access for spawned MCP servers"; error messages as an exfiltration channel ("Error or response details leak to attacker").
- [`@openclaw/fs-safe` sidecar lock notes](https://cdn.jsdelivr.net/npm/@openclaw/fs-safe@0.4.0/docs/sidecar-lock.md) — `O_CREAT|O_EXCL` sidecar with a `shouldReclaim` hook, the same shape as K1/K4.
- V8 `JSON.parse` message format: verified locally on Node 24.21 and Bun 1.4.2 (see §3); V8's own [json-errors.js](https://chromium.googlesource.com/v8/v8.git/+/6.6.93/test/mjsunit/json-errors.js) pins the "Unexpected token" wording.
- Node `fs.watch` caveats (inode binding, platform backends, `fs.watchFile` polling): [nodejs.org/api/fs.html](https://nodejs.org/api/fs.html#caveats) — **unverified verbatim**; the fetch did not return that section.
