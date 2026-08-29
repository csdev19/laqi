---
title: Mock files
description: The JSON format laqi reads — endpoints, responses, and scenarios.
---

Mocks live either in a `laqi/` folder (any number of `*.json` files, nested
folders allowed) or in a single `laqi.json` file — the folder wins if both
exist. Each file is a JSON object whose keys are `"METHOD /path"`:

```json
{
  "GET /users": {
    "default": "ok",
    "responses": {
      "ok": { "status": 200, "body": [{ "id": 1, "name": "Ada" }] },
      "empty": { "status": 200, "body": [] },
      "error": { "status": 500, "body": { "message": "boom" } }
    }
  },
  "GET /users/:id": {
    "default": "found",
    "responses": {
      "found": { "status": 200, "body": { "id": 1, "name": "Ada" } },
      "missing": { "status": 404 }
    }
  }
}
```

- `default` picks which named response is served when nothing else says
  otherwise.
- Each response can set `status`, `body`, `delay` (ms), and `headers`.
- `:param` segments in a path are dynamic — `/users/:id` matches
  `/users/42`.

## Scenarios

A `scenarios.json` file at the top of the `laqi/` folder maps a scenario
name to a set of endpoint → response-name overrides, so one action moves
several endpoints at once:

```json
{
  "checkout-broken": {
    "GET /cart": "empty",
    "POST /checkout": "error"
  }
}
```

Activate it from the panel, the command line, or an AI agent over MCP —
see [The control panel](/docs/panel/) and
[Using laqi with AI agents](/docs/ai-agents/).

## How a response gets picked

Every request checks four layers, in this order — the first one that
applies wins. This is the same model covered in more depth on
[Resolution layers](/docs/concepts/resolution-layers/):

1. **header** — an explicit `X-Laqi-Response: <name>` on the request.
2. **state** — a per-endpoint override, set from the panel, the API, or
   an agent, persisted to `.laqi/state.json`.
3. **scenario** — the currently active scenario, if it covers this route.
4. **default** — the endpoint's own `default` key. Always available, so a
   fresh project with no state has something to serve from the first
   request.

Every response carries an `X-Laqi-Resolved: <name> (<layer>)` header
naming which one decided it.
