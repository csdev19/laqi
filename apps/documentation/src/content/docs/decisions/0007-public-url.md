---
title: "ADR-0007 — Public URL: cloudflared first, self-hosted relay later"
---

# ADR-0007 — Public URL: cloudflared first, self-hosted relay later

**Status:** Accepted
**Date:** 2026-08-24

## Context

The original problem that motivated this part of the rewrite: **in React
Native you can't use `localhost` as a reliable backend.** The physical
device doesn't resolve your machine's `localhost`, Expo Go over mobile data
can't see your local network, and a teammate on another network can't reach
your mock.

v1 attempted it with the `ip` field in `mock.config.json`, to bind to the
LAN IP. That only works if the device is on the same wifi, breaks every time
the router reassigns the IP, and doesn't help share with anyone outside the
office.

## Decision

A `laqi --share` flag that brings up a **public URL** pointing at the local
mock.

**Phase 1:** wrap `cloudflared`.
**Phase 2 (later, if usage justifies it):** a self-hosted relay on Cloudflare Workers,
with stable subdomains.

The sharing layer is designed as a **pluggable interface** (`TunnelProvider`)
from day one, so phase 2 doesn't require rewriting anything.

## Why cloudflared first

`cloudflared tunnel --url http://localhost:8000` gives a free
`*.trycloudflare.com` URL, no account, no session limit and **no
interstitial page** — unlike ngrok's and localtunnel's free tiers, which put
up an intermediate screen that breaks any client that isn't a browser. For a
React Native app consuming an API, that interstitial is an absolute
blocker.

Zero self-hosted infrastructure, and it's implemented in days instead of weeks.

**Accepted limitations:** a random URL on every startup, and a dependency on
an external binary that has to be detected or downloaded.

## Why the self-hosted relay comes later, not now

A Cloudflare Worker with a Durable Object that keeps a WebSocket open
against the CLI and proxies public HTTP → WS → local server. It gives
`<slug>.laqi.dev`, stable subdomains, zero third parties, and at hobby scale
costs practically nothing. With Hono it's straightforward, and
`rakoi-monorepo` already has `packages/infra-cloudflare` and
`@cloudflare/workers-types`, so the ground is already broken in.

**It's postponed because it's real infrastructure**: domain, account,
operations, and from there on you're responsible for a service other people
use. Not worth it before knowing whether anyone uses `--share`.

What is done now is **not closing the door**: `TunnelProvider` as an
interface, with `CloudflaredProvider` as the first implementation.

## Security: non-negotiable

This is the critical part. The [v1 analysis](/v1-analysis/) showed the
server had CORS `*` and zero authentication. On `127.0.0.1` that didn't
matter. **With a public URL it stops not mattering**, and ephemeral tunnel
URLs are actively scanned by bots.

When `--share` is active:

1. **Token required by default.** The CLI generates a token, prints it on
   startup, and any request without `Authorization: Bearer <token>` gets a 401. Disabling it requires an explicit flag (`--share --public`) that
   prints a warning.
2. **Restricted CORS.** Never `*` in shared mode. Only the origins declared
   in the config.
3. **The web editor and the MCP are not exposed.** `/__laqi` and the
   control plane stay bound to the local interface, never to the tunnel.
   Having the mock's URL can never mean being able to rewrite your mocks.
4. **Rate limiting** on the public surface.
5. **A clear notice on startup**, saying what got exposed and with which
   token.

## Alternatives considered

**ngrok.** The best known, but the free tier requires an authtoken, limits
sessions and shows an interstitial page. Discarded for the interstitial.

**localtunnel.** Pure JS, no external binary, installable as a dependency —
very appealing for that. Discarded for spotty historical reliability and
for also showing an intermediate page.

**Tailscale Funnel.** Solid, but requires every participant to have
Tailscale. Clashes with "just share the URL with the designer".

**No tunnel; only bind to the LAN IP (v1's approach).** Discarded: it
doesn't solve Expo Go over mobile data, nor a teammate on another network,
nor a physical device on another wifi. It's exactly the problem that
motivated all of this. It's kept as an option for the simple same-wifi
case.

## Consequences

**In favour:**

- Solves the real React Native problem.
- Turns the mock into something shareable: the designer sees the demo from
  her phone, the backend dev validates contracts against the same URL.
- Zero self-hosted infrastructure in phase 1.

**Against:**

- Dependency on an external binary (`cloudflared`): detect it, guide the
  install, or download it.
- A different URL on every startup until the self-hosted relay exists.
- **Forces taking security seriously.** The five measures above are real
  work that wouldn't be needed without `--share`. It's the cost of the
  feature.
- Shared mode **only works well because state isn't global**
  ([ADR-0004](/decisions/0004-state-outside-git/)). The two decisions
  support each other.
