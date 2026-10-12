---
title: ADR-0015 — The share token is never returned by a GET
---

# ADR-0015 — The share token is never returned by a GET

**Status:** Proposed
**Date:** 2026-10-12
**Spec:** [Control-plane hardening](/design/control-plane-hardening/) (NIW2-309)

## Context

`laqi --share` generates a bearer token that is the only thing standing between the
internet and the developer's mocks ([ADR-0007](/decisions/0007-public-url/), item 1).
The terminal prints it at startup (item 5). The panel also shows it, masked, in the
magenta band with `Reveal token` and `Copy curl` ([F7](/design/flows/07-share-publicly/)).

To feed the band, `GET /__laqi/api/status` returned `share.token` to any admitted
caller, with the comment "it's local-only and it's where the developer is going to
copy it from". The status endpoint is polled by the panel on every refresh. The
audit showed that a DNS-rebinding page could read it; the admission ADR closes that
path, but the token would still be the payload of a routine, cacheable `GET` — one
admission bug, one same-origin XSS in the panel, or one screenshot of the Network tab
away from the internet.

## Decision

- `GET /__laqi/api/status` reports `share.hasToken: boolean` and never the token.
- The panel obtains the token only when the developer clicks `Reveal token` or
  `Copy curl`, through `POST /__laqi/api/share/token`, which answers
  `Cache-Control: no-store` and is subject to every write-admission rule (exact
  origin, `Sec-Fetch-Site`, no cross-origin preflight ever granted). The panel drops
  the value when the band hides it again. The mask is a fixed `lq_••••••••••••`.
- The terminal remains the primary disclosure, unchanged.

## Why

A secret should be the result of an action, not a side effect of a poll. A `POST`
that returns the secret is reachable only by a same-origin page or a non-browser
client on this machine, and is never cached. The F7 flow — reveal on a shared
screen, copy a ready `curl` — survives intact, which the stricter alternative does
not.

## Alternatives rejected

- **Terminal only; the band says "printed in your terminal".** Zero API surface for
  the secret, but it deletes the Reveal / Copy curl affordances F7 designs for the
  exact situation where the panel is on a shared screen.
- **Keep it in `/api/status` now that rebinding is closed.** Defence in depth is
  the point: the token is the one credential that works from outside the machine.
- **Embed the token in the panel's `index.html`.** Same exposure as a `GET`, plus a
  cacheable document.
- **A `GET /api/share/token` with the same admission rules.** Admission is the same,
  but a `GET` is cacheable, prefetchable and linkable; a `POST` is none of those.

## Consequences

**In favour:** no `GET` under `/__laqi` carries a secret; a bug in admission or in
the panel degrades to mock disclosure, not tunnel takeover.

**Against:** `share.token` disappears from `/api/status`; any script that read it
moves to the `POST` or the terminal. `ShareBand` changes shape (`hasToken`, a fixed
mask, a fetch on click), which is a small panel change this ticket carries.

## Non-goals

- Rotating the token, `--token-file`, or accepting it anywhere but the
  `Authorization` header. Separate concerns.
- Hiding the token from the terminal. ADR-0007 item 5 requires it there.

## What would reopen this

A panel that authenticates its own session (a phase-2 relay with login). Then the
token belongs to the session, and whether the panel may show it is a session
question, not a transport one.
