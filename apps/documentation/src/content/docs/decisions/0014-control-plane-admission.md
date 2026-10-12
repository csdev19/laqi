---
title: ADR-0014 — The control plane admits requests by the name they used, not the socket they arrived on
---

# ADR-0014 — The control plane admits requests by the name they used, not the socket they arrived on

**Status:** Proposed
**Date:** 2026-10-12
**Spec:** [Control-plane hardening](/design/control-plane-hardening/) (NIW2-309)

## Context

The panel and the control plane (`/__laqi/*`, including the SSE stream) are mounted
only when laqi listens on a loopback address, and the design has so far treated that
binding as the protection: nothing on the network can reach `127.0.0.1:8000`.

A browser on this machine can. Any website can make the browser send a request to
`http://evil.example:8000` and, if `evil.example` resolves to `127.0.0.1` at that
moment (DNS rebinding), the request lands on laqi's socket, same-origin with the
attacker's page, with every `GET` readable — mocks, state, the live request stream,
and until this change the `--share` bearer token. Chrome 94+ blocks this from public
non-secure pages (Private Network Access); Firefox and Safari do not, which is why
Vite shipped `server.allowedHosts` in January 2025 after
[CVE-2025-24010](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6).
The MCP specification makes the same demand of every local HTTP server.

Writes were guarded by an `Origin` allowlist, but one that accepted any
`http://localhost:*` origin and parsed JSON from `text/plain` bodies — so a
compromised dependency in the frontend on `localhost:3000` could rewrite the
developer's mock files without a preflight.

The control plane has no authentication and the README promises it stays usable
from `curl`.

## Decision

Admission to everything under `/__laqi` is decided by headers the attacker cannot
choose, in three independent layers, with no secret:

1. **Host allowlist, every method.** The `Host` hostname must be a loopback name
   (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`) or a name the developer
   listed with `--allowed-host`. Hostname only; the port is not checked.
2. **Exact served origin, every method.** When `Origin` is present, its authority
   must be byte-equal to the request's `Host` (scheme `http` or `https`). `null`
   is rejected. On `GET` this matters for `/events`.
3. **Writes need two more signals.** `Sec-Fetch-Site` must be `same-origin`, `none`
   or absent; a body must be `application/json` and at most 8 MiB.

A request with no `Origin` and no `Sec-Fetch-Site` is admitted. Every browser sends
`Origin` on a cross-origin request and every browser that implements Fetch Metadata
sends `Sec-Fetch-Site`; a request with neither is not a browser, it is the developer
running `curl`.

There is no per-session token, cookie or custom header requirement.

## Why

**The name, not the socket.** The one thing a rebinding page cannot control is the
`Host` the browser writes: it is the name the page used. A loopback name or an IP
literal is never looked up, so it cannot be rebound. This is the same reasoning as
Vite's, webpack-dev-server's and the MCP TypeScript SDK's `hostHeaderValidation`,
and all three are hostname-only.

**Why not the port on `Host`.** A different local port on a loopback name means a
port forward (SSH, VS Code, Docker), which is the developer's own doing. The port
adds nothing against rebinding and would reject those users. The port is enforced
where it matters, on `Origin`, by requiring equality with `Host`.

**Why the exact origin and not "any localhost".** `localhost:3000` is another
program. The developer's trust in laqi does not extend to every dependency of every
dev server on the machine. "Same authority as Host" is the narrowest rule that still
works for a port-forwarded panel.

**Why `Content-Type: application/json` is a security control.** A browser sends a
cross-origin `POST` with `text/plain` without asking; with `application/json` it must
preflight, and the control plane answers no preflight. So even if the two header
checks were wrong, the body could not be delivered. OWASP lists this under custom
headers and non-simple content types.

**Why no secret.** A session token would have to be pasted on every `curl` call or
the README's control-plane section becomes false. Local processes that could obtain
the token are the developer; they can edit the files directly. The layers above
already close every browser path.

## Alternatives rejected

- **Per-session CSRF header injected into the panel's HTML** (Jupyter's model).
  Breaks scripting, holds a second secret in the panel, closes nothing more.
- **Exact `host:port` on `Host`** (the partial patch). Rejects port forwards for
  no gain.
- **Treat a missing `Origin` as cross-origin.** Turns the API panel-only.
- **`--allowed-host true` to disable the check** (Vite offers it). With a
  code-execution route on this server, the blast radius is larger than source
  disclosure; a listed name is always possible.
- **Rely on Chrome's Private Network Access.** Firefox and Safari users are the
  ones exposed.

## Consequences

**In favour:**

- Rebinding fails on every route, SSE included, with a 403 that names the host and
  the flag that would allow it.
- Writes come only from the panel's own origin or from non-browser clients on this
  machine.
- `curl`, scripts and the in-process MCP keep working unchanged, except that a body
  must say it is JSON.

**Against:**

- `curl -d` without `-H 'Content-Type: application/json'` now gets 415. The README
  examples change; so do any user scripts.
- Developers behind a proxy that keeps the public `Host` (Codespaces, Gitpod) must
  pass `--allowed-host`. The 403 message tells them.
- Browser code on another local origin can no longer drive the control plane. No
  documented use exists; reopen on a report.
- `localhost:5173` HMR development needs the Vite proxy to rewrite `Host` and drop
  `Origin`.

## Non-goals

- Authenticating the control plane. It stays loopback-only and unauthenticated.
- Guarding the mock routes. They serve phones and tunnels and answer any `Host`.
- Private Network Access / Local Network Access preflights.

## What would reopen this

- A browser that ships cross-origin writes without `Origin` and without
  `Sec-Fetch-Site`. Then the no-Origin admission has to go, and the control plane
  needs a token.
- A supported, documented use of the control plane from another local origin. Then
  an `--allowed-origin` list, not a return to "any localhost".
- A control plane reachable off-machine by design (a phase-2 relay with an
  authenticated panel). Then admission is authentication, and this ADR is
  superseded.
