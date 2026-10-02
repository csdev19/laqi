---
title: Positioning — the inputs laqi.dev's copy is missing
description: Triggering circumstance, real alternatives, differentiated capabilities, best-fit audience and category — written as decisions to take, with every unverified input marked.
---

# Positioning — the inputs laqi.dev's copy is missing

**Status:** Draft spec. Three decisions are **open and blocking**; they are the
reason the landing page cannot be rewritten yet.
**Date:** 2026-10-01
**Produced by:** [the 2026-10-01 page audit](/product/page-audit-2026-10-01/),
findings P1, P2 and P5.

## In one minute

The landing page was written without a positioning statement. It shows: no
alternative is ever named (P1), the eyebrow addresses teams while every sentence
after it addresses one developer (P2), and the category word people actually
search for — "mock server" — appears nowhere in the hero or in `<head>` (P5).

Those are not copy problems. They are three decisions nobody has taken, and copy
written on top of them would be guesswork shipped.

### Decisions

| Decision                                                                        | Why                                                                                                 | ADR  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---- |
| The page names its real alternatives explicitly                                 | A visitor already uses something; unnamed competition is competition unanswered                     | none |
| The hero carries the category ("mock server") **and** the differentiator        | Category earns recognition and search; differentiator earns the click. They are not interchangeable | none |
| No customer-outcome claim ships until there is a customer                       | 399 downloads/month, zero testimonials, zero telemetry. See the audit's decision gate               | none |
| Mechanism claims are argued from code; outcome claims are argued from customers | The distinction is what keeps the page honest while it is still unknown                             | none |

None of these needs an ADR: they are page-level and reversible, and no later
reader will ask "why this and not that" about naming a competitor.

### Open questions — blocking

1. **Who is the best-fit visitor: the individual frontend developer, or the lead
   who adopts laqi for a team?** (P2.) The page currently promises the second in
   its eyebrow and serves the first everywhere else.
2. **Is "waiting for the backend" the triggering circumstance, or is it
   "reproducing a state on demand"?** They imply different heroes and different
   first sections.
3. **Does laqi compete with MSW, or sit beside it?** The internal pitch argues
   it replaces it. That is an untested assertion about what buyers consider.

### Out of scope

Final copy. This document produces the inputs; writing hero lines before question
1 is answered is exactly the failure that produced the current page.

---

## The triggering circumstance

Two candidates, and the page has never chosen:

**(a) The backend is not ready.** The hero already says this —
_"Your backend isn't ready. Your frontend can be."_ It is the framing the
LinkedIn post that triggered this audit used, and the framing that resonated
there. It is a team-sequencing problem, felt most sharply by whoever owns
delivery dates.

**(b) The backend exists but will not misbehave on demand.** Empty list, 401,
500, three seconds of latency. This is a per-developer, per-task problem, felt
fifty times a week by one person. Most of the page's feature surface serves this
one.

**Recommendation:** (a) as the hero, (b) as the second section. (a) is the
larger, more expensive problem and the one with an identifiable owner; (b) is
what keeps the product in use after the backend ships, which is what stops laqi
being a tool you uninstall. Leading with (b) wins the individual and never
reaches the person who could adopt it for six people.

**Unverified:** that (a) is what laqi's actual visitors arrive with. One
third-party LinkedIn post is the only signal, and it is n=1. The cheapest way to
settle this is the first ten real users, not more argument.

## The real alternatives

Including the ones that are not products. The internal pitch
(`product/pitch.md:11-27`) names four; this is the set the page must answer.

