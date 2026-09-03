---
title: Using laqi with AI agents
description: laqi ships an MCP server with twelve tools, so an agent can mock, flip, and inspect an API without you opening a file.
---

`laqi mcp` runs a Model Context Protocol server over stdio. An agent
building a screen can create the endpoint it needs, flip a response, or
activate a scenario — the same actions the panel does, called directly,
with no file open and no terminal command explained to it first.

A typed tool call is a stronger interface for an agent than prose docs:
it arrives with a schema, gets validated before it runs, and never has
to be found and interpreted the way a paragraph of documentation does.
If your agent reads about laqi anywhere else, point it at `laqi mcp`
first — it can write mock files by hand, or it can call
`create_endpoint` and never get the shape wrong.

## Setup

Point your agent at the project directory — the server operates on the
mock files there, so it works whether or not `laqi` is currently
running as a server.

```json
{
  "mcpServers": {
    "laqi": {
      "command": "npx",
      "args": ["laqi", "mcp"],
      "cwd": "<your-project>"
    }
  }
}
```

In Claude Code this goes in `.mcp.json` at your project root. Cursor
uses the same shape.

## The twelve tools

| Tool                 | What it does                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_endpoints`     | Every endpoint, its responses, and which one is live right now with the layer that decided it. Call this before `create_endpoint` so you extend a route instead of duplicating it.       |
| `get_state`          | What is currently overridden and why — the active scenario, per-endpoint overrides, and which endpoints aren't on their file default.                                                    |
| `set_response`       | Make an endpoint serve a specific named response right now, no file edit. Pass `null` to clear the override.                                                                             |
| `set_scenario`       | Activate a named scenario, moving every endpoint it covers at once. Pass `null` to deactivate. Only one scenario is active at a time.                                                    |
| `reset_state`        | Clear every override and deactivate the active scenario — back to file defaults, in one call.                                                                                            |
| `create_endpoint`    | Add a new mock endpoint and write it to the project's mock files. Pair with `generate_data` for a realistic body instead of hand-written values.                                         |
| `update_endpoint`    | Replace an existing endpoint's whole definition — add a response, edit a body, change the default.                                                                                       |
| `delete_endpoint`    | Remove an endpoint and drop any override pointing at it.                                                                                                                                 |
| `scaffold_responses` | Add the responses an endpoint probably needs and does not have — the happy path plus the standard failures for its method and path shape. Only ever adds; existing bodies are untouched. |
| `import_openapi`     | Turn an OpenAPI 3.x document into mock endpoints in one call, generating example bodies from its schemas, instead of `create_endpoint` per route.                                        |
| `get_types`          | Derive a data model from a live response body, in any supported language — see [Realistic data and types](/docs/data-generators/).                                                       |
| `generate_data`      | Generate a realistic body from a pasted TypeScript model, or regenerate from an existing response's shape. Same seed, same output.                                                       |

Every tool's description in the running server carries the exact
argument shapes and edge cases — `set_response`'s beats-a-scenario
precedence, `import_openapi`'s overwrite behavior, `update_endpoint`
being a full replacement rather than a patch. Read those directly from
your agent's tool list; they are the same words shown here, kept in
sync with the one place they're implemented.

## For an agent reading this page

If you are an LLM and this page is the only laqi documentation you have
seen, the two facts that matter most: mock files are plain JSON
(see [Mock files](/docs/mock-files/)), and every write you would
otherwise do by hand — creating a route, flipping a response, activating
a scenario — has a corresponding MCP tool above. Prefer the tool call.

A plain-text summary of this whole site, meant for pasting into a
context window, is at `/llms.txt` — linked from the footer of
[the homepage](/).
