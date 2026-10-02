---
title: The backend handoff — what happens when the real API arrives
description: The objection laqi.dev leaves standing, the answer the example app already implements, and the argument against building a proxy into laqi.
---

# The backend handoff — what happens when the real API arrives

**Status:** Draft spec. One product decision is open; the recommendation is
**do not build it**.
**Date:** 2026-10-01
**Produced by:** [the 2026-10-01 page audit](/product/page-audit-2026-10-01/),
finding P3.

## In one minute

Nothing on laqi.dev — landing or docs — answers the question every team lead asks
before adopting a mock server: _what does it cost us when the backend is finally
ready?_ That silence is the strongest unanswered objection on the page.

The answer turns out to be very good, and it is already implemented and running
in this repository. `examples/todo-app` reaches laqi through a Vite dev proxy, so
the switch to a real backend is one environment variable and **zero changes to
application code**. Nobody wrote it down.

That same proxy also means the partial case — some endpoints real, some still
mocked — is already expressible today, with no laqi feature at all.

### Decisions

| Decision                                                                           | Why                                                                                                      | ADR                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------- |
| The site answers the handoff explicitly — landing section plus a docs page         | It is the top adoption objection and the answer is strong; leaving it unsaid is pure loss                | none                          |
| The recommended integration shape is a dev-server proxy, not a hard-coded base URL | It is what `examples/todo-app` already does, and it makes the handoff a config change, not a code change | none                          |
| laqi does **not** gain a proxy / passthrough / hybrid mode                         | The dev server already has one. See the argument below                                                   | proposed ADR-0014 if accepted |
| The handoff claim is demonstrated by performing it in `examples/todo-app`          | Mechanism proven in-repo, with no customers required                                                     | none                          |

### Open question — blocking the ADR only

Does laqi ever need its own proxy? The recommendation below is no, and the
reasoning is strong enough to write an ADR against it — but an ADR that closes a
door should be opened by the author, not by an audit. Decide, then write it.

### Out of scope

Final landing copy (blocked on [Positioning](/design/positioning/) question 1),
and WebSocket mocking, which has its own open design.

---

## What the page says today

Nothing. A search across all of `apps/site/` returns no section, page or sentence
about migrating from the mock to the real API.

The visitor is therefore left to assume the worst available answer: that laqi is
a fork in the road, that mock files rot, and that someone will spend a sprint
undoing it. For a lead evaluating this for six people, that unasked question is
usually where the evaluation ends.

## What the product actually does

### The switch is an environment variable

`examples/todo-app/src/lib/api.ts:8` sets the client's base to `/api` and never
names a host:

```ts
const BASE = '/api'
```

`examples/todo-app/vite.config.ts:5` and `:22` route that prefix to laqi through
the dev server, with the target read from the environment:

```ts
const LAQI = process.env.LAQI_URL ?? 'http://127.0.0.1:8000'
// ...
proxy: {
  '/api': { target: LAQI, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
}
```

So the full handoff, the day the backend ships, is:

```sh
LAQI_URL=https://api.staging.example.com bun dev
```

**No application file changes.** Not one. The page currently promises "change one
base URL" (`QuickStart.astro:60`) and even that overstates the work in the shape
the example recommends.

### The app is already written for the real backend

`examples/todo-app/src/lib/api.ts:29-31` attaches the production auth header on
every request, and says why:

> The production shape: the token travels on every request. laqi ignores it, but
> the day there's a real backend this is already in place.

And `:33-37` deliberately refuses to send `X-Laqi-Response` from application
code, keeping laqi's highest-precedence layer out of the app entirely. There is
no laqi-specific code to remove at the end, because none was written.

**This is the strongest adoption argument the product has, it is implemented, it
is commented, and it appears nowhere a visitor will see it.**

### The partial case already works

A team mid-migration needs some endpoints real and some still mocked. The Vite
proxy table expresses that today:

```ts
proxy: {
  '/api/auth':  { target: 'https://api.staging.example.com', changeOrigin: true },
  '/api':       { target: LAQI, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
}
```

Endpoints move to the real backend one line at a time, and laqi keeps serving
whatever is left. Next.js rewrites, Angular's `proxy.conf.json`, Expo and a
plain nginx in front of a native app all have the same capability.

## The product decision: should laqi gain a proxy?

