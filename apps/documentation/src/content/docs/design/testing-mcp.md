---
title: "Testing MCP: three layers, and where each one stops"
---

# Testing MCP: three layers, and where each one stops

laqi ships two surfaces over the same state: the control plane at
`/__laqi/api/*` (`packages/server/src/control-plane-app.ts` — plain HTTP,
`GET /api/endpoints`, `POST /api/endpoints`, `PUT /api/state`, and so on) and
the MCP server (`packages/mcp`). Both let a caller list endpoints, flip a
response, create a route. Testing the second one well means testing something
an HTTP API does not have.

## What MCP is, and what is actually different about it

MCP is JSON-RPC over stdio: an agent spawns `laqi mcp` as a child process,
sends `tools/list`, and gets back every tool's name, a prose description, and
a JSON Schema — before it has called anything.

The control-plane routes are not different in _capability_. They are different
in how a caller learns them. `POST /api/endpoints` is documented in a file a
human reads once, in advance, and remembers (or doesn't). `create_endpoint`'s
shape — its name, its parameters, what each one is for, when to reach for it
instead of `update_endpoint` — arrives in the agent's context at
`tools/list` time, every session, without anyone pointing the agent at a
document first. Nothing about `/api/endpoints` prevents an agent from calling
it; the endpoint is just never announced to one.

That is why this repo treats the tool descriptions in `packages/mcp/src/server.ts`
as interface, not documentation beside it. A route that does the right thing
but is badly named would be a bad API. A tool that does the right thing but is
badly _described_ is exactly as bad, for MCP, because the description is the
only thing the agent sees before it decides whether and how to call it.

## Why stdout is the protocol channel

Under `laqi mcp`, stdout carries the JSON-RPC messages the client and server
exchange — nothing else may write there. `apps/cli/src/index.ts` sends its
one startup line to stderr instead, with the reason next to the code:

```ts
// stdout is the MCP protocol channel: nothing can write there except
// the transport. The startup banner goes to stderr.
console.error(`laqi mcp — serving ${root}`)
```

A stray `console.log` anywhere in the dependency graph — a library that logs
on import, a debug line left in during development — inserts a line of plain
text into a stream the client is parsing as newline-delimited JSON. The
client does not see "noisy output"; it sees a message it cannot parse, and
the connection breaks. This is also why `packages/mcp/src/index.ts` repeats
the same rule on `startMcpStdio` itself: it is the one invariant a single
`console.log` anywhere downstream can silently violate, so both the entry
point and the one place that starts the transport say it out loud.

## Layer 1 — unit

The tools in `server.ts` are thin: each one calls into `Project`
(`packages/core/src/project.ts`) and wraps the result. `Project`'s own tests
(`packages/core/src/project.test.ts`, part of `packages/core`'s 136 tests) are
where the actual logic is checked — resolving which response is live across
the three layers, rejecting an unknown response or scenario name with the
declared ones listed, writing a created endpoint to the right file. None of
that needs a subprocess, a client, or even MCP in scope; it is exercised
directly, in-process, against `Project`'s public methods.

This is the cheap, fast layer, and it is where most of the logic actually
lives. If `Project.setResponse` resolves the wrong layer, no amount of testing
the MCP tool on top would be a better place to catch it.

## Layer 2 — protocol

`packages/mcp/src/stdio.test.ts` tests the thing layer 1 cannot: that a real
client, on the real wire, talking to `laqi mcp` as an agent would actually
spawn it, gets the tools it expects and produces the effect it claims to. Each
test:

- spawns `bun apps/cli/src/index.ts mcp` as a real child process, via the
  official `StdioClientTransport` — not a call into `server.ts`'s functions
  in-process;
- points it at a temp directory containing real mock files, written by the
  test itself;
- calls a tool through the real `Client`, exactly as `tools/call` reaches the
  server; and
- asserts on the _effect_, not only the response: `set_response` is checked
  against `.laqi/state.json` on disk (`readFileSync(join(root, '.laqi',
'state.json'))`), `create_endpoint` against the mock file it should have
  written, `generate_data` against the mock file staying byte-identical
  (a preview tool that writes nothing).

Two of its tests already reach past behaviour into content — `advertises
every tool the ADR promises` pins the tool list, and `teaches the layer model
in its instructions, so the agent does not guess` asserts `getInstructions()`
contains the precedence rule and the key format. `packages/mcp/src/tool-descriptions.test.ts`
extends that into a full pass over every tool's description and schema — see
the next section for what it does and does not prove.

## Layer 3 — semantic

"The descriptions are good" has no `expect(...)`. A description can contain
every fact it needs to and still fail to make an agent reach for the right
tool, in the right order, with the right arguments — that is a question about
what a model _does_ after reading the text, and a string match cannot answer
it.

### What the contract tests prove, and what they do not

`packages/mcp/src/tool-descriptions.test.ts` is named and commented as a
**lint, not an evaluation** — on purpose, because a test suite that claimed
otherwise would be lying about what it checks. It asserts:

- every tool has a non-empty description;
- `set_response` and `set_scenario` — the two tools whose effect depends on
  which layer wins — name the precedence rule (`"beats the active
scenario"`), so an agent calling them does not have to have separately read
  and retained the server instructions;
- `set_response` and `set_scenario` both say that an invalid name is rejected
  with the valid ones listed, since that behaviour is real (`project.ts`'s
  `... is not declared on ...  Available: ...`) and a description that still
  promised silence on a bad name would now be describing a tool that no
  longer exists;
- every description stays at or under 500 characters — a paragraph an agent
  reads in a few seconds, not skims once and stops reading; the longest today
  (`set_response`, 451 characters) fits with room to grow, not room to sprawl;
- every parameter in every tool's JSON Schema carries its own `description`,
  because a bare property name is the only thing an agent has to go on
  otherwise.

What none of that proves: that an agent which reads these strings picks the
right tool, infers the right arguments, or produces a mock that actually
matches what was asked for. Presence of a concept in the text is not
comprehension of it — the tests can only check that the ingredients for a
good decision are on the page, not that the decision gets made.

### The real evaluation — not built, and why

A real evaluation would look like this: an agent, given only the tool
descriptions (no README, no prior conversation about laqi's internals, no
hints from this document), a fixed prompt, and a rubric on the transcript and
the result.

**Prompt:**

> Using only the tools available to you, mock `GET /orders` with three
> responses: a paginated list of orders, an empty list, and a 500. Make the
> paginated list the default.

**Rubric:**

- Called `list_endpoints` (or otherwise checked for an existing `GET /orders`)
  before `create_endpoint`, rather than risking a duplicate — this is the
  behaviour `list_endpoints`' own description asks for.
- Used `create_endpoint`, not `update_endpoint` (nothing exists yet) and not
  a raw file edit.
- Declared three responses under sensible names, with the paginated shape as
  `default`.
- The paginated response actually looks paginated — an `items`/`data` array
  plus something like `page`, `total`, or `next`, not a bare array reused for
  all three.
- The empty-list response returns `200` with an empty array, not an error.
- The 500 response has `status: 500` and no invented body the description
  never asked for.
- Did not need to fall back on guessing endpoint-id or path-param syntax —
  `"GET /users/:id"`-style ids and colon path params are stated in every tool
  that takes one.

This is deliberately **not** built into the suite. It needs a live model call,
so it is slow and non-deterministic in a way `tool-descriptions.test.ts` is
not — the same prompt against the same descriptions can reasonably produce a
different transcript on different runs, and a red result does not point at a
line of code the way a failing unit test does. It belongs beside the suite as
a manual check to run before changing a description meaningfully, not inside
`bun run test`, where a flaky, minutes-long, judgment-call test would make the
whole suite less trustworthy rather than more.
