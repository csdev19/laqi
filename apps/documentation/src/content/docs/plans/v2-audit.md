---
title: v2 audit
---

# v2 audit

**Date:** 2026-08-25
**Scope:** `main...laqi-v2-packaging` — plans 2a, 2b, 3, 4 and 5 together
(~7.4k lines of source across `apps/cli` and
`packages/{core,schema,server,mcp,editor}`).
**Method:** adversarial multi-agent review, with every finding reproduced
before anything was fixed.

Plans 1 and 2a had already been through independent reviewers during their
execution. The other four ran without that second pair of eyes, and this audit
is what supplies it.

## Result

**15 findings filed, all real, all closed.** Plus a sixteenth that was not on
the list (below). 436 tests.

### The structural finding, which caused two others

The control plane's CRUD was **a second copy** of the MCP server's `Project`
class — same target-file rule, same duplicate-id check, near-identical
comments. And the two had already drifted:

- `POST /api/endpoints` never ran `parseEndpointKey`. A path like `/my orders`
  or `/../evil` was written to the user's file and answered **201**; on the
  immediate reload the loader rejected it. The panel said "created" and then
  showed a red error band over a dead entry the user had to remove by hand.
- `DELETE` did not clear the override in `.laqi/state.json`. Recreating the
  same id later silently revived it serving the old response.

`Project` moved to `@laqi/core` and both surfaces use it. One implementation
cannot drift.

### Correctness

| What                                                | Why it mattered                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Double `decodeURIComponent` in the control plane    | Hono already decodes: a path with a literal `%` threw `URIError` → 500, and the endpoint became uneditable and undeletable from the panel                                |
| The public app's `cors()` swallowed `OPTIONS` mocks | `mock-app.ts` registers OPTIONS mocks before its own cors precisely so they are reachable; the public app's undid that. 200 locally, **an empty 204 through the tunnel** |
| `seq` read inside the React updater                 | Events arriving in one flush all came out with the same key                                                                                                              |
| The detail draft reset on object identity           | `refresh()` always returns fresh objects: any unrelated reload wiped what you were typing                                                                                |
| `getStatus` reported `config.port`                  | With `--port 0` the panel showed `127.0.0.1:0` and offered a `curl` that fails                                                                                           |

### Robustness of the internet-facing surface

| What                                        | Why it mattered                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The rate limiter's Map was never swept      | The key comes from an attacker-controlled header: rotating it added a permanent entry per request, ~1.7M a day until the process died |
| cloudflared's output accumulated forever    | A tunnel left running for hours kept every logged byte and re-ran the regex over a growing string                                     |
| `close()` hung with an SSE client connected | `http.Server#close` waits for open connections, and `/events` never ends on its own. With the panel open it never resolved            |
| Malformed `%` escapes in the assets         | `%` or `%zz` — routine bot traffic — came out as a 500 with a stack instead of a 404                                                  |
| `--share-port` was not validated            | `Number('abc')` reached `server.listen()` as `NaN` and escaped as a bare stack trace                                                  |

### Efficiency

- `import_openapi` called `createEndpoint` once per operation, and each call
  reloaded and re-parsed **every** mock file then rewrote the whole target —
  quadratic disk I/O, plus one watcher reload per endpoint. A 150-operation
  spec did 150 of each. It now loads once and writes once.
- `reload()` emitted one `endpoints-changed` **plus one `error` per broken
  file**, and the panel does a full refresh per event: with three broken files,
  one save fired four refreshes and sixteen GETs. One event now, and the panel
  coalesces them.
- The SSE keep-alive was a `while (!closed) await stream.sleep(30)` — a timer
  waking 33 times a second **per connection** just to check a flag. It now
  awaits `stream.onAbort` directly.

## Finding 16, which was inside a parenthesis

The review's _non-findings_ section dismissed `writer.ts`'s containment guard
like this:

> `resolveInside` correctly rejects escapes **(symlinks aside)**

That parenthesis was a real hole. `resolve()` is purely lexical and never
touches the disk, so a symlink **inside** the project pointing outside walked
straight through:

```
laqi/escape -> /tmp/outside    →    write result: {"ok": true}
```

That is exactly what [ADR-0006](/decisions/0006-mcp-server/) forbids: the
agent must stay confined to the mocks directory, and creating a symlink is
something the agent itself can do. The guard now resolves real paths — the root
included, because the root can be a symlink too (on macOS `/tmp` is one, and
comparing it unresolved would reject every legitimate write).

**The lesson:** the most expensive thing in the audit was inside a parenthesis,
in a section headed "things I checked and cleared". Reading only the findings
list would have left the hole open.

