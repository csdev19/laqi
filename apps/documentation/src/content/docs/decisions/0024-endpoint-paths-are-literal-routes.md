---
title: ADR-0024 — Endpoint paths are literal routes with whole-segment params only
---

# ADR-0024 — Endpoint paths are literal routes with whole-segment params only

**Status:** Proposed
**Date:** 2026-10-12
**Spec:** [Schema validation rules](/design/schema-validation-rules/) (NIW2-315), Finding 2

## Context

An endpoint key is `"METHOD /path"` ([ADR-0008](/decisions/0008-multifile-and-names/)).
The path half is handed unchanged to Hono's `app.on(method, path, …)`
(`packages/server/src/mock-app.ts:31`), which means it is a **route pattern**
in Hono's grammar, not a literal URL path. Hono's grammar includes regular
expressions (`/:id{[0-9]+}`), optional segments (`/:type?`) and wildcards
(`/files/*`) — https://hono.dev/docs/api/routing.

Measured on 2026-10-12 with `hono@4.12.3`: a mock declared as
`GET /x/:id{(a+)+$}` makes a request for `/x/` + 26 `a`s + `b` take 620 ms,
27 take 1.6 s, doubling per character, with the whole process stalled for the
duration. The key can come from a shared repository or from an agent calling
`create_endpoint`, and the request can come through the `--share` tunnel.
Separately, keys with `?`, `#`, `%` or a trailing `\` can never match a
request and show in the panel as live endpoints.

## Decision

An endpoint path is `/` or a sequence of `/`-separated segments where each
segment is either a whole-segment parameter `:ident` or a literal made of
RFC 3986 `pchar` characters minus `:`, `%` and `*`, plus any non-ASCII
non-whitespace character written decoded. Empty, `.` and `..` segments,
percent-encoding, and every character Hono treats as syntax (`{ } ? * \`) are
refused by `parseEndpointKey` in `@laqi/schema`, which is the one gate the
loader, the panel and MCP already share. Parameter names are unique per path.

The grammar is deliberately the intersection of what Hono's `RegExpRouter`
and `TrieRouter` treat identically, and a test registers every accepted
example on both routers.

## Alternatives rejected

- **Refuse only `{…}`** (the narrowest ReDoS fix). Leaves dead endpoints and
  wildcard/optional semantics that the panel ids and the MCP tools do not
  model; `/files/*` and `/files/:name` would both be "an endpoint" with no
  way to say what the id means.
- **Keep Hono's full grammar and replace the router with a linear-time
  matcher.** Duplicates routing in `packages/server`, still leaves dead
  endpoints, and ties the format to a router implementation.
- **Allow regex params but lint them for catastrophic backtracking.** No
  sound static check exists for JavaScript regexes with backreferences; the
  tool would be a heuristic in front of an attacker-chosen input.
- **Allow percent-encoded literals.** Hono decodes the request path before
  matching, so `%20` in a route never matches; allowing it only produces dead
  endpoints with a plausible look.

## Consequences

- Wildcards, optional segments and constrained parameters are not expressible
  in a mock file. Users who need "any id" write `:id`; users who need a
  catch-all under a prefix cannot, today.
- Existing files with such keys get a per-endpoint `degraded` error naming
  the segment; the rest of the file keeps serving. No rewrite is offered.
- Part of `laqi@3.0.0` with the rest of NIW2-315.
- `hasPathParam` in the scaffold and `parseEndpointKey` now agree on what a
  parameter is.

## Non-goals

- Case-insensitive routing or reserved-prefix matching; Hono routes are
  case-sensitive and `/__LAQI/x` shadows nothing.
- Matching on query strings or fragments: a mock is selected by method and
  path; query-dependent responses are what scenarios and `X-Laqi-Response` are
  for.

## Reopen condition

A concrete request for a catch-all or constrained parameter from a user with
a mock file to show. The answer then is an explicit, documented construct
(for example a `*rest` segment with its own id semantics in the panel and
MCP), added with its own ADR, never a reopening of raw router syntax.
