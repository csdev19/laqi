<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/csdev19/laqi/main/assets/brand/logo-light.png">
  <img src="https://raw.githubusercontent.com/csdev19/laqi/main/assets/brand/logo.png" alt="laqi" width="320">
</picture>

> Your backend isn't ready. Your frontend can be.

A controllable local mock API for frontend development. Create mocks from
JSON, OpenAPI, or models — then flip responses, errors, delays, and
scenarios from a local panel.

[Docs](https://laqi.dev/docs/) ·
[Quick start](https://laqi.dev/docs/quick-start/) ·
[GitHub](https://github.com/csdev19/laqi) ·
A product by Niway

## Install

```sh
npm install --save-dev laqi
```

## Quick start

Create `laqi/todos.json`:

```json
{
  "GET /todos": {
    "default": "ok",
    "responses": {
      "ok": {
        "status": 200,
        "body": [{ "id": 1, "title": "Ship the frontend", "done": false }]
      },
      "empty": { "status": 200, "body": [] },
      "error": { "status": 500, "body": { "message": "boom" } }
    }
  }
}
```

Start laqi:

```sh
npx laqi
```

Your mock API is now available at:
`http://127.0.0.1:8000`

Open the control panel:
`http://127.0.0.1:8000/__laqi`

Click `empty` or `error` in the panel and watch your frontend change.
No rebuild. No backend changes.

Rather not write that file by hand? `npx laqi init` scaffolds a todos API
with named responses and three ready-made scenarios.

## What you can test

- Empty, loading, unauthorized, and error states
- Delayed responses
- Whole-API scenarios such as `checkout-broken`
- Requests from web, mobile, physical devices, or curl
- Mocks created by coding agents through MCP

## Why laqi?

A real HTTP server, named responses, one-click state changes, scenarios,
file-based mocks, and a local-only control panel.

## More

- Full documentation → [laqi.dev/docs](https://laqi.dev/docs/)
- Use with AI agents → [laqi.dev/docs/ai-agents](https://laqi.dev/docs/ai-agents/)
- The mock file format → [laqi.dev/docs/mock-files](https://laqi.dev/docs/mock-files/)
- GitHub → [github.com/csdev19/laqi](https://github.com/csdev19/laqi)

---

laqi is an open-source product by Niway. MIT licensed.