## A note about weight, not correctness

The MCP SDK was a runtime dependency and dragged express, jose and ajv into
**every** install, even if you never run `laqi mcp`. Bundling it lets
tree-shaking drop the HTTP transport we do not use: a clean `npm install` went
from **97 packages to 6**, and `laqi mcp` still works — verified from the
tarball on plain Node.

---

# Second round

**Date:** 2026-08-26
**Scope:** everything the first round did not cover — that round's own fixes
(commits `0a0143f`, `bbb0108`, `de8254a`) and the `examples/todo-app` example.
None of it had been reviewed by anyone.
**Method:** four parallel angles on a cheap model, each required to
**reproduce** before reporting and to discard anything it could not demonstrate.

## Result

**10 findings, all real.** The security angle found nothing: the first round's
seven fixes held up under in-process proofs.

## The worst part: two regressions from the first round's fixes

The "did a fix break something else?" angle was the right one, and it found
exactly what it was pointed at.

**1. The tunnel wedged.** Fixing "the buffer grows without bound" removed the
`stdout`/`stderr` listeners from cloudflared's process. That does not only stop
accumulating: it **pauses the stream**. Node stops draining the pipe, the pipe
fills, and cloudflared — which writes to stderr synchronously — blocks forever
on its next log line. A tunnel left running for hours simply died.

And there is a second lesson: **the two tests written alongside that fix
asserted `listenerCount === 0`**, pinning the bug in place. A test can enshrine
the very mistake it ships with.

**2. The duplicate check was bypassed by a space.** The fix normalised the keys
_in the file_ but still built the id from the raw path. `"/users "` passed both
checks, leaving two keys that normalise to the same id, and the route table
rejected both — killing the endpoint that already worked. Precisely the failure
that commit claimed to close.

**3. The wrong port blamed.** Deciding which listener failed by reading the
error text is wrong in both directions: under Bun the `EADDRINUSE` message has
no `":port"` in it, so with `--share` a busy main port blamed `--share-port`;
under Node, a tunnel port whose digits start like the main port's blamed
`--port`. `startServer` now marks which listener failed on the error itself.

## Concurrency and state

| What                                                         | Why it mattered                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The rate limiter's counters were rebuilt on every hot reload | Saving **any** local file handed a rate-limited tunnel client its full quota back: the public surface's only DoS protection, reset by a keystroke                                                                                                                                                          |
| `writeFileObject` used a fixed `.tmp` name                   | This release wires **two processes** onto the same files (the MCP server and the control plane). Measured: 80 concurrent creates left **48**, plus a crash with `ENOENT` when one renamed a temp file the other had already taken. Now: unique temp names and a file lock with stale-lock recovery — 80/80 |

## The example: the panel was not in control

The most embarrassing finding, and it is a design error rather than an
oversight.

`examples/todo-app` requested each page with `X-Laqi-Response: page-N`. That is
laqi's **highest-precedence** layer: it beats panel overrides and scenarios. An
app that sends it on every request overrides the panel on every request — so
**the feature the README advertised did not work**: flipping `GET /todos` to
`error`, `empty` or `slow`, or activating `backend-caido`, never reached the
app.

Worse: the original verification was done with curl **without** that header —
testing a path the app never takes. Seeing what you want to see.

The mock now returns the whole list and the app paginates client-side. A real
backend would paginate server-side; laqi ignores the query string, so this is
the honest shape — and it leaves the panel authoritative, which is the whole
point of the example. The README explains why, so it does not get reintroduced.

Two consequences went with it: requesting `page-3` (reachable after creating
two todos) returned a 500 with no way back, because it is a response name the
mock never declared.

Also in the same example:

- A created todo showed the mock's **canned title** instead of what the user
  typed. Only the shape comes from the server; the title comes from what was
  typed, which is what a real backend would return.
- Reading the session cookie during render returned `null` under SSR and the
  real session after hydration: a **hydration mismatch** on every load for a
  signed-in user, and a redirect to `/login` for people who were signed in.
  There is a `useSyncExternalStore`-backed store now — `null` on the server by
  construction — plus a `ready` flag so guards wait for mount.
- The profile's 401 handling performed side effects **during render** (writing
  a cookie and navigating), which runs twice under StrictMode.

## The lesson from this round

The first round left its most expensive finding inside a parenthesis. This one
left two of its three worst in **fixes made quickly and never reviewed**, one
of them with a test that enshrined the bug.

Fixing fast and not reviewing the fix has a measurable cost: **2 of the 10**
findings in this round exist only because the previous round was never
reviewed.
