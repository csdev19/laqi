---
title: "ADR-0011 — The panel is a plain React SPA, not a meta-framework"
---

# ADR-0011 — The panel is a plain React SPA, not a meta-framework

**Status:** Accepted
**Date:** 2026-09-01

## Context

The web panel at `/__laqi` is built with React 19 + Vite, as a plain
single-page app. The monorepo already uses Astro (for both docs sites) and
TanStack Start (for the example todo-app), so the question recurs: why does
the panel not use one of those, since both render React and one of them
would have brought routing along?

This ADR exists because the question was asked again after the fact, which
is the signal that the reasoning deserved a record.

## Decision

**The panel stays a plain React SPA built with Vite.** No meta-framework —
not Astro, not TanStack Start, not Next.

## Why

**1. The panel's server already exists, and it is laqi.**

Everything a meta-framework adds lives on the server: SSR, server functions,
data loaders, request-time routing. The panel has no server of its own — it
is a pure client of the control plane (`/__laqi/api` + the SSE stream),
which Hono serves. A meta-framework would have shipped a second server
runtime inside the CLI to do work the first server already does.

**2. The distribution model forbids a runtime.**

The panel's build output is static files, inlined into the CLI tarball and
mounted at `/__laqi` by Hono ([ADR-0010](/decisions/0010-release-and-npm/):
one self-contained package, plain Node 20+). TanStack Start wants a server
runtime in production; that breaks the model directly. Astro can emit
static — but see the next point.

**3. The panel is app-shaped, not content-shaped.**

Astro's islands model pays off when most of a page is static content with
interactive islands. The panel is the opposite: one screen that is 100%
interactive — live request log over SSE, `⌘K` palette, inline editing,
optimistic response flips. In Astro it would have been one page containing
a single giant React island: Vite + React with an extra framework layer.

**4. One screen, no routes.**

List + detail + palette, no URL routing, no loaders. A router and a data
layer are dead weight here — and the weight lands in the one artifact where
it costs: the npm tarball.

## Alternatives considered

**Astro.** Discarded: app-shaped UI, not content. Astro is used where
content is content — `apps/documentation` and `apps/site`.

**TanStack Start.** Discarded: needs a server runtime and brings machinery
(server functions, loaders) the panel cannot use. It is used where it fits —
`examples/todo-app`, which is precisely the kind of app it serves.

**If the panel ever needs URL routing** (deep-linking an endpoint, say),
TanStack Router exists standalone — client-side, no Start, no server. The
routing is available without reopening this decision.

## Consequences

**In favour:**

- The panel builds to a handful of static files; the CLI bundle stays
  small and self-contained.
- No second server runtime, no port juggling, no framework upgrade
  treadmill on the shipped artifact.
- The dev setup is trivial: Vite with HMR, proxying `/__laqi/api` and
  `/__laqi/events` to a running laqi on `:8000`.

**Costs:**

- No SSR: the panel paints after the JS loads. Irrelevant on loopback.
- No file-based routing: if the panel ever grows screens, routing is a
  deliberate addition (TanStack Router), not a free feature.
