---
title: State resolution
---

# State resolution

**Date:** 2026-08-24

How laqi v2 decides **which response to return** when an endpoint has several
declared. It is the successor to v1's `codeResponse` field, and the reason it
exists is in [ADR-0004](/decisions/0004-state-outside-git/).

## The problem

An endpoint declares several possible responses:

```json
{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok":    { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "boom":  { "status": 500, "delay": 2000, "body": { "code": "INTERNAL" } }
    }
  }
}
```

In v1 there was a single place to say which one is active (`codeResponse`,
inside the file), and therefore a single global state for everyone. That
breaks in three scenarios v2 does have to support: a URL shared between
several people, parallel e2e tests, and the web editor changing things live.

## The three layers

From highest to lowest precedence:

```
1. Request header    X-Laqi-Response: boom          ← always wins, touches no state
2. Active state       .laqi/state.json (gitignored)  ← written by the web editor and the MCP
3. Default             "default": "ok" in the mock     ← committed, is the baseline
```

### Layer 1 — Per-request header

```
X-Laqi-Response: boom               forces one specific response
X-Laqi-Scenario: broken-checkout    applies a whole scenario to this request
```

It mutates nothing. It's what makes possible:

- **Parallel e2e tests.** Each test declares the response it needs in its own
  request. No global state to synchronize, no serialized suite.
- **Several people on the same public URL.** You send
  `X-Laqi-Response: boom` from your app and see the 500; the designer, on the
  same tunnel, keeps seeing the 200. In v1 this was impossible.

### Layer 2 — Active state

`.laqi/state.json`, gitignored, auto-created. It's what the web editor and
the MCP change:

```json
{
  "scenario": "broken-checkout",
  "overrides": { "GET /users": "boom" }
}
```

`overrides` (per route) wins over `scenario` (global), because it is more
specific. It persists across restarts: you set up a demo by touching eight
endpoints, close the process, come back, and it's still there.

### Layer 3 — Default

The `default` field inside the mock. Committed. It's what someone sees when
they clone the repo and run `laqi` without having touched anything — the
system's sane, happy state.

## Scenarios

A scenario is a named set of selections that moves several endpoints at
once. It lives in `laqi/scenarios.json` and **is committed**:

```json
{
  "broken-checkout": {
    "POST /orders": "error500",
    "GET /cart":    "empty"
  },
  "new-user": {
    "GET /users/:id/orders": "empty",
    "GET /notifications":    "empty"
  }
}
```

```bash
laqi scenario broken-checkout   # or a click in the editor, or an instruction to the AI
```

Scenarios are the answer to "but I wanted to share my state with the team".
In v1 you shared it **by accident** (committing `codeResponse`); here you
share it **on purpose**, with a name that says what it represents. It's the
same capability, made explicit.

## Traceability: `X-Laqi-Resolved`

The cost of having three layers is the question "wait, why did this return
500?". It's resolved by returning the response in a header, on **every**
response:

```
X-Laqi-Resolved: boom (header)      ← this request asked for it
X-Laqi-Resolved: boom (state)       ← the web editor or the MCP set it
X-Laqi-Resolved: boom (scenario:broken-checkout)
X-Laqi-Resolved: ok (default)       ← nobody touched anything
```

Open devtools and see which layer decided. No guessing, no digging through
files.

## Algorithm

```
resolve(route, request):
    if request has X-Laqi-Response  -> that one,                origin "header"
    if request has X-Laqi-Scenario  -> the scenario's,           origin "header"
    if state.overrides[route]        -> that one,                origin "state"
    if state.scenario                -> the scenario's,           origin "scenario:<n>"
    otherwise                        -> definition.default,       origin "default"

    if the resolved name doesn't exist in responses:
        -> 500 with a body saying exactly which selector was missing
           (NEVER hang the request — see defect C in the v1 analysis)
```

> The layer names are exactly four: `header`, `state`, `scenario` and
> `default`. A scenario requested via header reports `header`, not
> `scenario`, because it persists nothing — and because the panel maps each
> name to a color.

The last line is deliberate: v1's worst bug was that a nonexistent selector
hung the connection. In v2 it's an explicit, noisy error.
