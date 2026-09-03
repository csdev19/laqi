---
title: "WebSocket mocking — the design questions, before the plan"
description: What mocking a socket would mean in laqi's model, the two questions that have to be answered first, and the options for each.
---

# WebSocket mocking

**Status: design, not decided. No plan exists and none should be written until
the two questions below are answered.**

The roadmap commits to the direction — _"mock socket connections, not just
request/response"_ — and to the reason it is not planned yet: _"design
questions to settle first: what 'resolution layers' mean for a stream, and
whether the declarative JSON format stretches to message sequences or needs a
new shape."_ This document is those questions, written out with the real
options, so the answer can be argued rather than improvised inside an
implementation.

## What the feature is

Declare a WebSocket endpoint in the mock files the way HTTP endpoints are
declared today. Script named message sequences the way responses are named
today. Push events manually from the panel — and via MCP — to drive a
connected client into any state.

The frontend use case is the same one laqi already serves for HTTP: the
backend does not have the socket yet, and the client needs to meet the
"connection dropped" state, the "server pushed an error mid-stream" state, and
the "twenty messages arrive at once" state, on demand, without a backend.

## What already exists, and what does not

Checked against the code rather than assumed.

**Exists.** `packages/server` runs Hono over `@hono/node-server`. The control
plane already streams to the panel over SSE (`/__laqi/events`), and
`packages/core`'s `EventBus` is a general in-memory bus with `emit` and
`subscribe`. `packages/schema` validates every mock file with zod, so a new
declaration shape is a new schema and a new writer, not a new parser. The panel
already renders a live, capped log of a server-pushed stream.

**Does not exist.** Any WebSocket code at all. No dependency provides one:
`apps/cli`'s published dependency list is `@faker-js/faker`, `@hono/node-server`,
`chokidar`, `effect`, `hono`, `quicktype-core`, `typescript`, `zod`, and
`apps/cli/src/package.test.ts` asserts that list exactly. Node 20 has no
server-side `WebSocket`; `ws` or `@hono/node-ws` would be the first new runtime
dependency laqi has taken since v2.

**Adjacent but not reusable.** The panel's SSE plumbing is one-directional,
server-to-panel, on the control plane — which is deliberately _off_ the tunnel
(ADR-0007). A mock WebSocket is bidirectional, on the mock listener, and
therefore inside the surface `--share` exposes. Borrowing the transport would
mean borrowing the wrong security posture.

## Question 1 — what does a resolution layer mean for a stream?

Today, `resolveResponse` picks exactly one named response per request, from
four layers in precedence order (`packages/core/src/resolve.ts`):

| Layer      | Set by                                                    | Lifetime                   |
| ---------- | --------------------------------------------------------- | -------------------------- |
| `header`   | `X-Laqi-Response` / `X-Laqi-Scenario` on the request      | that request only          |
| `state`    | a per-endpoint override, from the panel or `set_response` | until cleared              |
| `scenario` | the active scenario                                       | until the scenario changes |
| `default`  | the endpoint's own `default`                              | always                     |

Every layer answers the same question: **which named thing is live right now?**
For a request that is unambiguous — the request arrives, one response is
chosen, the exchange ends. A socket does not end. That breaks the model in a
specific place, and there are three coherent ways to repair it.

### Option A — resolve once, at connect

The layers pick a named **sequence** when the client connects, exactly as they
pick a named response when a request arrives. The connection then plays that
sequence to the end.

- _For:_ the model is unchanged. `state` beats `scenario` beats `default`, the
  panel's existing chips and the `set_response` MCP tool work with no new
  vocabulary, and `X-Laqi-Response` works on the handshake request because the
  handshake **is** an HTTP request.
- _Against:_ flipping a scenario does nothing to a client that is already
  connected. In a tool whose whole promise is "flip it and watch the frontend
  react", that is the wrong behaviour in the most common demo. It would have to
  be paired with a rule about reconnection, and "close the socket so the client
  reconnects and re-resolves" is a real answer, but it is a decision, not a
  detail.

### Option B — resolve continuously

The active sequence is re-read whenever the layers change. Flipping a scenario
switches what a live connection is playing, mid-stream.

- _For:_ it matches what people expect from the panel, and it is the only
  option where the live-flip demo works on a socket.
- _Against:_ it needs an answer for "switched to a new sequence — start from
  its first message, or from the same index?", and every answer is wrong for
  some case. It also makes a connection's observable behaviour depend on
  timing, which is the property that makes bugs unreproducible.

### Option C — layers resolve the connection, the panel drives the messages

The layers pick the sequence at connect (Option A), and the panel's manual push
is the mechanism for changing a live connection — not the layers. Flipping a
scenario affects the next connection; pushing a message affects this one.

- _For:_ each mechanism does one thing, and neither is ambiguous. It also
  matches how the feature was described in the roadmap: sequences _and_ manual
  pushes were named as two separate affordances.
