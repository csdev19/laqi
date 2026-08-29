---
title: ADR-0006 — MCP server as a first-class piece
---

# ADR-0006 — MCP server as a first-class piece

**Status:** Accepted
**Date:** 2026-08-24

## Context

laqi v1 was designed for a workflow where the human writes the mocks by
hand. That is no longer the only workflow: today a good part of frontend
work is built with an agent (Claude Code, Cursor) that has the context of
the screen it's building.

When that agent needs an endpoint, it has to open a JSON, guess the schema,
write it and hope hot-reload picks it up. And when you need to see the
error screen, you stop, find the file, change a field and save.

## Decision

**laqi exposes an MCP server** (`packages/mcp`) as a first-class interface,
at the same level as the CLI and the web editor.

Exposed tools:

| Tool              | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `list_endpoints`  | Returns the route table with its available responses                |
| `create_endpoint` | Creates an endpoint with its responses                              |
| `update_endpoint` | Modifies a definition or its responses                              |
| `set_response`    | Changes the active response for a route (writes `.laqi/state.json`) |
| `set_scenario`    | Activates a named scenario                                          |
| `get_state`       | What's active right now and by which layer                          |
| `import_openapi`  | Generates mocks from an OpenAPI spec                                |

## Why

**1. It's the missing writer.**

The full argument is in [the three writers](/concepts/three-writers/). The
MCP is not a bolted-on feature: it's one of the three consumers that define
the format. Designing the format with only the human in mind and adding MCP
afterward would have produced a format hostile to the machine.

**2. It changes what laqi is.**

With MCP, the mock stops being a file you edit and becomes something you
ask for:

> "make `/orders` return 500 with a two-second delay"
> "create the profile endpoint according to this screen's design"
> "activate the empty-cart scenario"

The agent already has the context of the screen. It's the one who best
knows what shape the response should have.

**3. The infrastructure already exists.**

The _control plane_ the web editor needs — listing routes, changing state,
creating endpoints — is exactly what the MCP needs. It's implemented once in
`core` and exposed through three surfaces: CLI, HTTP (editor) and MCP.

## Alternatives considered

**CLI only, letting the agent run commands.** Works halfway: the agent can
run `laqi scenario X`. But to create an endpoint it would have to write the
JSON by hand, without knowing the schema or getting structured validation
errors back. MCP gives it typed tools and errors in return.

**Just let the agent edit the files.** That's what happens today without
MCP. It works, but the agent guesses the schema, doesn't know whether
hot-reload picked it up, and can't change state without dirtying git (see
[ADR-0004](/decisions/0004-state-outside-git/)).

## Consequences

**In favour:**

- The "I build the screen and the fake backend shows up on its own" flow
  becomes real.
- The control plane is shared between CLI, editor and MCP: one
  implementation.

**Against:**

- An API surface to maintain and version.
- How the MCP server is launched has to be decided (`laqi mcp` over stdio
  is the most likely) and the configuration for Claude Code and Cursor has
  to be documented.
- An agent with these tools can write project files. It must be strictly
  scoped to the mocks directory — never outside it (see defect 4.4 in the
  [v1 analysis](/v1-analysis/)).
