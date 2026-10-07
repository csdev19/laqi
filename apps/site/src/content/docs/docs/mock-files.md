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

## Duplicate keys

**Within one file, a repeated key is dropped without a warning.** If a file
declares `"GET /users"` twice, laqi serves the **last** one and never sees the
first: the JSON parser keeps one value per key before laqi reads the file. The
same applies to any repeated key inside an endpoint, such as two responses
with the same name.

**Across files, the same endpoint is an error.** With a `laqi/` folder, if
two files both declare `"GET /users"`, laqi reports the collision with both
file names and serves neither until one is removed or renamed.

## Numbers, dates and other values

A body is served as the JSON value the file holds. Strings, `null`, booleans,
empty objects and arrays, key order, emoji and escapes all reach the client
unchanged.

- **Dates are strings in JSON**, and laqi serves them exactly as written:
  `"2026-10-06T09:30:00-05:00"` keeps its offset. laqi never converts them.
- **Numbers keep their value, but not their spelling.** `1.50` is served as
  `1.5` and `1E+21` as `1e+21`. Every JSON client reads those as the same
  number.
- **Integers larger than 2^53 (9007199254740991) cannot be carried exactly.**
  JavaScript reads `1234567890123456789` as `1234567890123456800`, and that
  is what a client would get. laqi reports each such number when the file
  loads. It also refuses to rewrite that file from the panel or an agent,
  because saving would change the number in your file. Write the value as a
  string (`"1234567890123456789"`) to keep every digit. Many real APIs send
  64-bit ids as strings for this reason.

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