- _Against:_ two mental models for "make something happen" instead of one.

**No option is chosen here.** Option C looks strongest — it is the only one
that does not either break the live-flip promise or make behaviour
timing-dependent — but this needs to be argued against a real client, not on
paper. See "How to answer these" below.

## Question 2 — does the declarative format stretch, or does it need a new shape?

Today an endpoint is a map of named responses, each a flat object
(`ResponseSchema`: `status`, `body`, `delay`, `headers`, `description`). A
sequence is a _list over time_, which the shape has no room for.

### Option A — a sequence is a list of messages, and that is all

```json
{
  "WS /notifications": {
    "default": "busy",
    "sequences": {
      "busy": [
        { "delay": 0, "data": { "type": "connected" } },
        { "delay": 500, "data": { "type": "notification", "title": "New order" } },
        { "delay": 500, "data": { "type": "notification", "title": "Refund" } }
      ],
      "drops": [
        { "delay": 200, "data": { "type": "connected" } },
        { "delay": 1000, "close": { "code": 1011, "reason": "server error" } }
      ]
    }
  }
}
```

- _For:_ it is the smallest thing that could work, it reuses `delay` with the
  meaning it already has, and `laqi migrate` has an obvious job. The generators
  already produce a `data` body from a pasted model.
- _Against:_ no loop, no branch, no reaction to a client message. A sequence
  that cannot respond to what the client sends is a recording, not a mock — and
  the first thing anyone will try is "when the client sends `subscribe`, start
  pushing".

### Option B — the list, plus a reaction map

Adds `on`: keyed by something in the client's message, valued as a sequence.
Answers the "when the client sends X" case without inventing a scripting
language.

- _For:_ covers the case Option A cannot, with one new key.
- _Against:_ "keyed by something in the client's message" is doing a lot of
  work. Keying on a JSON pointer, a `type` field by convention, or a regex over
  the raw frame are three different products, and the wrong choice here is the
  kind that is hard to walk back once mock files exist in people's repos.

### Option C — a separate file type

`laqi/*.ws.json` with its own schema, its own writer, and no attempt to fit the
HTTP shape.

- _For:_ honest. A stream is not a request, and forcing one schema over both
  produces a schema that is bad at both.
- _Against:_ two formats, two writers, two validators, two sets of
  documentation. ADR-0008 already ruled on multi-file layout and naming for the
  HTTP case; this would need to be argued against it rather than alongside it.

## Constraints any answer inherits

These are not open, and a design that violates one is wrong regardless of how
well it answers the questions above.

- **The four resolution layers keep their meaning for HTTP.** Whatever a layer
  means for a socket, `resolveResponse` for requests does not change.
- **The panel stays off the tunnel.** A mock WebSocket lives on the mock
  listener and is therefore inside what `--share` exposes — behind the bearer
  token, with the same rate limiting, and `/__laqi/*` still 404s there
  (ADR-0007). A socket that bypasses the token is a hole, and sockets are
  harder to rate-limit than requests: the budget is connections and messages,
  not requests per minute.
- **Hot reload has to mean something.** Editing a sequence while a client is
  connected must have defined behaviour. "Nothing until reconnect" is an
  acceptable answer; "undefined" is not.
- **The published dependency list is asserted by a test.** Adding `ws` or
  `@hono/node-ws` is a deliberate act that changes `apps/cli/src/package.test.ts`
  and belongs in an ADR, not in a task.
- **`@laqi/schema` stays browser-safe.** The panel imports it; a `node:` import
  there breaks the panel build.
- **Mock files stay hand-writable.** The format is something a person edits in
  an editor without laqi running. Any shape that only a generator can produce
  has failed.

## What is deliberately not in scope

- **Socket.IO, or any framing protocol above raw WebSocket.** Its handshake and
  packet format are a separate product. If it comes, it comes after.
- **Recording a real socket and replaying it.** Adjacent and tempting, and a
  different feature with a different design.
- **Server-sent events as a _mockable_ endpoint type.** The panel uses SSE
  internally; that is not the same as offering SSE mocks. Worth its own note,
  not this one.

## How to answer these

Two questions, and neither is answerable by more writing.

1. **Build a throwaway spike**, on a branch that is never merged: one hardcoded
   WS endpoint, one sequence, a real browser client connecting to it. It exists
   to answer Question 1 by observation — connect a client, flip a scenario, and
   see which of A/B/C produces behaviour a person would predict.
2. **Write three real mock files by hand**, in Option A's shape, for three
   cases someone would actually mock: a notification feed, a chat with an echo,
   and a connection that drops mid-stream. The one that cannot be expressed
   answers Question 2 — and if all three can, that is the finding.

Then: an ADR recording the two decisions and the dependency, an update to this
document with the answers, and only then a plan.

## Reopening condition

If a WebSocket mock arrives as a request from an actual user with an actual
socket, that request is better evidence than this document, and both questions
should be reopened with it in hand.
