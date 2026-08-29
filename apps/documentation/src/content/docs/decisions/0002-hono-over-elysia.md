---
title: ADR-0002 — Hono as the HTTP framework
---

# ADR-0002 — Hono as the HTTP framework

**Status:** Accepted
**Date:** 2026-08-24

## Context

v1 used Express 4.17.2 (from 2021), with nineteen vulnerabilities in the
dependency tree and an API that forces `res.status("200")` with strings.
Something had to change. The serious candidates were **Hono** and
**Elysia**.

## Decision

**Hono.**

## Why

**1. Elysia is Bun-first, and laqi is distributed via npm.**

Elysia's reason for being is Bun. It has a Node adapter, but it's a
second-class citizen. laqi is installed with `npx laqi` and its audience is
frontend devs who have Node and not necessarily Bun. **Requiring Bun to be
installed is an adoption wall** that a tool of this kind can't afford.

**2. The framework and the public URL are the same decision.**

This is the deciding reason. [ADR-0007](/decisions/0007-public-url/)'s own
relay runs on Cloudflare Workers. Hono runs
on Node, Bun, Deno, Workers, Vercel and Lambda on top of Web Standards
(`Request`/`Response`), so **the same `packages/server` runs on the local CLI
and on the edge relay**. With Elysia, two implementations would have to be
maintained.

**3. It's already in the stack.**

`rakoi-monorepo` has `hono@4.12.3` in the Bun workspaces catalog, and a
`packages/infra-cloudflare` with `@cloudflare/workers-types`. The ground is
already broken in.

**4. Smaller things that add up.**

`RegExpRouter` is the fastest JS router there is. The package weighs ~14kB,
which matters in a CLI installed via `npx`. And `hono/client` gives typed
RPC, useful if laqi ever generates a TypeScript client from the mocks.

## Alternatives considered

**Elysia.** Better in raw benchmarks and with excellent type DX. Discarded
for points 1 and 2: the coupling to Bun clashes with npm distribution, and it
doesn't run on Workers, which is where the relay lives.

**Express 5.** Discarded: it resolved the vulnerabilities but doesn't
contribute anything toward the new features, doesn't run on the edge, and
the migration to v5 would still break the code because of string status
codes (defect I).

**Plain Node HTTP.** Discarded: the router, param matching and CORS handling
would have to be written by hand. That is exactly the work Hono already does
better.

## Consequences

**In favour:**

- A single server implementation for local and edge.
- A modern base on Web Standards; the dependency tree shrinks drastically.
- Aligned with the existing stack.

**Against:**

- The endpoint registry and CORS middleware have to be rewritten.
- Express's middleware ecosystem is larger, although for what laqi needs
  (CORS, body parsing, logging) Hono ships all of it out of the box.
