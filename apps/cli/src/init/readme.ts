// apps/cli/src/init/readme.ts
//
// The third scaffolded file, written next to api.json and scenarios.json.
// Static, not templated from the chosen scaffold: it teaches the file
// format and the resolution rules, which hold regardless of --from. Kept in
// its own module, same reason scaffold.ts is pure — README_CONTENT is a
// plain string a test can assert against without touching the filesystem.
//
// Two audiences read this file from the same words: a person who opens
// laqi/ in an editor, and a coding agent that has no MCP tools configured
// and is reading the folder instead. Neither gets a private copy — one file
// that cannot drift from itself.

export const README_CONTENT = `# laqi

This folder is a mock API served by \`laqi\`. It belongs to laqi, not to the
project around it — edit the files here to change what the mock returns.

## The file format

\`api.json\` maps \`"METHOD /path"\` to an endpoint. Each endpoint names a
\`default\` response and declares every response it can return:

\`\`\`json
{
  "GET /todos": {
    "default": "ok",
    "responses": {
      "ok": { "status": 200, "body": { "items": [] } },
      "error": { "status": 500, "delay": 300 }
    }
  }
}
\`\`\`

- \`status\` — the HTTP status to return.
- \`body\` — optional; omit it for a response with no body.
- \`delay\` — optional milliseconds to wait before responding.

## Adding an endpoint

1. Add a \`"METHOD /path"\` key to \`api.json\` (path params use a colon: \`/users/:id\`).
2. Give it a \`default\` and at least one response under \`responses\`.
3. Save — laqi picks it up immediately, no restart.

## Which response wins

Four layers, lowest precedence first:

1. **default** — the endpoint's own \`default\`, from the file.
2. **scenario** — the active scenario from \`scenarios.json\`, if it covers this endpoint.
3. **override** — a per-endpoint override set from the panel or an MCP tool. Beats the scenario.
4. **\`X-Laqi-Response\` header** — names the response for one request only. Beats everything else, and is never saved.

## What not to do

Don't send \`X-Laqi-Response\` on routine requests. It is the highest-precedence
layer, so an app that sends it silently overrides whatever a human is
flipping from the panel at the same time. Reserve it for a one-off test call.

## The panel

Open \`http://127.0.0.1:<port>/__laqi\` while laqi is running to see every
endpoint, flip its live response, or activate a scenario — no restart needed.
`
