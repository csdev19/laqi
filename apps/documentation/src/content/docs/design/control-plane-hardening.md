---
title: Control-plane hardening — design spec
---

# Control-plane hardening — design spec

**Status:** proposed, not implemented.
**Date:** 2026-10-12
**Ticket:** [NIW2-309](https://linear.app/niway/issue/NIW2-309) — Harden the control plane against DNS rebinding and CSRF (audit umbrella NIW2-302)
**Scope of ownership:** `packages/server` (except module routes, which belong to NIW2-310), `apps/cli/src/{serve,index,tunnel,watcher,editor-assets}.ts`, plus the minimal panel adaptation named in [File boundaries](#cross-ticket-dependencies-and-file-boundaries).

This document turns the control-plane findings of the laqi audit into contracts an
implementer can build and a reviewer can check. Every finding was re-located on the
read-only export of `origin/main` taken on 2026-10-12; line numbers below refer to
that snapshot. **Nothing in the ticket is already fixed on main**: the audits were
written against `feat/hero-demo`, and the only drift is a shift of a few lines in
`control-plane-app.ts` (the Origin guard moved from 279-303 to 285-305).

Normative statements use **must** / **must not**. Code blocks marked _illustrative_
show intent, not final declarations. Claims not verified in code or by running
anything are marked **unverified**.

## In one minute

### Summary

The panel and the control plane are bound to loopback and trust that binding. That is
not enough: a browser on this machine will happily carry a request from any website
to `127.0.0.1:8000` if that website's DNS name rebinds to loopback, and every `GET`
under `/__laqi` answers it — including `/api/status`, which hands over the `--share`
bearer token. Writes are guarded only by an Origin allowlist that accepts any
`localhost:*` port and parses JSON regardless of `Content-Type`. The panel ships no
CSP and can be framed. On the tunnel, the rate limiter counts anonymous requests
against the owner's quota and sorts every bucket under pressure. SSE fan-out is
unbounded. The mock app can throw and lies to the log. The CLI kills the server when
a reload finds no endpoints, reloads twice per panel write, and never notices the
tunnel dying.

This spec makes admission to `/__laqi` depend on **the name the request used, not the
socket it arrived on** (Host allowlist on every route, SSE included), makes writes
accept only the exact served origin with three independent signals, takes the share
token out of every `GET`, adds a CSP the React panel can live with, reorders the
tunnel's rate limit behind authentication, bounds SSE and request bodies, makes the
mock app never throw, and makes the CLI's reload and tunnel lifecycle degrade instead
of exit.

### Decisions

| #   | Decision                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                                                                   | ADR                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | Every request under `/__laqi` (panel, API, `/events`) **must** carry a `Host` whose hostname is a loopback name (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`) or a name the developer listed with `--allowed-host`. Hostname-only; the port is not checked on Host. | A rebinding page cannot choose the `Host` the browser sends. Hostname-only is what Vite, webpack-dev-server and the MCP TypeScript SDK do; checking the port breaks SSH/VS Code port forwards for no security gain.   | [ADR-0014 control-plane admission](/decisions/0014-control-plane-admission/) |
| D2  | An `Origin`, when present on **any** method, **must** name the same authority as `Host` (scheme `http` or `https`). A request with no `Origin` is admitted.                                                                                                                | "Exact served origin" closes writes from other `localhost:*` apps and cross-origin `EventSource` on `/events`. Browsers always send `Origin` on cross-origin requests; curl, scripts and the in-process MCP never do. | same                                                                         |
| D3  | A write (`POST`/`PUT`/`PATCH`/`DELETE`) additionally **must** have `Sec-Fetch-Site` ∈ {`same-origin`, `none`, absent}, and a body **must** be `Content-Type: application/json` (415 otherwise) and ≤ 8 MiB (413 otherwise).                                                | Three signals that fail independently. A non-safelisted content type forces a CORS preflight the control plane never grants, so a cross-origin page cannot even deliver the body.                                     | same                                                                         |
| D4  | No per-session secret, cookie or CSRF token on the control plane.                                                                                                                                                                                                          | It would break the documented `curl` scripting flow and protect nothing D1-D3 do not, because a local process is the developer.                                                                                       | same                                                                         |
| D5  | `share.token` leaves `GET /api/status`. The terminal remains the primary place; the panel obtains it on demand through `POST /__laqi/api/share/token`, which answers `Cache-Control: no-store`.                                                                            | No `GET` on the control plane may return a secret, so a single admission bug or a same-origin XSS cannot turn into token theft. F7's Reveal / Copy curl keep working.                                                 | [ADR-0015 share-token disclosure](/decisions/0015-share-token-disclosure/)   |
| D6  | Panel documents get a strict CSP (`'self'` only, `data:` for images and fonts, `frame-ancestors 'none'`) plus `X-Frame-Options`, `nosniff`, `Referrer-Policy`; every JSON response gets `nosniff`, `no-referrer`, `Cache-Control: no-store`.                               | Clickjacking a Delete or a module Confirm is free to prevent. The built panel has no inline script or style, so no nonce machinery is needed.                                                                         | none                                                                         |
| D7  | On the tunnel: authenticate **before** counting against the per-IP and global quota; failed authentications are counted in a separate, small per-IP bucket; bucket eviction is O(1) (a new key at the ceiling shares the global bucket instead of sorting).                | An anonymous flood must not lock the owner out of the 1200/min quota, and an attacker rotating `CF-Connecting-IP` must not make every request sort 10 000 entries.                                                    | none                                                                         |
| D8  | SSE: at most 8 concurrent streams (503 beyond), one serialised JSON per event shared by all streams, a bounded per-stream queue (256) that drops the oldest and tells the client with an `overflow` event, a 15 s heartbeat comment.                                       | Memory is bounded by laqi's own numbers, not by the transport's behaviour; the panel can resync on `overflow` (NIW2-316).                                                                                             | none                                                                         |
| D9  | Mock app: `app.onError` answers the JSON envelope with 500; the request event is emitted **after** the response exists; null-body statuses never throw; 1xx answers 500 with a message.                                                                                    | The log and the real result must agree; a thrown error today is a bare `Internal Server Error` nobody can act on.                                                                                                     | none                                                                         |
| D10 | The public (tunnel) surface's 404 **must not** list routes, with or without a token.                                                                                                                                                                                       | Route enumeration from a URL bots scan.                                                                                                                                                                               | none                                                                         |
| D11 | A reload **must never** exit the process; only boot does. A reload whose loaded content is byte-identical to the current one is a no-op (no rebuild, no event, no reprint). A tunnel that dies after start is reported and the band clears.                                | Deleting the last endpoint in the panel kills server and tunnel today; a panel write reloads twice; a dead tunnel keeps advertising a URL.                                                                            | none                                                                         |

### Open questions for the owner

1. **`--allowed-origin`.** D2 rejects browser writes from any other local origin (a frontend at `localhost:3000` calling `PUT /__laqi/api/state` from its own page). Nothing documents that use, so this spec does not offer an escape hatch. Recommendation: do not add one now; reopen on a user report.
2. **Where `allowedHosts` lives.** This spec ships the CLI flag `--allowed-host` (repeatable). A `laqi.config.json` key would be convenient for Codespaces teams but widens what a cloned repository can decide, which is NIW2-315's trust boundary. Recommendation: flag only in this ticket; the config key is NIW2-315's call.
3. **Reveal in the panel vs terminal only.** D5 keeps the panel's Reveal / Copy curl through a `POST`. The stricter alternative removes the token from the API entirely and the band says "printed in your terminal". Recommendation: keep D5; F7 is a designed flow.
4. **SSE numbers.** 8 streams, 256 queued events, 15 s heartbeat are defaults with no measurement behind them. Recommendation: accept, and make them constants in one place.
5. **Tunnel auto-restart.** D11 reports a dead tunnel and stops. One automatic retry would be cheap. Recommendation: no retry in this ticket; a retry that fails silently is worse than a notice.
6. **CSP enforcing vs `Report-Only` for one release.** Recommendation: enforce from the start, gated by the static test in [F3](#f3-panel-and-api-response-headers) and the manual flow check in [Rollout](#rollout-and-order-of-implementation).
7. **Body limit 8 MiB.** Large enough for an inline OpenAPI document pasted in the panel, small enough that a stray local script cannot exhaust memory. Recommendation: accept.

### Out of scope

- Module execution approval (`prepare`/`confirm`, tokens, child env) — **NIW2-310**. The admission rules here apply to those routes like any other, nothing more.
- Trusting `laqi.config.json` from the current directory, fail-closed config, unknown keys — **NIW2-315**.
- Rejecting a body on 204/304 or a 1xx status **at load time** — **NIW2-315**. This ticket only makes the runtime never throw on one.
- The panel's reaction to an `overflow` event (resync) and other editor changes — **NIW2-316**. This ticket changes the panel only where the API contract forces it (see [boundaries](#cross-ticket-dependencies-and-file-boundaries)).
- The `hono` bump — **NIW2-312**. Nothing here depends on a newer Hono than 4.12.3.
- In-memory state cache for `getState()` on every request — **NIW2-313**.
- Authentication on the control plane, `cors: '*'` on the loopback mock server (server audit S7), and Private Network Access / Local Network Access preflights: documented, not changed.
- The reusable guidance hub (`general-knowledge`) has no page on DNS rebinding, CSRF or CSP today; this spec cites external sources and does not create one.

## Threat model

Who can reach the loopback listener:

| Caller                                                                                              | Can today                                                                      | Should                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| The developer's own browser tab on the panel (`http://localhost:8000/__laqi`)                       | read + write                                                                   | read + write                                                               |
| `curl`, scripts, editors, the README's documented `PUT /__laqi/api/state` flow (no `Origin`)        | read + write                                                                   | read + write — they run as the developer and could edit the files directly |
| The MCP server                                                                                      | in-process (`new Project(...)`, `packages/mcp/src/server.ts:56`); never HTTP   | unchanged                                                                  |
| A page on **any other website**, after rebinding its DNS name to `127.0.0.1`                        | read everything, incl. the share token                                         | nothing: 403 on every route                                                |
| A page on **another local origin** (`localhost:3000`, a dev server with an XSS or a bad dependency) | write (Origin allowlist accepts any localhost port); read blocked only by CORS | nothing: 403 on every route                                                |
| Any website framing the panel invisibly                                                             | can frame it                                                                   | cannot                                                                     |
| Anyone with the tunnel URL and no token                                                             | can burn the owner's whole quota, enumerate routes on 404                      | gets 401 cheaply, then 429 from its own bucket; learns nothing             |

Why rebinding is still real in 2026: Chrome 94+ blocks requests from public,
non-secure pages to private addresses (Private Network Access), so Chrome users are
mostly covered; Firefox and Safari are not, and the Vite advisory that introduced
`server.allowedHosts` says exactly that ([CVE-2025-24010](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)).
The MCP specification requires the same of every local HTTP server: "Servers MUST
validate the Origin header on all incoming connections to prevent DNS rebinding
attacks" ([MCP transports, Security Warning](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)).

## Vocabulary

| Term              | Meaning here                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loopback surfaces | Everything mounted under `/__laqi` on the local listener: the panel's static files (`createEditorApp`) and the control plane (`createControlPlaneApp`). |
| Authority         | The `host[:port]` part of a URL or a `Host` header, after WHATWG URL normalisation (`new URL('http://' + value).host`).                                 |
| Loopback name     | `localhost`, any `*.localhost`, an IPv4 literal in `127.0.0.0/8`, or `[::1]`. Literals are never looked up, so they cannot be rebound.                  |
| Admission         | The set of checks a request passes before any `/__laqi` handler runs (D1-D3).                                                                           |
| Write             | A request whose method is `POST`, `PUT`, `PATCH` or `DELETE`.                                                                                           |
| Public surface    | The second listener that the tunnel points at (`createPublicApp`), where the control plane does not exist.                                              |

## F1 — Admission to the loopback surfaces

### Current behaviour on main

- `packages/server/src/control-plane-app.ts:285-305` — the only guard. It runs on
  writes (`POST`/`PUT`/`DELETE`; `PATCH` is not listed) **that carry an `Origin`**, and
  accepts any `http:` origin whose hostname is `127.0.0.1`, `localhost` or `[::1]`,
  on any port. `GET`s and `/events` (`:553-573`) are not checked at all.
- No `Host` check exists anywhere in `packages/server/src` or `apps/cli/src` (grepped).
- `apps/cli/src/serve.ts:554-559` mounts the panel and the control plane whenever the
  bind host is loopback. `editor-assets.ts:57-76` serves files with only a
  `Content-Type`.
- Bodies are read with `c.req.json()` (`control-plane-app.ts:338, 437, 511` and the
  `readJson` helper at `:599-607`) without looking at `Content-Type`; no size limit.
- The panel's client sends `Content-Type: application/json` on every request with a
  body (`packages/editor/src/api.ts:39`) and uses relative URLs under `/__laqi`
  (`:10`), so it is already compliant with D3.
- The `dev:hmr` workflow proxies `/__laqi/api` and `/__laqi/events` from Vite on
  `:5173` to laqi on `:8000` without `changeOrigin` (`packages/editor/vite.config.ts:36-41`),
  so those proxied requests arrive with `Host: localhost:5173` and
  `Origin: http://localhost:5173`.

### Threat

1. **DNS rebinding (read + token theft).** The developer runs `laqi --share` and
   opens `evil.example` in Firefox. The page's DNS answer flips to `127.0.0.1` with a
   short TTL. From then on `fetch('/__laqi/api/status')` from that page is
   same-origin with `evil.example:8000` and returns the tunnel URL and bearer token;
   `/api/endpoints` returns every mock body; `/__laqi/events` streams every request
   path. Writes are blocked only because the browser sends
   `Origin: http://evil.example:8000`.
2. **CSRF from another local origin (write).** A compromised dependency in the
   frontend served at `localhost:3000` posts to `http://localhost:8000/__laqi/api/endpoints`
   with `Content-Type: text/plain` (a CORS simple request, no preflight) and the
   guard admits it because `localhost` is on the list. Files in the developer's
   project are rewritten; `PUT /api/state` flips what the app sees.
3. **Cross-origin `EventSource`.** A page on any origin can hold `/__laqi/events`
   open. It cannot read it (no CORS headers), but it occupies a stream slot — which
   matters once F6 caps them.

### Designed behaviour

A single middleware, `localOnly`, exported by `@laqi/server`, **must** run before
every handler under `/__laqi`, on both the panel and the control plane. It is applied
by `createControlPlaneApp` itself (so the package is safe when embedded on its own)
and by `serve.ts` on the editor app. Running it twice on control-plane routes is
accepted; it is a few string comparisons.

**R1 — Host.** The request **must** carry a `Host` header (absent → 403). Its value
**must** parse as an authority (`new URL('http://' + value)` succeeds, with no
credentials and no path). Its hostname **must** be a loopback name or be listed in
`allowedHosts`. An `allowedHosts` entry matches the hostname exactly; an entry that
starts with a dot (`.app.github.dev`) matches the bare name and every subdomain. The
port is **not** checked on Host (D1). Otherwise: `403 { error: 'laqi-control-plane',
code: 'host-not-allowed', message: 'laqi does not answer to the host "<host>". To allow it, start laqi with --allowed-host <host>' }`.

**R2 — Origin, every method.** If an `Origin` header is present, it **must** parse as
a URL whose scheme is `http:` or `https:` and whose `host` (authority, after
normalisation) is byte-equal to the request's normalised Host authority. The literal
`null` fails to parse and is therefore rejected, as OWASP requires. Otherwise:
`403 { code: 'origin-not-allowed', message: 'cross-origin request rejected' }`.

**R3 — Writes.** For `POST`, `PUT`, `PATCH`, `DELETE`:

- if `Sec-Fetch-Site` is present it **must** be `same-origin` or `none`; `same-site`
  and `cross-site` are rejected with `403 { code: 'origin-not-allowed' }`. (`same-site`
  is what `localhost:3000` → `localhost:8000` produces: same registrable name,
  different origin.)
- if the request has a body (a `Content-Length` other than `0`, or a
  `Transfer-Encoding`), `Content-Type` **must** be `application/json` ignoring
  parameters and case. Otherwise `415 { code: 'unsupported-media-type', message: 'the body must be sent as application/json' }`.
- the body **must not** exceed `MAX_BODY_BYTES = 8 * 1024 * 1024`; a declared
  `Content-Length` above it is refused before a byte is read, an undeclared body is
  counted as it streams and refused the moment it goes over. Otherwise
  `413 { code: 'body-too-large', message: 'the body exceeds 8 MiB' }`. Hono's
  `bodyLimit` from `hono/body-limit` does exactly this and is used (available in
  4.12.3; its Content-Length/Transfer-Encoding bypass was fixed in 4.9.7,
  [CVE-2025-59139](https://db.gcve.eu/vuln/CVE-2025-59139)).

**R4 — Navigation is admitted.** A top-level navigation to `/__laqi` from a link on
any site is a `GET` with no `Origin` and `Sec-Fetch-Site: cross-site`; R2 and R3 do
not touch `GET`, so the developer can still click a panel link from a chat. This is
the navigation exception the OWASP cheat sheet makes for Fetch Metadata.

**R5 — No Origin, no Sec-Fetch-Site: admitted.** Every browser that can make a
cross-origin request sends `Origin` on it (all of them for writes; Fetch/XHR for
reads), and every browser that implements Fetch Metadata sends `Sec-Fetch-Site`
(Chrome 76, Firefox 90, Safari 16.4 — [caniuse](https://caniuse.com/mdn-http_headers_sec-fetch-site)).
A request with neither is a non-browser client on this machine: curl, a script, an
editor plugin. Those are the developer. Refusing them breaks the README's control
plane API section and protects nothing.

**R6 — Mock routes are untouched.** The guard applies to `/__laqi` and `/__laqi/*`
only. The mock server keeps answering any `Host` (it serves phones over the LAN with
`--host 0.0.0.0`, and the tunnel).

**R7 — Order.** Admission runs before the panel's `index.html`, before the
"panel not built" 503 page, before `/events`, and before every control-plane route
including the 404 catch-all. A rejected request **must not** reach a handler and
**must not** emit an event.

**R8 — `allowedHosts` source.** `--allowed-host <name>` (repeatable; `parseArgs`
`multiple: true`) in `apps/cli/src/cli-surface.ts`. The effective list, when not
empty, is printed on the start screen as a `hosts` row. A config key is Open
question 2.

**R9 — Chrome's and Safari's `*.localhost`.** Firefox 84+ and Chrome resolve
`*.localhost` to loopback internally; Safari follows `/etc/hosts` on older macOS
([WebKit 160504](https://bugs.webkit.org/show_bug.cgi?id=160504)). Either way the
name cannot be rebound because `.localhost` is a reserved TLD (RFC 6761), so it is in
the loopback set, as Vite does.

### Interfaces (illustrative)

```ts
// packages/server/src/local-guard.ts — illustrative
export type LocalGuardOptions = {
  /** Extra hostnames (exact, or `.suffix`) the developer trusts. Default []. */
  allowedHosts?: readonly string[]
}

export type AdmissionRefusal =
  | { code: 'host-not-allowed'; status: 403 }
  | { code: 'origin-not-allowed'; status: 403 }
  | { code: 'unsupported-media-type'; status: 415 }
  | { code: 'body-too-large'; status: 413 }

/** Pure, for tests: why a request would be refused, or null. Body size is not here. */
export function admissionRefusal(
  headers: { host?: string; origin?: string; secFetchSite?: string; contentType?: string; hasBody: boolean },
  method: string,
  options: LocalGuardOptions,
): AdmissionRefusal | null

/** The Hono middleware: admissionRefusal + bodyLimit, in that order. */
export function localOnly(options?: LocalGuardOptions): MiddlewareHandler

export function createControlPlaneApp(
  runtime: ControlPlaneRuntime,
  options?: { guard?: LocalGuardOptions },
): Hono
```

```ts
// apps/cli/src/serve.ts — illustrative mount
if (isLoopback(config.host)) {
  const guard = localOnly({ allowedHosts: options.allowedHosts })
  top.use('/__laqi', guard)
  top.use('/__laqi/*', guard)
  top.route('/', createEditorApp())
  top.route('/__laqi', createControlPlaneApp(controlPlaneRuntime, { guard: { allowedHosts } }))
}
```

Error envelope: every refusal is JSON `{ error: 'laqi-control-plane', code, message }`
— the existing envelope plus a machine-readable `code`, which the panel can show
verbatim. (The panel never sees these in normal use; they exist for curl users.)

### Migration and breaking changes (npm users)

| Before                                                         | After                                                                                                      | Who notices                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl -X PUT -d '{"scenario":"x"}' .../__laqi/api/state` works | 415: curl's `-d` default is `application/x-www-form-urlencoded`; add `-H 'Content-Type: application/json'` | Scripts against the documented API. The README examples must be updated to carry the header.                                                                                                                                                              |
| Panel reachable through a reverse proxy / Codespaces URL       | 403 naming the host and the flag; `--allowed-host .app.github.dev` restores it                             | Codespaces, Gitpod, any proxy that preserves the public `Host`. Whether Codespaces preserves `Host` or rewrites it to `localhost` is **unverified**; if it rewrites, reads work without the flag and writes need the proxy to pass `Origin` consistently. |
| Browser code on `localhost:3000` writing to `/__laqi/api/*`    | 403                                                                                                        | Undocumented use; see Open question 1.                                                                                                                                                                                                                    |
| `dev:hmr` proxy                                                | must set `changeOrigin: true` and strip `Origin` (see boundaries)                                          | Contributors only.                                                                                                                                                                                                                                        |

Nothing changes for the panel, for curl reads, for MCP, or for mock traffic.

### Tests

All in `packages/server/src/local-guard.test.ts` unless stated. `app.request(path, init)`
with explicit headers; the runtime is the existing `makeRuntime()` stub with
`vi.fn()` on writes so "never calls the handler" is asserted.

| Test name                                                                              | Input                                                                                                                                                | Expected                                                                      |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rejects a GET whose Host is a public name (DNS rebinding)`                            | `GET /api/status`, `Host: evil.example:8000`                                                                                                         | 403, `code: 'host-not-allowed'`, body does not contain `share`                |
| `rejects the SSE stream on a public Host`                                              | `GET /events`, `Host: evil.example:8000`                                                                                                             | 403 JSON, `content-type` is not `text/event-stream`, `subscribe` never called |
| `admits every loopback spelling of Host`                                               | `Host` ∈ {`localhost:8000`, `LOCALHOST`, `localhost`, `127.0.0.1:8000`, `127.1.2.3:1`, `[::1]:8000`, `[0:0:0:0:0:0:0:1]:8000`, `app.localhost:8000`} | 200 for each                                                                  |
| `rejects look-alike hosts`                                                             | `Host` ∈ {`localhost.evil.example`, `127.0.0.1.evil.example`, `evil.example`, `[::2]:8000`, `0.0.0.0:8000`, `10.0.0.5:8000`}                         | 403 each                                                                      |
| `rejects a missing or malformed Host`                                                  | no `Host`; `Host: a b`; `Host: user@localhost`; `Host: localhost/path`                                                                               | 403 each                                                                      |
| `admits a host from --allowed-host, exact and dot-suffixed`                            | options `allowedHosts: ['.app.github.dev', 'laqi.internal']`; `Host: x-8000.app.github.dev`, `Host: app.github.dev`, `Host: laqi.internal:9000`      | 200 each; `Host: notlaqi.internal` → 403                                      |
| `rejects an Origin on any other port, on GET and on PUT`                               | `Host: localhost:8000`, `Origin: http://localhost:3000`; both `GET /api/state` and `PUT /api/state`                                                  | 403 `origin-not-allowed`, `setState` not called                               |
| `rejects Origin null`                                                                  | `PUT /api/state`, `Origin: null`                                                                                                                     | 403                                                                           |
| `admits the exact served origin, http and https`                                       | `Host: localhost:8000` + `Origin: http://localhost:8000`; `Host: x.app.github.dev` (allowed) + `Origin: https://x.app.github.dev`                    | 200 each                                                                      |
| `rejects a write whose Sec-Fetch-Site is same-site or cross-site, even with no Origin` | `DELETE /api/endpoints/GET%20%2Fusers`, `Sec-Fetch-Site: same-site`; then `cross-site`                                                               | 403 each, `deleteEndpoint` not called                                         |
| `admits a write with Sec-Fetch-Site same-origin or none`                               | `PUT /api/state` valid body, `Sec-Fetch-Site: same-origin`; then `none`                                                                              | 200 each                                                                      |
| `admits a top-level navigation from another site`                                      | `GET /` on the editor app, `Sec-Fetch-Site: cross-site`, `Sec-Fetch-Mode: navigate`, no Origin                                                       | 200 `text/html` (apps/cli `editor-assets.test.ts`)                            |
| `admits a write with no Origin and no Sec-Fetch-Site (curl)`                           | `PUT /api/state`, `Content-Type: application/json`, valid body                                                                                       | 200                                                                           |
| `refuses a body that is not application/json with 415, before parsing it`              | `POST /api/endpoints`, `Content-Type: text/plain`, body is valid JSON                                                                                | 415, `createEndpoint` not called                                              |
| `accepts application/json with parameters, any case`                                   | `Content-Type: Application/JSON; charset=utf-8`                                                                                                      | 201                                                                           |
| `a DELETE with no body needs no Content-Type`                                          | `DELETE /api/endpoints/:id`, no body, no Content-Type                                                                                                | 204                                                                           |
| `refuses a declared Content-Length over the cap without reading it`                    | `Content-Length: 8388609`, body stream that throws if read                                                                                           | 413, stream never read                                                        |
| `refuses an undeclared body that grows over the cap`                                   | chunked body of 8 MiB + 1 byte                                                                                                                       | 413, handler not called                                                       |
| `a refused request never reaches the catch-all and emits nothing`                      | `GET /nope`, `Host: evil.example`                                                                                                                    | 403 (not the 404 envelope)                                                    |
| `PATCH is a write`                                                                     | `PATCH /api/state`, `Origin: http://localhost:3000`                                                                                                  | 403                                                                           |
| apps/cli `serve.test.ts`: `the panel and the API refuse a rebound Host end to end`     | real listener; `fetch(url, { headers: { Host: 'evil.example' } })` on `/__laqi`, `/__laqi/api/status`, `/__laqi/events`                              | 403 each; `/users` (mock) still 200 with the same Host                        |
| apps/cli `serve.test.ts`: `--allowed-host reaches the listener`                        | `startServer({ allowedHosts: ['laqi.test'] })`, `Host: laqi.test`                                                                                    | 200 on `/__laqi/api/status`                                                   |
| apps/cli `index.test.ts`: `--allowed-host is repeatable and printed`                   | argv `--allowed-host a.test --allowed-host .b.test`                                                                                                  | `startServer` receives both; start screen has a `hosts` row                   |

The existing tests at `control-plane-app.test.ts:483-499` ("allows a POST with a
legitimate local Origin (http://localhost:3000)") and `:565-583` ("allows
`http://[::1]:5173`") encode the behaviour D2 removes. They **must** be inverted, not
deleted: same inputs, expected 403.

## F2 — Share token disclosure

### Current behaviour on main

- `apps/cli/src/serve.ts:173-183` — `getStatus()` returns `share.token` with the
  comment "The token travels to the panel on purpose: it's local-only".
- `packages/server/src/control-plane-app.ts:432` — `GET /api/status` returns it to
  any admitted caller.
- `apps/cli/src/index.ts:387-397` — the terminal prints the token and a ready
  `curl`.
- `packages/editor/src/components/ShareBand.tsx:11-13, 35` reads `share.token` to
  build the curl, mask it (`'•'.repeat(token.length)`) and reveal it;
  `packages/editor/src/types.ts:39-45` types it.
- `serve.test.ts:354-367` asserts `status.share.token === 'testtoken'`.

### Threat

With F1 in place the rebinding read is closed. The token stays in a `GET` body
nevertheless, which means: any future admission bug, any same-origin XSS in the panel
(the CSP of F3 reduces but does not eliminate), any browser extension with host
permissions on `localhost`, and any screenshot of the Network tab exposes the one
secret that opens the tunnel from the internet. A secret should not be a side effect
of a status poll the panel issues every few seconds.

### Designed behaviour

- `getStatus().share` **must not** contain `token`. It carries
  `{ url: string | null, hasToken: boolean, exposed: string, closedReason?: string }`
  (`closedReason` is F9's).
- A new route `POST /__laqi/api/share/token` **must** return `200 { token }` with
  `Cache-Control: no-store` when sharing is on and a token exists; `404 { code: 'not-sharing' }`
  when `--share` is off; `404 { code: 'no-token' }` with `--public`. It takes no body.
  Being a `POST`, it is covered by R2 and R3 (any cross-origin page sends `Origin`
  and `Sec-Fetch-Site: cross-site`; both are rejected).
- The panel **must** call it only on `Reveal token` and `Copy curl`, never on load,
  and **must** drop the value when the band is hidden again. The mask is a fixed
  `lq_••••••••••••` as F7's flow spec draws it, not the token's length.
- The terminal stays as it is (`index.ts:387-397`): it is the place ADR-0007 item 5
  names, and it is where a developer who is not on the panel finds the token.
- `ControlPlaneRuntime` gains `revealShareToken: () => { ok: true; token: string } | { ok: false; code: 'not-sharing' | 'no-token' }`.

### Interfaces (illustrative)

```ts
// ControlPlaneRuntime.getStatus — illustrative
share?: { url: string | null; hasToken: boolean; exposed: string; closedReason?: string } | null

// packages/editor/src/api.ts — illustrative
revealShareToken: () => request<{ token: string }>('/api/share/token', { method: 'POST' }),
```

### Migration

`share.token` disappears from `/api/status`. Any script that read it must move to
`POST /__laqi/api/share/token` or the terminal. The README's share section does not
promise the field, so this is a change to an undocumented shape; the CHANGELOG entry
names it anyway.

### Tests

| Test name                                                                              | Input                                                                                                                                | Expected                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| server `GET /api/status never carries the share token`                                 | runtime with `share: { url, hasToken: true, exposed }`                                                                               | body has `share.hasToken === true` and no `token` key; `JSON.stringify(body)` does not contain the token value                 |
| server `POST /api/share/token returns the token with no-store`                         | `revealShareToken` → ok                                                                                                              | 200, `{ token }`, `cache-control: no-store`                                                                                    |
| server `POST /api/share/token is 404 when not sharing, and with --public`              | `{ ok: false, code: 'not-sharing' }`; `{ ok: false, code: 'no-token' }`                                                              | 404 each with the code                                                                                                         |
| server `a cross-origin page cannot reveal the token`                                   | `POST /api/share/token`, `Origin: http://localhost:3000`                                                                             | 403 (F1), `revealShareToken` not called                                                                                        |
| cli `serve.test.ts` (replaces `:354-367`): `reports the share state without the token` | `startServer` with `share: shared()`                                                                                                 | `status.share` is `{ url: null, hasToken: true, exposed: ... }`; `POST /__laqi/api/share/token` → `testtoken`                  |
| cli `the share token is not in any GET under /__laqi`                                  | fetch `/__laqi/api/status`, `/__laqi/api/endpoints`, `/__laqi/api/state`, `/__laqi/api/scenarios`, `/__laqi/api/schema/capabilities` | none of the bodies contains `testtoken`                                                                                        |
| editor `ShareBand.test.tsx`: `reveals the token only on request`                       | render with `hasToken: true`; click Reveal                                                                                           | `revealShareToken` called once; token rendered; before the click the mask is `lq_••••••••••••` and the token is not in the DOM |

## F3 — Panel and API response headers

### Current behaviour on main

`apps/cli/src/editor-assets.ts:75` sets `Content-Type` and nothing else on
`index.html`, assets and `favicon.svg`; `:59` returns the "not built" page with no
headers. Control-plane JSON responses carry only what `c.json` sets.

The built panel (`packages/editor`) is a Vite SPA (`ADR-0011`): `index.html` has one
`<script type="module" src>` and one `<link rel="icon">` (`packages/editor/index.html`),
no inline script, no inline `<style>`. The only inline style is a React
`style={{ background }}` on a legend swatch (`RequestLog.tsx:48`), which React sets
through CSSOM, not through a `style` attribute in markup, so `style-src 'self'` does
not block it (**unverified in a browser; gated by the manual check in Rollout**).
Vite inlines assets under 4 KiB as `data:` URIs at build time ([Vite CSP docs](https://vite.dev/guide/features#content-security-policy-csp)).
No `dangerouslySetInnerHTML`, `eval` or `new Function` in the panel source (grepped).

### Threat

Clickjacking: a page frames `http://localhost:8000/__laqi` invisibly, overlays a
decoy and walks the developer through two clicks — `Delete` on an endpoint, or
`Confirm` on a prepared project module, which executes code. F1 does not stop this:
the framed panel's own requests are same-origin. `nosniff` and `Referrer-Policy` are
free hygiene; `Cache-Control: no-store` keeps API JSON (and the F2 token) out of
disk caches.

### Designed behaviour

- Every `text/html` response under `/__laqi` (panel `index.html` and the "not built"
  page) **must** carry:

  ```
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  ```

- Every other response under `/__laqi` (assets and all control-plane responses,
  including refusals, 404s and the SSE stream's headers) **must** carry
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`; JSON
  responses **must** also carry `Cache-Control: no-store`. Hashed assets under
  `/__laqi/assets/` **may** carry `Cache-Control: public, max-age=31536000, immutable`
  (they are content-addressed by Vite); `index.html` **must** carry `Cache-Control: no-cache`.
- `data:` **must not** appear in `script-src` (Vite's own warning).
- The constants live in `packages/server/src/local-guard.ts` as
  `PANEL_SECURITY_HEADERS` and `API_SECURITY_HEADERS`, so the CLI and any embedder
  share one definition.
- The `dev:hmr` page on `:5173` is Vite's and gets no CSP; that is contributor-only.

### Migration

None for users. A future panel dependency that injects inline `<style>` tags
(CSS-in-JS) would break under this CSP; the static test below is the tripwire.

### Tests

| Test name                                                                                              | Input                                                                           | Expected                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| cli `editor-assets.test.ts`: `index.html carries the panel security headers`                           | `GET /__laqi` and `GET /__laqi/`                                                | CSP equals the string above; `x-frame-options: DENY`; `nosniff`; `referrer-policy: no-referrer`; `cache-control: no-cache`        |
| cli `the missing-build page carries the same headers`                                                  | `createEditorApp(null)`, `GET /__laqi`                                          | 503 with the same four headers                                                                                                    |
| cli `assets are nosniff and immutable`                                                                 | `GET /__laqi/assets/x.js`                                                       | `nosniff`, `cache-control` contains `immutable`, no CSP needed                                                                    |
| server `every control-plane response is nosniff and no-store, including refusals`                      | `GET /api/state` (200), `GET /nope` (404), `GET /api/state` with bad Host (403) | all three carry `nosniff`, `no-referrer`, `cache-control: no-store`                                                               |
| server `the SSE response is nosniff`                                                                   | `GET /events`                                                                   | `x-content-type-options: nosniff`, `content-type: text/event-stream`                                                              |
| cli `the built panel contains nothing the CSP forbids` (skipped when `packages/editor/dist` is absent) | read `dist/index.html`                                                          | no `<script>` without `src`; no `<style>`; no ` on[a-z]+=` attribute; no `javascript:`; every `src`/`href` starts with `/__laqi/` |

## F4 — Request caps on the control plane

### Current behaviour on main

- No body limit (F1 R3 adds it).
- `control-plane-app.ts:232-236` `PreviewRequestSchema` and `:238-241`
  `RegenerateRequestSchema` accept any integer `seed` and `arrayLength`. The
  generator clamps `arrayLength` to 1..1000 (`packages/generate/src/plan.ts:141`,
  comment), so the exposure is a request that asks for 2 000 000 000 items and is
  clamped — **unverified** whether the clamp runs before any allocation.

### Designed behaviour

- `arrayLength` **must** be `z.number().int().min(0).max(1000)`; `seed` **must** be
  `z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)`. Out of range → 400 with the
  field path in the message (`issuesToMessage`). 1000 mirrors the generator's clamp so
  the transport refuses what the generator would have silently reduced; the
  generator's own budget stays NIW2-311's.
- `MAX_BODY_BYTES` (F1) applies to every route with a body.

### Tests

| Test name                                                         | Input                                                                            | Expected                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| server `preview refuses arrayLength over 1000 and negative seeds` | `POST /api/schema/preview` `{ snapshot: {}, arrayLength: 1001 }`; `{ seed: -1 }` | 400 each, message names the field, `previewBody` not called |
| server `regenerate refuses the same bounds`                       | `POST .../regenerate` `{ arrayLength: 2000000000 }`                              | 400, `regenerateResponse` not called                        |

## F5 — Tunnel rate limit: order and eviction

### Current behaviour on main

`packages/server/src/public-app.ts`:

- `:75-84` the rate-limit middleware runs **before** the bearer check at `:112-124`.
  An anonymous request is counted against both `ip:<key>` and `global` (`:156-169`).
- `:36` `DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 240, globalMax: 1200 }`.
- `:137-150` when `buckets.size >= MAX_BUCKETS (10 000)`, every request sweeps all
  buckets, and if still full sorts all entries by `resetAt` and deletes the older
  half (`:145-147`). After halving to 5 000 the map refills and the sort recurs.
- `public-app.test.ts:244` has a test named "rate limits before authenticating, so a
  flood of bad tokens is cheap" — it encodes the order D7 reverses and **must** be
  rewritten.

### Threat

The tunnel URL is public and scanned. 1 200 requests with no token in one minute
consume the `global` bucket; the owner's own phone gets 429 for the rest of the
window. Rotating `CF-Connecting-IP` (possible from any local process on the public
port, and through the tunnel only if Cloudflare's header were spoofable — it is not,
so this is a local-only cost) forces the O(n log n) sort every few thousand requests.

### Designed behaviour

Order of middleware on the public app **must** be:

1. reserved-prefix 404 (`/__laqi*`), unchanged;
2. CORS preflight answer, unchanged (a preflight carries no token);
3. **bearer check**, when a token is configured. A failure **must** first consume
   from `auth:<ip>` with `authMax = 30` per window; when that bucket is exhausted the
   answer is `429` (with `Retry-After`) instead of `401`, so a brute force stops
   getting distinguishable answers and stops being free; otherwise `401` as today.
   A failed authentication **must not** touch `ip:<key>` or `global`;
4. **rate limit** for authenticated traffic (or all traffic with `--public`):
   `ip:<key>` then `global`, as today.

Eviction **must** be O(1) amortised:

- expired buckets are swept at most once per `windowMs` (a `lastSweepAt` beside the
  map), not on every write;
- when `buckets.size >= MAX_BUCKETS` after the sweep and the key is new, **no bucket
  is created** for it; the request is counted against `global` only. Existing keys
  keep their buckets. The sort is removed;
- the `global` bucket is never evicted.

`DEFAULT_RATE_LIMIT` gains `authMax: 30`. The buckets map stays owned by `serve.ts`
(`:102`) so it survives reloads, unchanged.

### Migration

A client with a wrong token sees 401 thirty times per minute, then 429. The owner's
quota is no longer affected by anonymous traffic. Documented in the README's
"Rate limiting" bullet.

### Tests (`public-app.test.ts`)

| Test name                                                                 | Input                                                                                        | Expected                                                                                |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `an anonymous flood does not touch the owner's quota`                     | 1 500 requests with no token from rotating `CF-Connecting-IP`; then 1 request with the token | the flood gets 401 (first 30 per IP) / 429; the owner's request is 200                  |
| `thirty bad tokens from one IP turn 401 into 429`                         | 31 requests, `Authorization: Bearer wrong`, same IP                                          | 30 × 401, then 429 with `Retry-After`                                                   |
| `a failed authentication is not counted against ip or global`             | 10 bad-token requests then inspect `buckets`                                                 | no `ip:` or `global` bucket exists; `auth:<ip>` has `count: 10`                         |
| `with --public the limiter counts everything, as before`                  | `token: null`, 241 requests from one IP                                                      | 240 × 200, then 429                                                                     |
| `at the ceiling a new key shares the global bucket and nothing is sorted` | fill 10 000 live buckets; request from a new IP; spy on `Array.prototype.sort`               | `buckets.size` stays 10 000; `global.count` incremented; `sort` never called            |
| `existing keys keep their own bucket at the ceiling`                      | as above, then a request from a key that already has a bucket                                | that bucket's `count` increments                                                        |
| `expired buckets are swept once per window, not per request`              | expired buckets present; two requests 1 ms apart                                             | size drops after the first; the second does not iterate (spy on `Map.prototype.delete`) |
| replaces `:244`: `authentication happens before the quota is spent`       | the old test's inputs                                                                        | the asserted order inverted                                                             |

## F6 — SSE fan-out

### Current behaviour on main

`control-plane-app.ts:553-573`: every subscriber runs `JSON.stringify(event)` and
`void stream.writeSSE(...)` with the promise ignored. No cap on streams, no queue
bound, no heartbeat. `serve.ts:95-98` emits one event per mock request on both
listeners. `EventBus` (`packages/core/src/events.ts`) is a plain listener set.
Whether `@hono/node-server` waits for `drain` when the Node socket is full is
**unverified** (the design below does not depend on it).

### Threat

A load test at a few thousand requests per second with two forgotten panel tabs
grows memory without bound and burns CPU on repeated `stringify`. A rebinding or
cross-origin page could, before F1, hold streams open; after F1 only same-origin
tabs can, so the cap is a resource limit, not a security one.

### Designed behaviour

- `MAX_EVENT_STREAMS = 8`. The ninth concurrent `GET /events` **must** answer
  `503 { error: 'laqi-control-plane', code: 'too-many-streams', message }` with
  `Retry-After: 5` and **must not** subscribe.
- Serialisation **must** happen once per event across all streams (a
  `WeakMap<LaqiEvent, string>` filled on first use, or a serialising wrapper around
  `runtime.subscribe`).
- Each stream **must** keep a FIFO of at most `MAX_QUEUED_EVENTS = 256` serialised
  frames and at most one `writeSSE` in flight. An event arriving at a full queue
  **must** evict the oldest and increment `dropped`. When the queue drains below the
  cap and `dropped > 0`, the stream **must** write one `event: overflow` /
  `data: { "dropped": n }` frame before the next event and reset the counter. The
  panel's reaction (refetch state and endpoints) is NIW2-316's; today's panel ignores
  unknown event names, which is what `EventSource` does by design, so the frame is
  backward compatible.
- Every `HEARTBEAT_MS = 15_000` of silence the stream **must** write the comment
  `: keep-alive\n\n`. A failed write (closed socket) **must** unsubscribe and end
  the handler, so a dead client is noticed within one heartbeat.
- The disconnect path (`stream.onAbort`) stays as it is.

### Interfaces (illustrative)

```ts
// packages/server/src/sse.ts — illustrative
export const MAX_EVENT_STREAMS = 8
export const MAX_QUEUED_EVENTS = 256
export const HEARTBEAT_MS = 15_000

/** Subscribes, queues, drops, and tells. Transport-agnostic so it is testable without Hono. */
export function createEventStream(
  subscribe: ControlPlaneRuntime['subscribe'],
  write: (frame: { event: string; data: string } | { comment: string }) => Promise<void>,
  options?: { maxQueued?: number; heartbeatMs?: number; now?: () => number },
): { close: () => void }
```

### Tests (`packages/server/src/sse.test.ts` with a fake `write`; two in `control-plane-app.test.ts`)

| Test name                                                                   | Input                                                              | Expected                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `serialises an event once for all streams`                                  | 3 streams, one event; spy on `JSON.stringify`                      | `stringify` called once; 3 writes                                                       |
| `a slow stream drops the oldest and reports the count when it catches up`   | `write` resolves on demand; emit 300 events while blocked; release | 256 frames delivered with the last 256 payloads, then one `overflow` with `dropped: 44` |
| `a fast stream never sees an overflow frame`                                | `write` resolves immediately; 1 000 events                         | 1 000 frames, no `overflow`                                                             |
| `writes a heartbeat after 15 s of silence and not before`                   | fake clock; advance 14 999 ms then 1 ms                            | no comment, then `: keep-alive`                                                         |
| `a failing write unsubscribes`                                              | `write` rejects                                                    | `unsubscribe` called; no further writes attempted                                       |
| `the ninth stream is refused with 503 and never subscribes` (control plane) | open 8 `GET /events`, then a ninth                                 | ninth: 503, `code: 'too-many-streams'`, `subscribe` call count stays 8                  |
| `a closed stream frees its slot` (control plane)                            | open 8, cancel one, open another                                   | 200                                                                                     |

## F7 — Mock app robustness

### Current behaviour on main

`packages/server/src/mock-app.ts`:

- `:77` `emit(response.status)` runs before `:79-84` builds the response. `:60`
  emits 500 before the 500 body is built (harmless but same shape).
- No `app.onError` in any of the three apps. A throwing `runtime.*` callback
  (`store.write` inside `setState`, `serve.ts:160-163`) answers Hono's text
  `Internal Server Error`.
- `:84` `c.json(body, status)` for any status. `new Response(body, { status: 204 })`
  throws `TypeError` (null-body statuses 101/204/205/304, per the Fetch spec and
  [WPT response-error](https://github.com/web-platform-tests/wpt/blob/master/fetch/api/response/response-error.any.js));
  a status below 200 throws `RangeError`. `ResponseSchema` admits 100-599 with any
  body (NIW2-315 tightens it). So a mock `{ status: 204, body: {} }` **likely** logs
  204 to the panel and answers 500 — **unverified at runtime**; the first test below
  pins whichever it is.
- `delay` (`:66-68`) is bounded by schema (`MAX_DELAY_MS`); client abort is not
  observed.

### Designed behaviour

- `createMockApp` **must** install `app.onError((error, c) => c.json({ error: 'laqi', message }, 500))`.
  `createControlPlaneApp` **must** install the same with `error: 'laqi-control-plane'`
  (the F3 headers still apply because the header middleware wraps `next()`).
  `createPublicApp` inherits the mock app's. The message is `error.message` for an
  `Error`, `'internal error'` otherwise; no stack.
- The request event **must** be emitted exactly once per request, **after** the
  response object exists, with the status that response actually has. On a thrown
  error the event **must** be emitted with 500 by `onError`, unless it was already
  emitted (a per-request flag on `c`).
- A response whose status is 101, 204, 205 or 304 **must** be served with no body,
  whatever the mock declares. A status below 200 (other than 101) **must** answer
  `500 { error: 'laqi', endpoint, message: 'status 1xx cannot be served as a final response' }`
  and log 500.

### Tests (`mock-app.test.ts`)

| Test name                                                                       | Input                                                                                 | Expected                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `a 204 with a body is served as a bodiless 204 and logged as 204`               | mock `{ status: 204, body: { x: 1 } }`                                                | 204, empty body, one `request` event with `status: 204`                                |
| `a 304 with a body behaves the same`                                            | `{ status: 304, body: 'x' }`                                                          | 304, empty body                                                                        |
| `a 1xx mock answers 500 with a message and logs 500`                            | `{ status: 100 }`                                                                     | 500 JSON `error: 'laqi'`, one event `status: 500`                                      |
| `a throwing getState answers the JSON envelope and logs 500 once`               | `getState` throws `new Error('disk')`                                                 | 500 `{ error: 'laqi', message: 'disk' }`; exactly one `request` event, `status: 500`   |
| `the event is emitted after the response exists`                                | `onRequest` spy that records whether the handler has returned (via a promise barrier) | the event fires after `c.json` returned; `ms` ≥ declared `delay`                       |
| server `control-plane`: `a throwing setState answers 500 JSON, not Hono's text` | `setState` throws                                                                     | 500, `content-type: application/json`, `error: 'laqi-control-plane'`, no stack in body |

## F8 — Public 404 lists routes

### Current behaviour on main

`mock-app.ts:126-136` answers every unmatched route with `available: [first 20 ids]`
and `totalEndpoints`. `public-app.ts:126` mounts the same app on the tunnel. With
`--public` (`index.ts:238`, `token: null`) anyone with the URL enumerates the API.

### Designed behaviour

- `MockRuntime` gains `suggestRoutes?: boolean` (default `true`). `createPublicApp`
  **must** pass `suggestRoutes: false`. With it off, the 404 body is
  `{ error, message, method, path }` only.
- The local listener keeps listing: it is the "why is my mock not answering"
  affordance the README describes.

### Tests

| Test name                                                           | Input                                            | Expected                                               |
| ------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| public `the tunnel 404 never lists routes, with or without a token` | token + `GET /nope`; `token: null` + `GET /nope` | 404 bodies have no `available` and no `totalEndpoints` |
| mock `the local 404 still lists up to 20 routes`                    | default runtime, 25 endpoints                    | `available.length === 20`, `totalEndpoints === 25`     |

## F9 — CLI lifecycle

### Current behaviour on main (`apps/cli/src/index.ts`)

- `report()` `:439-517` returns exit code 2 when `loaded === 0 && errors.length === 0`
  (`:452-459`) and 4 when every file failed (`:464-475`). It is shared by boot
  (`:272-280`, correct) and by the watcher's `onChange` (`:286-305`), where a non-undefined
  code closes watcher, tunnel and server and calls `process.exit(reloadExit)` (`:298-303`).
  Deleting the last endpoint in the panel (`serve.ts:214-220` → `project.deleteEndpoint`
  → file rewritten → chokidar → `onChange`) therefore kills the process the panel is
  talking to.
- `onChange` has no `try/catch`; `handle.reload()` → `buildRuntime` → sync
  `readdirSync`/`statSync` on a folder that may vanish mid-walk; a throw inside a
  `setTimeout` callback (`watcher.ts:54`) is an uncaught exception.
- Every panel/MCP-through-HTTP write calls `reload()` directly (`serve.ts:204, 211, 219, 390, 503, 542`)
  and then the watcher sees the file it just wrote and calls `handle.reload()` again
  (`index.ts:292`): two full loads, two `endpoints-changed` events, two start screens.
- `tunnel.ts:97-116` `finish` marks the start settled; `:129-134` the `exit`/`error`
  handlers then do nothing. A cloudflared that dies later leaves `shareUrl` set
  (`serve.ts:625-627`), the band saying EXPOSED, and the goodbye screen claiming a
  URL closed.
- Shutdown handles `SIGINT`/`SIGTERM` only (`:338-339`).

### Designed behaviour

**Reload never exits.**

- `report()` **must** split into `reportBoot` (unchanged: exit 2 / 4) and
  `reportReload`, which **must** return nothing and, for the two empty cases, print a
  `degraded` failure instead of a fatal one:
  - 0 endpoints, 0 errors: headline `./laqi/ has nothing to serve right now`, outcome
    `still listening on :8000 · save a file to retry`;
  - 0 endpoints, N errors: one `degraded` report per error with outcome
    `nothing is being served until this is fixed · still listening`.
- `onChange` **must** be wrapped: a throw from `reload()` prints a `degraded`
  `reload failed` with the error message and keeps the previous runtime; `process.exit`
  **must not** be called from the watcher path.
- The panel already renders the fresh-project screen on 0 endpoints (F9 flow), so an
  empty reload is a visible, recoverable state.

**Reload is idempotent.**

- `buildRuntime` **must** compute `fingerprint: string` — SHA-1 of the canonical JSON
  of `{ endpoints, scenarios, errors }` — on `Runtime`.
- `ServeHandle.reload()` **must** return `{ runtime, changed: boolean }`. When the
  fingerprint equals the current one, it **must not** rebuild the apps and **must
  not** emit `endpoints-changed`; `changed` is `false`.
- `onChange` **must** reprint the start screen only when `changed` is `true`.
- The direct `reload()` calls after writes stay: they are what makes a panel write
  consistent before its HTTP response returns. The watcher's echo becomes the no-op.
  A real edit landing in the same debounce window changes the fingerprint and is
  not swallowed — this is why a "skip the next watcher event" marker was rejected.

**Tunnel death is noticed.**

- `Tunnel` gains `exited: Promise<{ code: number | null; signal: string | null; requested: boolean }>`,
  resolved when the child exits after `start` settled; `requested` is `true` when
  `stop()` asked for it.
- `index.ts` **must** await it in the background: when `!requested`, call
  `handle.setShareUrl(null)` with reason, print a `degraded` failure
  (headline `the tunnel closed`, cause `cloudflared exited with code N`, outcome
  `still serving locally · restart with --share to reopen`), and mark `tunnel = undefined`
  so the goodbye screen does not claim a URL closed.
- `getStatus().share` carries `closedReason` (F2 shape) so the band can say the
  tunnel is gone instead of "opening the tunnel…" forever (panel text is NIW2-316's;
  the field is this ticket's).
- The CLI **must** also handle `SIGHUP` with the same `shutdown`, and register
  `process.once('exit', () => child.kill())` inside the provider so a crash path
  cannot leave cloudflared pointing the internet at a port that another process may
  reuse (cli audit X9; **unverified** that cloudflared outlives the parent today).

### Interfaces (illustrative)

```ts
// apps/cli/src/runtime.ts — illustrative
export type Runtime = { table; scenarios; errors; source; fingerprint: string }

// apps/cli/src/serve.ts — illustrative
reload: () => { runtime: Runtime; changed: boolean }
setShareUrl: (url: string | null, closedReason?: string) => void

// apps/cli/src/tunnel.ts — illustrative
export type Tunnel = {
  url: string
  stop: () => Promise<void>
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; requested: boolean }>
}
```

### Migration

Behavioural: deleting the last endpoint, or a branch switch that empties `laqi/`,
no longer stops laqi. Exit codes 2 and 4 at boot are unchanged. Scripts that relied
on laqi exiting when its folder empties (none known) would need `--once`-style
behaviour that does not exist; not supported.

### Tests

| Test name                                                                                        | Input                                                                                   | Expected                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| cli `index.test.ts`: `a reload that finds no endpoints degrades and keeps serving`               | start with one endpoint; empty the file; wait for the watcher                           | `process.exit` spy not called; stderr contains `nothing to serve right now`; `GET /__laqi/api/status` → `endpointCount: 0`               |
| cli `index.test.ts`: `boot with nothing to serve still exits 2`                                  | empty folder at start                                                                   | exit code 2 (existing behaviour, kept as a regression)                                                                                   |
| cli `index.test.ts`: `a throw inside reload is reported, not fatal`                              | make `buildRuntime` throw once                                                          | stderr `reload failed`; process alive; previous runtime still served                                                                     |
| cli `serve.test.ts`: `a panel write reloads once`                                                | `POST /__laqi/api/endpoints`; count `endpoints-changed` on `/__laqi/events` over 500 ms | exactly one event                                                                                                                        |
| cli `serve.test.ts`: `reload with identical content is a no-op`                                  | `handle.reload()` twice without touching files                                          | second returns `changed: false`; no event; `GET /users` still 200                                                                        |
| cli `serve.test.ts`: `a real edit in the same window is not swallowed`                           | `POST` an endpoint, then within 50 ms write a different endpoint by hand                | both endpoints served; two events                                                                                                        |
| cli `tunnel.test.ts`: `exited resolves with requested:false when cloudflared dies after the URL` | fake spawner emits the URL, then `exit` 1                                               | `exited` → `{ code: 1, requested: false }`                                                                                               |
| cli `tunnel.test.ts`: `exited resolves with requested:true after stop()`                         | `stop()`                                                                                | `{ requested: true }`                                                                                                                    |
| cli `index.test.ts`: `a dead tunnel clears the band and prints a degraded notice`                | provider whose `exited` resolves `{ code: 1, requested: false }`                        | `GET /__laqi/api/status` → `share.url === null`, `share.closedReason` set; stderr `the tunnel closed`; goodbye does not say a URL closed |
| cli `index.test.ts`: `SIGHUP runs the same shutdown as SIGINT`                                   | `process.emit('SIGHUP')`                                                                | watcher, tunnel, server closed; goodbye printed                                                                                          |

## Alternatives considered and rejected

**Keep "any localhost port" for Origin and add a per-session CSRF header the panel
reads from its HTML.** Strongest argument: it is what Jupyter and many local daemons
do, and it would also authenticate curl if the token were printed. Rejected: it
breaks the README's curl flow unless the token is pasted on every call, it is one more
secret the panel has to hold, and it protects against nothing that D1-D3 leave open
for a loopback-only API whose callers are either the developer's browser or the
developer.

**Check the port on `Host` too (exact `host:port` = served authority), as the
partial patch did.** Strongest argument: it makes "the served origin" literally
exact. Rejected: it rejects every SSH / VS Code / Docker port forward that lands on a
different local port, and the port adds no security on `Host` — a rebinding attacker
cannot pick a hostname, which is the whole check. Vite, webpack-dev-server and the
MCP TypeScript SDK's `hostHeaderValidation` are all hostname-only. The port is still
enforced on `Origin`, through byte-equality with `Host`.

**Reject requests with no `Origin` (treat absence as cross-origin).** Strongest
argument: OWASP says a missing header is not evidence of same-origin. Rejected: OWASP
says that for internet-facing apps where the client population is browsers; here the
no-Origin population is curl and scripts run by the developer, and refusing them
turns the control plane into a panel-only API, which the README promises it is not.

**`allowedHosts: true` escape hatch (disable the check), as Vite offers.** Strongest
argument: users stuck behind an unknown proxy get unstuck in one flag. Rejected: it
is exactly the flag the Vite docs warn about, and on a server with a code-execution
route (`module/confirm`) the blast radius is larger than source-code disclosure. A
listed name is always possible instead.

**Terminal only for the share token (drop Reveal / Copy curl from the panel).**
Strongest argument: zero API surface for the secret. Rejected: F7 specifies the band
with Reveal and Copy curl, and a developer who shares from the panel on a shared
screen (the flow's own scenario) is exactly who needs the masked-then-revealed
affordance. A `POST` behind D1-D3 is not a `GET`.

**CSP with nonces via Vite's `html.cspNonce`.** Strongest argument: it is the
documented Vite path and survives a future inline style. Rejected: nonces must be
unique per response, which means templating `index.html` on every request; the
built panel has no inline tags, so `'self'` is enough and the static test keeps it so.

**Rate-limit before auth, but with a separate anonymous bucket.** Strongest argument:
keeps the cheap-reject property for floods. Rejected only in form: D7 keeps a
separate bucket for failed auth, so a flood is still cheap (one comparison and one
map hit), while the owner's quota is untouched.

**Close the slowest SSE stream instead of dropping its events.** Strongest argument:
the client reconnects and refetches, so no overflow protocol is needed. Rejected:
`EventSource` reconnects by default and immediately, which turns a slow consumer into
a reconnect storm; dropping with a signal lets the panel decide.

**Skip-the-next-watcher-event marker to stop the double reload.** Strongest argument:
no extra load at all. Rejected: a human edit in the same window would be swallowed;
the fingerprint costs one load that was already being paid and cannot lose an edit.

**Exit on an empty reload, as today, "because a server with nothing is not a
server".** Strongest argument: consistency with boot. Rejected: the person who
emptied the folder is in the panel, looking at it; the fresh-project screen (F9 flow)
exists precisely for this state.

## Cross-ticket dependencies and file boundaries

| File / area                                                                                                        | This ticket                                                                                                                                                | Other ticket                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/server/src/local-guard.ts` (new), `sse.ts` (new)                                                         | owns                                                                                                                                                       | —                                                                                                            |
| `packages/server/src/control-plane-app.ts`                                                                         | guard, headers, `onError`, caps, `/events`, `POST /api/share/token`, zod bounds                                                                            | NIW2-310 owns the two `module/*` routes (`:756-806`); both tickets touch the file — 310 should rebase on 309 |
| `packages/server/src/public-app.ts`, `mock-app.ts`                                                                 | owns                                                                                                                                                       | NIW2-315 changes what `ResponseSchema` admits (status/headers); no file overlap                              |
| `apps/cli/src/serve.ts`, `index.ts`, `tunnel.ts`, `watcher.ts`, `editor-assets.ts`, `runtime.ts`, `cli-surface.ts` | owns                                                                                                                                                       | NIW2-310 touches `serve.ts` (`prepareModule`/`confirmModule`, `:393-427`); sequence 309 first                |
| `packages/editor/src/components/ShareBand.tsx`, `types.ts` (`Share`), `api.ts` (`revealShareToken`)                | **minimal adaptation only**, in the same PR as F2, because the API shape changes                                                                           | NIW2-316 owns every other editor change (incl. `overflow` resync); must not edit `ShareBand.tsx` in parallel |
| `packages/editor/vite.config.ts`                                                                                   | dev-only companion: `changeOrigin: true` and strip `Origin` on the two proxies (`configure: proxy => proxy.on('proxyReq', r => r.removeHeader('origin'))`) | NIW2-316 informed                                                                                            |
| `packages/schema/src/config.ts`                                                                                    | **not touched** (Open question 2)                                                                                                                          | NIW2-315 decides a config key for `allowedHosts`                                                             |
| `packages/core/src/events.ts`                                                                                      | not touched: `overflow` is an SSE frame, not a `LaqiEvent`                                                                                                 | NIW2-313 owns core                                                                                           |
| `README.md` control-plane and share sections, `apps/cli/README.md`                                                 | document `Content-Type`, `--allowed-host`, the 403/415 codes, the token route, rate-limit change                                                           | —                                                                                                            |
| `hono` version                                                                                                     | none required                                                                                                                                              | NIW2-312 bumps; `bodyLimit` exists on both sides                                                             |

Dependencies: none hard. NIW2-310 (module approval) benefits from F1 landing first
(its `confirm` route inherits D1-D3) and should rebase onto it.

## Rollout and order of implementation

Each step is one PR-sized change with its tests green on its own.

1. **`local-guard.ts` + `admissionRefusal`** as a pure function with the full table of
   Host/Origin/Sec-Fetch-Site/Content-Type tests. No wiring yet.
2. **Wire `localOnly` into `createControlPlaneApp` and `serve.ts`**, add `bodyLimit`,
   invert the two Origin tests, add the end-to-end rebinding test, add `--allowed-host`,
   fix the `dev:hmr` proxy. Update the README's curl examples with `Content-Type`.
3. **Share token out of `/api/status`**: `hasToken`, `POST /api/share/token`,
   `ShareBand` adaptation, tests.
4. **Headers and CSP**: constants, editor-assets headers, API headers, static
   index.html test. Manual check before merge: open the built panel in Chrome and
   Firefox with devtools, run flows F1-F9 (flip, scan, watch, scenario, edit, create,
   share, broken file, fresh project) and confirm zero CSP violations in the console.
5. **Mock app**: `onError`, emit order, null-body statuses, zod bounds (F4, F7), public
   404 (F8).
6. **Tunnel rate limit** order and eviction (F5).
7. **SSE** `sse.ts` + wiring (F6). Tell NIW2-316 the `overflow` frame shape.
8. **CLI lifecycle**: `reportReload`, fingerprint, `exited`, SIGHUP (F9).
9. CHANGELOG entry listing the four user-visible changes (415 on non-JSON bodies,
   `--allowed-host`, `share.token` removal, 429 after thirty bad tokens).

## References

- Vite, `server.allowedHosts` — defaults (`localhost`, `.localhost`, IPs), dot-suffix semantics, warning against `true`: https://vite.dev/config/server-options
- Vite advisory GHSA-vg6x-rcgg-rjx6 / CVE-2025-24010 — DNS rebinding without a Host check; Chrome 94+ PNA note: https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6
- webpack-dev-server CVE-2025-30360 — Origin validation error (IP origins accepted); Host check is the rebinding defence: https://www.wiz.io/vulnerability-database/cve/cve-2025-30360
- MCP specification, transports, Security Warning (validate Origin, bind localhost): https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP TypeScript SDK `hostHeaderValidation` (hostname-only allowlist, `[::1]` with brackets): https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/middleware/hostHeaderValidation.html
- OWASP CSRF Prevention Cheat Sheet — Origin/Referer verification, `Origin: null`, Fetch Metadata resource isolation and the navigation exception, non-simple content types: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Chrome Private Network Access — public non-secure contexts blocked from private addresses since Chrome 94; rollout on hold: https://developer.chrome.com/blog/private-network-access-update
- caniuse `Sec-Fetch-Site` — Chrome 76, Firefox 90, Safari 16.4: https://caniuse.com/mdn-http_headers_sec-fetch-site
- Hono `bodyLimit` middleware: https://hono.dev/docs/middleware/builtin/body-limit; CVE-2025-59139 (fixed 4.9.7): https://db.gcve.eu/vuln/CVE-2025-59139
- Vite, Content Security Policy — `data:` for inlined assets, never in `script-src`, `html.cspNonce`: https://vite.dev/guide/features#content-security-policy-csp
- Fetch spec null-body statuses in WPT: https://github.com/web-platform-tests/wpt/blob/master/fetch/api/response/response-error.any.js
- `*.localhost` resolution: Firefox bug 1220810 (fixed in 84): https://bugzilla.mozilla.org/show_bug.cgi?id=1220810; WebKit 160504: https://bugs.webkit.org/show_bug.cgi?id=160504
- GitHub Codespaces forwarded URL shape (`NAME-PORT.app.github.dev`): https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace
- Project: [ADR-0007 Public URL](/decisions/0007-public-url/) (security list), [ADR-0011 panel SPA](/decisions/0011-panel-plain-react-spa/), [F7 share flow](/design/flows/07-share-publicly/), [JSON Schema adapters spec](/design/json-schema-adapters/) (transport rules for module execution), audit reports `workspace-temp/audits/{server,cli,editor,security-scan}.md`, partial patch `workspace-temp/audits/partial-fixes/fix-control-plane-hardening.patch` (ideas only; its header constants and the shape of `localOnly` are reused, its port check on `Host` is rejected above, and it carried no tests).