The audit found no proxy, passthrough, upstream or fallthrough anywhere
(`grep` over `packages/server/src`, `packages/schema/src/config.ts`,
`apps/cli/src/serve.ts` returns only a CORS preflight comment). The obvious
instinct is to add one. Three options:

**1. Build an upstream proxy into laqi.** A config key naming a real backend;
unmatched routes — or routes explicitly marked — forward to it.
_Implications:_ laqi becomes the single endpoint for the whole migration, and
the request log would show real and mocked traffic side by side, which is
genuinely attractive.
_Strongest argument against:_ it duplicates a capability every frontend dev
server already ships, and it drags laqi across a line it has stayed behind
deliberately. The moment laqi forwards a request to production, it is on the
path of real traffic and real credentials: it needs a story for auth headers,
cookies, TLS, retries, timeouts and redaction in the request log. ADR-0007's
whole posture — the control plane is not merely protected but structurally
absent from the public listener — exists because laqi refuses to be in the way
of anything real. This feature puts it in the way by design.

**2. Build nothing; document the proxy pattern.** Make the dev-server proxy the
recommended integration shape, on the landing and in a docs page, with the
partial-migration table shown.
_Implications:_ zero new code, zero new surface, and the strongest claim on the
page becomes true today rather than next quarter.
_Strongest argument against:_ it does not work for clients with no dev server —
a physical phone pointed straight at `http://192.168.1.x:8000`, React Native,
curl. For those, the migration really is "repoint the URL", and a hybrid state
is not expressible. That is a real gap, and it is narrower than it looks: those
clients are the ones already pointing at a single configurable host.

**3. Defer, and decide on evidence.** Document the pattern now (option 2) and
revisit if real users ask for the hybrid case on a non-browser client.
_Implications:_ the page ships honest today, and the decision is made by demand
instead of by instinct.
_Strongest argument against:_ "defer" quietly becomes "never", and nobody will
notice the gap because there are no users to complain yet.

**Recommendation: option 2, with option 3's reopen condition written down.**
laqi's defensible position is that it is a server you point at and a panel you
click, and that it is never on the path of anything real. The proxy is the single
feature most likely to erode that. Document the pattern, make the handoff the
page's closing argument, and reopen if a non-browser user asks twice.

If this is accepted, it is worth an ADR — a later reader will certainly ask why a
mock server has no passthrough, and "the dev server already has one" is the kind
of reasoning that evaporates if it is not written down.

## What ships on the site

### A landing section, after `ResolutionLayers`

One section, with a single persuasive job: remove the exit objection. It is
placed after the mechanism is understood and before the feature grid, because it
is an argument about the end of the story and only lands once the middle is
clear.

Content, all of it mechanism and all of it defensible today:

- The contract is agreed once, with the backend team, and both sides build
  against it. (This is finding P4 — currently a feature card.)
- The frontend talks to `/api`; the dev server decides what is behind it.
- When the real endpoint lands, it is one line of proxy config, per endpoint.
- Nothing laqi-specific was written into the app, so nothing has to be removed.

What this section must **not** contain: a number, a sprint count, a claim about
integration effort saved, or anything attributed to a team. See the audit's
decision gate.

A before/after diagram belongs here if one is drawn — with the note from the
audit's finding A4 that it **explains** and does not **prove**.

### A docs page: `/docs/going-to-production/`

Longer form, under a new sidebar group after "Core workflow":

1. The recommended shape — `/api` plus a dev-server proxy — with Vite, Next.js
   and Angular examples, and the plain-URL shape for phones, React Native and
   curl.
2. Moving one endpoint at a time, with the two-entry proxy table.
3. What to do with the mock files afterwards: keep them. They are the test
   fixtures for the error states the real backend still will not produce on
   demand. This is the argument that stops laqi being a tool you uninstall.
4. The honest limit: on a client with no dev server, the migration is
   all-or-nothing per host.

## The evidence to generate

The claim "the switch costs nothing" is a mechanism claim, so it can be proven
in this repository without a single customer. Perform it:

1. Stand up a minimal real backend for `examples/todo-app` — any Hono app
   serving the same contract is enough.
2. Run the app against it with `LAQI_URL=` pointed at that backend.
3. Record the diff. The expectation, from reading the code, is that it is empty
   outside configuration.
4. Record the partial state too: auth real, todos still mocked.

If the diff turns out not to be empty, that is a more valuable finding than the
page section, and this spec is wrong in a way worth knowing before publishing it.

This is task 1 of whatever plan implements this document. The copy is written
after the diff exists, not before.
