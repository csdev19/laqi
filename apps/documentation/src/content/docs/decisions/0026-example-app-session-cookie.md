---
title: ADR-0026 — The example app's session is a cookie the mock sets, not a token the client stores
---

# ADR-0026 — The example app's session is a cookie the mock sets, not a token the client stores

**Status:** Proposed
**Date:** 2026-10-12
**Ticket:** NIW2-316 — [UI surfaces hardening spec](/design/ui-surfaces-hardening/)

## Context

`examples/todo-app` is the only auth example laqi ships ([examples](/design/examples/)). Its `src/lib/auth.ts` writes the whole session, bearer token included, into a cookie from JavaScript, with no `Secure` and (necessarily) no `HttpOnly`, and reads it back with a cast. The header says it is a frontend mechanism and not security, and in the next sentence says the frontend will not change when the real backend arrives — which is the sentence that makes it copyable. OWASP's Session Management cheat sheet calls `HttpOnly` and `Secure` mandatory for a session identifier and says not to keep tokens in JavaScript-reachable storage.

laqi can set response headers on a mock (`response.headers`), so the mock can set the cookie the way a real server would.

## Decision

**`POST /auth/login` and `POST /auth/signup` in the example set the session with `Set-Cookie: …; HttpOnly; SameSite=Lax; Path=/` (and `__Host-` + `Secure` in the README's production form); their bodies return only the user. The client keeps the non-secret user, validates whatever it parses, and sends no `Authorization` header; the browser carries the cookie. A `POST /auth/logout` mock clears it.**

## Alternatives rejected

**Keep the bearer token in the client and warn loudly.** Strongest argument: many real APIs use `Authorization: Bearer`, and the example would keep teaching that shape with no dependency on laqi's header feature or on NIW2-315's header validation. Rejected as the primary choice because a comment does not stop copying, and a browser-held bearer token in a JavaScript-readable cookie is the pattern OWASP tells people not to build. It stays as the documented fallback if `Set-Cookie` through the mock proves impractical.

**Token in memory only.** Strongest argument: nothing persists. Rejected: a reload signs the user out, which in a real app forces a refresh-token flow the example cannot show without a backend that reasons.

**Token in `sessionStorage`.** Rejected for the same reason as the JavaScript cookie: readable by any script on the origin.

## Consequences

**In favour:**

- The copyable file is the safe one: a team that copies `auth.ts` gets a client that never sees a credential.
- The example demonstrates a laqi capability (response headers) that no other example uses.
- The flip-table rows (`GET /profile → unauthorized` signs out) keep working unchanged.

**Against:**

- The example no longer shows the `Authorization: Bearer` header. The README states the cross-origin variant (`credentials: 'include'`, specific CORS origin, same cookie attributes) in prose.
- Depends on `Set-Cookie` remaining a permitted mock response header (NIW2-315) and on the Vite proxy forwarding it unchanged (expected; verified in the implementing step).
- On `http://localhost` the committed cookie cannot carry `Secure`; the README shows the production form.

## Non-goals

- Making laqi verify a token: a mock answers the same regardless.
- CSRF tokens or a backend-for-frontend; `SameSite=Lax` is the example's whole CSRF story and the README says so.

## Reopen condition

A second auth example (for instance a mobile or cross-origin client that cannot use cookies) that needs the bearer shape. The answer then is a second example, not a change to this one.
