---
title: The control panel
description: What every part of the panel does — flipping responses, the request log, the command palette, and sharing publicly.
---

`/__laqi` is a local web panel over the same control-plane API laqi uses
internally. It is the fastest way to do the thing you do fifty times a
day — flip which response an endpoint serves — without touching a file
or restarting anything.

## Flipping a response

Every response is a visible chip on its endpoint's row. Clicking one
makes it live immediately — no file edit, no restart. Clicking the
file's own default again removes the override rather than writing an
identical one back.

The list tells you what changed without opening anything:

- **Magenta** rows are overridden by you, right now.
- **Violet** rows were moved by an active scenario.
- Each row names the layer that decided it — the same word the
  `X-Laqi-Resolved` header uses. See
  [Resolution layers](/docs/concepts/resolution-layers/) for the full
  precedence order.

## Scenarios

The scenario strip moves several endpoints at once — activate
`offline` or `checkout-broken` with one click instead of flipping each
endpoint by hand. Only one scenario is active at a time; a
per-endpoint override still beats it on any route it targets.

## The request log

A live log sits beside the endpoint list, never behind a tab. Requests
that matched no route get the loudest row in the pane, because "why is
my mock not answering?" is the most common confusion a mock server
produces. Clicking a row jumps to the endpoint that served it.

## The command palette

`⌘K` reaches any endpoint/response pair by name — typing `orders boom`
flips `POST /orders` to its `boom` response without touching the mouse.

## Editing an endpoint

The endpoint detail view edits the definition itself — status, delay,
body, response names — and writes it back to the file it came from. It
also hands you a ready-made `curl` carrying `X-Laqi-Response`, and the
[data generation](/docs/data-generators/) tools: paste a model for a
realistic body, or copy the current response's types in twenty-five
languages.

## Sharing it publicly

`localhost` is not reachable from a physical phone, from Expo Go on
mobile data, or from a teammate on another network. `laqi --share` opens
a public URL to your mocks, using [`cloudflared`](https://github.com/cloudflare/cloudflared)
(no account, no login needed) — laqi prints the URL, a bearer token, and
a ready-to-paste `curl`.

What goes through the tunnel is only the mocks. The panel and the
control-plane API stay on a second, local-only listener — every
`/__laqi` path answers 404 through the public URL, so having the shared
URL never means being able to rewrite your mock files. Every request
without `Authorization: Bearer <token>` gets rejected unless you pass
`--public`, which turns that off and says so loudly.

The panel is served only when laqi is listening on loopback — with
`--host 0.0.0.0` neither the panel nor the API is mounted.