| Alternative                       | What it actually costs the team                                                            | laqi's answer                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Wait for the endpoint**         | The dependency itself. Nothing is built, and the cost is invisible until the sprint closes | The whole thesis. This is the alternative the page should lead against          |
| **Hand-edit a mock file**         | One save away from breaking every other screen; states are not reproducible                | Named responses per endpoint; the file is the contract, the state is a click    |
| **Comment code to force a state** | Forgotten before the PR; it is a code change pretending to be a test                       | `X-Laqi-Response` per request, or a panel click — nothing to revert             |
| **Request interception (MSW)**    | Rewrites `fetch` in the browser; does not reach a physical phone, a teammate, curl, or RN  | A real HTTP server. This is the honest, checkable differentiator                |
| **A hosted mock SaaS**            | An account, a second dashboard, API shapes on someone else's servers                       | Plain JSON in the repo, runs locally, `--share` never exposes the control plane |

**The page names none of these.** That is finding P1.

**Unverified:** which of these a visitor is actually choosing between. MSW is
assumed to be the main competitor because it is the best-known tool in the space,
not because anyone has been asked. Treat the MSW row as a hypothesis until a real
user says it.

## Differentiated capabilities

Only capabilities verified in code during the audit. Each is a mechanism claim,
settled by implementation, and therefore safe to write today.

| Capability                                                        | Evidence                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| A real HTTP server, not a browser patch — reachable by any client | `packages/server/src/mock-app.ts`, `@hono/node-server`         |
| Four resolution layers, and every response says which one won     | `packages/core/src/resolve.ts:37-57`, `X-Laqi-Resolved`        |
| State changes without a restart, a rebuild or a file edit         | control plane in `packages/server`, panel in `packages/editor` |
| Mocks are plain JSON in the repo — reviewable in a PR             | `packages/schema`, ADR-0008                                    |
| The same operations are available to an agent over MCP            | `packages/mcp/src/server.ts` — fifteen tools                   |
| Sharing without deploying, with the control plane left behind     | `packages/server/src/public-app.ts:41-47`, ADR-0007            |
| Seeded realistic data from a pasted TypeScript model              | `packages/generate/src/parse-types.ts`                         |

The second row is the one no competitor answers and the page already explains
well (`ResolutionLayers`). The first row is the one that beats MSW and the page
states only as a feature card.

## Category

**Current state:** the hero and every meta tag avoid the word "mock"
(P5). The first occurrence is mid-page.

A visitor searching for this product types "mock server", "api mocking",
"mock api". `apps/cli/package.json` already knows this — those are its npm
keywords. The site does not.

**Recommendation:** category in the eyebrow or the lede, differentiator in the
headline. Something of the shape _"a local mock server you can control"_ — the
noun they searched for, qualified by the thing nothing else does. The current
headline is good and need not be replaced; the category can sit above or below
it, and in `<title>` and `description`.

## Best-fit audience

**Open — this is blocking question 1.**

The candidates are not compatible, and the page currently straddles them:

- **The individual frontend or mobile developer**, blocked today, who installs a
  binary and never asks anyone. Short path, no decision-maker, low value per
  user. This is who the page serves after the eyebrow.
- **The frontend lead or EM** who adopts it for a team because it removes a
  dependency from the delivery plan. Longer path, needs the handoff answered
  (see [Backend handoff](/design/backend-handoff/)), needs the contract framed as
  a shared artifact, and is the only reader for whom the LinkedIn framing lands.

**Recommendation:** write the hero for the lead and the quick start for the
developer. They are not in conflict at the section level — a lead reads the top,
a developer scrolls to step 01 — and this is the one arrangement that does not
abandon either. What is in conflict is the current page, where the eyebrow
promises a team conversation that no later section has.

**What would settle it:** the first ten real users. Nothing in this repository
can answer it, and no amount of further reasoning will.

## Primary promise

Proposed, pending question 1:

> Agree the contract once. Build the whole frontend against it while the backend
> is still being written, and change one base URL when it is ready.

Why this shape: every clause is a mechanism claim this repository can defend. It
contains no number, no outcome, and no comparison. It names the handoff, which is
the objection the current page leaves standing (P3).

**It must not become** "ship 2–3 sprints ahead" or "cut integration work". Those
are the LinkedIn post's outcomes, measured on a team that is not laqi's, and
writing them here would be the exact failure this audit exists to prevent.
