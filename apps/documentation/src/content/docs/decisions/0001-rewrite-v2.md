---
title: ADR-0001 — Full rewrite instead of fixing v1
---

# ADR-0001 — Full rewrite instead of fixing v1

**Status:** Accepted
**Date:** 2026-08-24

## Context

laqi v1 (1.2.1) is ~200 lines of CommonJS JavaScript on top of Express 4. The
[analysis](/v1-analysis/) found twelve defects — five verified by running the
server — and six security issues, including nineteen vulnerabilities in
dependencies (one critical).

The question was whether to fix that base or start from zero.

## Decision

**Full rewrite**, in TypeScript, on a new monorepo. The core idea (a
declarative response selector) and the name are kept. No code is kept.

Existing projects migrate with `laqi migrate`, which converts v1-format JSON
to v2's.

## Why

**1. The defects are not loose bugs, they are consequences of the design.**

The three worst ones come from the same data model:

- The handler writes over the configuration it serves
  (`body.query = req.query`) → state leak between requests.
- Files are merged with spread into a flat object → silent collisions between
  files.
- The endpoint key also encodes the method → the `(get)files/:id` hack was
  born, and it doesn't even resolve the collision between files.

Fixing all three requires changing the data model. Once the data model
changes, not much of the 200 lines is left.

**2. Structural limitations don't get patched.**

No validation, no tests, no CLI (`yargs` declared and never imported), a
single global state, CommonJS, `res.status("200")` with strings that blocks
Express 5. All of that is new work, not a fix.

**3. The format has to change regardless.**

The three features that justify v2 — the web editor, MCP, a shared public
URL — require separating definition from state and removing the method from
the key. That breaks compatibility. If the format breaks anyway, the main
argument for keeping the code disappears.

**4. Two hundred lines.**

The cost of rewriting is low, and it will never be lower than it is now.

**5. There are no production users to block on.**

Confirmed with the author. Existing apps can run `laqi migrate` without
issue.

## Alternatives considered

**Incremental fix keeping compatibility.** Discarded: it forces forever
supporting the format with the method in the key and the global state, which
are exactly the two things blocking the new features. Permanent debt would
be paid to keep 200 defective lines.

**Fix only the security bugs and leave v1 in maintenance.** Discarded as a
goal, but the security analysis is kept as documentation in case some
project stays on v1: the urgent items there are moving `nodemon` to
`devDependencies` (it drags in the critical vulnerability) and not exposing
the server outside `127.0.0.1`.

## Consequences

**In favour:**

- Correct data model from the start, with Zod validation on load.
- TypeScript, tests from the first line (TDD, following rakoi's policy).
- No compatibility debt.

**Against:**

- v1 users have to migrate. Mitigated with `laqi migrate`.
- The README and the entire documentation have to be rewritten.
- The period until v2 reaches v1's functional parity is time without a
  usable release.
