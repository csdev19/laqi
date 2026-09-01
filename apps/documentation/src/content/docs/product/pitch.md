---
title: The pitch
description: What laqi is, the problem it solves, and why it's different — written to pitch, not to document.
---

# The pitch

## The problem

Frontend work waits on backend work more often than it should. The API isn't
ready, or it's ready but you need it to return an empty list, a 500, or a
slow response to build the loading and error states nobody tests until it's
too late. The usual fixes are all compromises:

- **Hand-edit a mock file** and you're one save away from breaking every
  other screen using it.
- **Comment code to force a state**, then forget to revert it before the PR.
- **A request-interception library** (MSW and friends) rewrites `fetch` in
  the browser — it doesn't help a mobile app on a physical device, a
  teammate on another network, or anything that isn't the browser tab you're
  in.
- **A hosted mock SaaS** means an account, a dashboard in another tab, and
  your API shapes living on someone else's servers.

## What laqi is

laqi is a local mock server with a control panel. Point your app at it —
web, mobile, anything that speaks HTTP — and flip any endpoint into any
state: empty, slow, unauthorized, on fire. One click, no restart, no code
change.

```
npx laqi
```

Mocks are plain JSON files that live in your repo, next to the code that
uses them. laqi serves them, watches them for changes, and exposes a panel
at `/__laqi` where a click swaps which response is live.

## Why it's different

**A real server, not a browser patch.** laqi runs as an actual HTTP server
on your machine. It works from a physical phone, from Expo Go on mobile
data, from a teammate's laptop on another network, from `curl` — anything
that can be pointed at a URL, because interception libraries can't leave the
browser tab they're injected into.

**One idea decides every response.** Every request resolves through four
layers, checked in order: an explicit header, a saved override, an active
scenario, or the file's own default. The response always carries an
`X-Laqi-Resolved` header naming which layer decided it — no more "why is
this returning the wrong thing" archaeology.

**The fast path is a click, not a file edit.** The panel is where the
frequent thing happens: flip a response, activate a scenario, watch a live
request log that calls out the requests hitting no route at all —
usually the actual bug. `⌘K` reaches any endpoint/response pair by name
without touching the mouse.

**It closes the loop on data, not just responses.** Paste a TypeScript
interface and get realistic seeded data back — emails in `email` fields,
dates in `createdAt`. Pull types back out of any live response in
twenty-five languages (TypeScript, Python, Go, Rust, Swift, Kotlin, Zod and
Effect Schema included). The model only ever lives as data on disk — nothing
is stored as a schema to go stale.

**Share it without deploying anything.** `laqi --share` opens a public URL
through a Cloudflare tunnel — bearer-token protected, rate-limited, CORS
locked to origins you name. What goes out is only the mocks; the panel and
its write API stay local-only, on a separate listener the tunnel never
touches.

**Built to be driven by an agent, not just a person.** `laqi mcp` exposes
the same operations — list endpoints, flip a response, activate a scenario,
create or update an endpoint, import an OpenAPI spec, generate types and
data — as MCP tools. A coding agent building a screen can stand up the mock
it needs without a human opening a file.

## Who it's for

Frontend and mobile developers who are blocked on a backend that doesn't
exist yet or doesn't misbehave on demand; teams that need everyone —
including someone on a phone, off the office network — looking at the same
mock state; and increasingly, coding agents that need to create and drive
mocks themselves as part of building a feature.

## Where it stands

laqi v2 is a full rewrite of a small mock server that's been on npm since 2022. It ships under the same package name — `laqi` — already owned on this
account, with no scope and no rename. The first v2 release is plain
`2.0.0`; nothing before that has gone out.

## The name

**laqi** joins two Quechua words — _llulla_ (false) and _chasqui_
(messenger) — into "false messenger": a server that answers with simulated
information. It also happens to sound like "lucky" in English. More in
[the full story](/the-name/).
