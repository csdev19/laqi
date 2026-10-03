---
title: laqi.dev page audit — 2026-10-01
description: Every claim on the public landing page, matched against the code that would have to support it. Twenty-one findings, with the evidence slot filled for each.
---

# laqi.dev page audit — 2026-10-01

**Date:** 2026-10-01
**Target:** `https://laqi.dev/` as served in production, and `apps/site/` at
commit `193e018`.
**Method:** [cs-audit-product-page](https://github.com/csdev19/general-knowledge)
— the page is the hypothesis, the product and its evidence base decide what is
true. Every finding carries an evidence slot filled before the finding was
written.

This is the research record. The work it produced lives in four documents:

| Document                                          | What it decides                                                |
| ------------------------------------------------- | -------------------------------------------------------------- |
| [Plan 15](/plans/2026-10-01-15-page-truth-fixes/) | The eight correctness defects, as implementable tasks          |
| [Positioning](/design/positioning/)               | Audience, alternatives, category — the inputs copy needs       |
| [Backend handoff](/design/backend-handoff/)       | What happens when the real API arrives, in page and in product |
| [Page evidence](/design/page-evidence/)           | What the three empty visual slots must demonstrate             |

## Decision gate

The page can be revised, with two conditions.

**First**, findings T1–T4 are correctness defects on a live public page. They
are fixed before the argument is touched, not after.

**Second — and this is the constraint that shapes everything below — laqi has
no customer evidence of any kind.** 399 npm downloads in September 2026, no
testimonials, no case studies, no telemetry (there is no analytics module
anywhere in `packages/`). Therefore:

> No claim about a customer outcome can be written on this page today.
> Not "teams ship faster", not "integration took less work", not a number.

What _can_ be written, and is the thing actually missing, is **mechanism**: why
a shared contract removes a sequencing dependency, and what the handoff costs
when the real backend lands. Mechanism is argued from the product. Outcome is
argued from customers. The page has been reaching for the second while failing
to state the first.

## What triggered this audit

A LinkedIn post describing exactly laqi's thesis — a frontend team working
2–3 sprints ahead of the backend behind a Node.js mock server built from an
agreed API contract — reached roughly 126 reactions, 28 comments and 9 reposts.

**Evidence status:** the post is a weak but real demand signal that the _problem
framing_ resonates. It is n=1, by a third party, on an auth-walled platform that
could not be verified directly; the engagement figures come from a screenshot.

It justifies raising that framing on the page. It does **not** justify reusing
its outcome sentences. "Switching required much less integration work" is one
team's measured result; on laqi.dev, with no customers, it would be invented.

## Truth findings

Ranked by what being wrong costs, not by effort.

### T1 — The hero's second CTA leads to an empty placeholder, in production

**Claim:** "Watch the 20-second demo".

**What is wrong:** the CTA targets `#demo`, which renders a `DemoPlaceholder` —
an empty box whose visible text is the internal production brief, followed by a
non-functional `or browse files` upload affordance.

**Evidence:** `apps/site/src/components/Hero.astro:36`, `:40-44`;
`apps/site/src/components/DemoPlaceholder.astro:17-24`. In the HTML served by
`https://laqi.dev/` the rendered text is
`20-second demo poster — a real storefront UI beside the laqi panel; click GET /products → empty, the UI empties — 16:9`
followed by `or browse files`. Two further placeholders at
`apps/site/src/components/FeatureGrid.astro:16-17`.

**Assessment:** contradicted.

**Action:** record the demo, or remove the CTA and all three slots. A page with
no video is sustainable. A page that invites the visitor to watch one and hands
them an empty drop zone says "unfinished" at the only moment they were willing
to look.

### T2 — The MCP tool count is wrong in three places, under an explicit claim of being in sync

**Claim:** "twelve tools" (`ai-agents.md`), "eleven tools" (`docs/index.md`),
"eleven typed tools" (`llms.txt`).

**What is wrong:** the server registers **fifteen**.

**Evidence:** `packages/mcp/src/server.ts` registers `list_endpoints`,
`get_state`, `set_response`, `set_scenario`, `reset_state`, `create_endpoint`,
`scaffold_responses`, `update_endpoint`, `delete_endpoint`, `import_openapi`,
`get_types`, `generate_data`, `regenerate_response`, `apply_generated_body`,
`refresh_schema`. Public surfaces:
`apps/site/src/content/docs/docs/ai-agents.md:3` and `:39` (twelve, listing
twelve — `regenerate_response`, `apply_generated_body` and `refresh_schema` are
absent); `apps/site/src/content/docs/docs/index.md:30` (eleven);
`apps/site/public/llms.txt:38` (eleven).

**Aggravating:** `ai-agents.md` states _"they are the same words shown here,
kept in sync with the one place they're implemented."_

**Assessment:** contradicted.

**Action:** generate the table from `server.ts` at build time, or drop the count
and the sync claim. An agent verifies this in one call; it is the reader least
able to forgive it.

### T3 — The "no code changes" badge is contradicted by the same page

**Claim:** hero badge `no code changes`; `llms.txt` "without touching a line of
code".

**What is wrong:** step 03 of the same page asks the visitor to change an
environment variable.

**Evidence:** `apps/site/src/components/Hero.astro:48` against
`apps/site/src/components/QuickStart.astro:60` ("Change one base URL") and `:63`
(`VITE_API_URL=http://127.0.0.1:8000`). Also `apps/site/public/llms.txt:5`.

**Assessment:** contradicted.

**Action:** the true version is stronger, not weaker — _"one base URL, nothing
else"_. That is a real differentiator against request interception. "No code
changes" is an overstatement the visitor disproves in thirty seconds.

### T4 — The MCP diagram shows `openapi.yaml`; the product rejects YAML

**Claim:** `McpSection` flow step 1, `Order.ts / openapi.yaml`.

**What is wrong:** OpenAPI import is JSON-only and fails YAML with an explicit
error.

**Evidence:** `apps/site/src/components/McpSection.astro:7` against
`packages/mcp/src/openapi.ts:36-39` ("JSON only: there is no YAML parser here")
and `apps/cli/src/init/run.ts:307-311` ("YAML specs are not supported yet").
`apps/cli/src/init/run.ts:46` documents it correctly: "JSON only today". The
same error exists inside the product: `apps/cli/src/init/prompt.ts:185` uses the
placeholder `.yaml or .json`.

**Assessment:** contradicted.

**Action:** `openapi.json` in the diagram, and fix the prompt placeholder. Most
real-world OpenAPI documents are YAML — this is the first friction on the path
the page advertises, not a copy detail.

### T5 — The version badge is stale by construction

**Claim:** nav badge `v2.0.0`.

**What is wrong:** npm `latest` is `2.0.1`, and the cause is structural rather
than an oversight.

**Evidence:** live HTML of `laqi.dev` → `version-badge: ['v2.0.0']`.
`https://registry.npmjs.org/laqi` → `dist-tags.latest = 2.0.1`.
`apps/cli/package.json` → `"version": "2.0.1"`.
`apps/site/src/lib/version.ts` reads the CLI version **at build time**, but
`.github/workflows/deploy-site.yml:12-15` deploys only on a `site-v*` tag. A CLI
release never redeploys the site.

**Assessment:** contradicted, and it will recur on every CLI release.

**Action:** either the site deploy also triggers on `v*`, or the badge reads npm
at runtime. Precedent for this class of defect:
`ce7a114 fix(site): the install page told users to run a flag that does not exist`.

### T6 — "no cloud" is conditional

**Claim:** hero badge `no cloud`.

**What is wrong:** true by default, false when the visitor uses `--share`, which
opens a Cloudflare quick tunnel and requires the `cloudflared` binary.

**Evidence:** `apps/site/src/components/Hero.astro:47`;
`apps/cli/src/tunnel.ts:26-34`.

**Related and correct:** `packages/server/src/public-app.ts:41-47` confirms the
control plane is not mounted on the public app, so
`apps/site/src/components/FinalCta.astro:17-19` — _"--share exposes only mock
responses, never the control plane"_ — is **supported**.

**Assessment:** conditional.

**Action:** "no cloud by default", or move the qualifier next to the badge. The
`FinalCta` is already honest; the hero is not.

### T7 — The landing's first step contradicts the docs' first step

**Claim:** landing step 01, "Write the contract — A JSON file in `./laqi/`".

**What is wrong:** the docs tell the visitor to run `laqi init`, which scaffolds
three endpoints and three scenarios.

**Evidence:** `apps/site/src/components/QuickStart.astro:28-30` against
`apps/site/src/content/docs/docs/quick-start.md:13-16` and
`apps/site/public/llms.txt:9-11`. `laqi init` exists and is complete:
`apps/cli/src/cli-surface.ts:8`, `apps/cli/src/init/`.

**Assessment:** contradicted — not against the product, but between two surfaces
of the same site.

**Action:** the landing should show `laqi init` as step 01 and hand-written JSON
as the "already have a contract" path. The landing currently makes the product
look more laborious than it is.

### T8 — "the fifty times a day you ask 'what if this fails?'"

**Evidence:** `apps/site/src/components/FeatureGrid.astro:22`. No source; the
product has no telemetry.

**Assessment:** unverifiable (rhetorical, low cost).

**Action:** acceptable if it clearly reads as rhetoric, but it is the page's only
figure and it supports nothing. If it changes, replace it with something
demonstrable.

### Verified and correct — do not "fix" these

| Claim                                                | Evidence                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Resolution order header → state → scenario → default | `packages/core/src/resolve.ts:37-57`                                               |
| `X-Laqi-Resolved` on every response                  | `packages/core/src/resolve.ts`, `packages/server/src/mock-app.ts`                  |
| One scenario active at a time                        | `state.scenario` is a single value, `packages/core/src/state-store.ts`             |
| Per-response `delay`                                 | `packages/schema/src/response.ts:15`                                               |
| Unmatched requests appear in the log                 | `packages/editor/src/log.test.ts:85` — `no matching route`                         |
| The four MCP capabilities named in `McpSection`      | `packages/mcp/src/server.ts` — create, import OpenAPI, generate data, set response |
| `--share` never exposes the control plane            | `packages/server/src/public-app.ts:41-47` — it is not mounted on that listener     |
| `npm i -g laqi@2`                                    | npm `dist-tags.latest = 2.0.1`                                                     |

## Positioning findings

### P1 — The page never names a single alternative

The internal pitch names four and argues against each: hand-editing a mock file,
commenting code to force a state, request interception (MSW and friends), a
hosted mock SaaS.

**Evidence:** `apps/documentation/src/content/docs/product/pitch.md:11-27`
against the full landing — zero mentions of MSW, interception, or waiting.
`apps/site/src/components/ForWhom.astro:36-38` gestures at it ("an API is
missing, unreliable, inconvenient") without naming what it competes with.

**Assessment:** missing.

**Why it costs:** a visitor searching for a mock server already uses something.
If the page does not say how laqi differs from MSW, they return to MSW. The
argument is already written internally and it is good.

### P2 — The page sells to a developer; the thesis is about a team

The eyebrow says "local API control for frontend teams" and everything after it
is second-person singular.

**Evidence:** `apps/site/src/components/Hero.astro:22` against
`apps/site/src/components/QuickStart.astro:60` and all of `ForWhom.astro`. The
only team sentence is `apps/site/src/components/FeatureGrid.astro:20`
("shareable with the team"), inside a card.

**Assessment:** missing — and it is a positioning decision that has not been
taken, not a copy problem. See [Positioning](/design/positioning/).

### P3 — The handoff is absent from the page, and the hybrid case is absent from the product

**Evidence:** no section, page or sentence anywhere in `apps/site/` addresses
migrating from the mock to the real API. In the product, `grep` for
`proxy|passthrough|upstream|forward` across `packages/server/src`,
`packages/schema/src/config.ts` and `apps/cli/src/serve.ts` returns only a CORS
preflight comment. There is no proxy, no passthrough, no hybrid mode.

**Assessment:** missing on the page; a product gap for the intermediate state —
some endpoints real, some mocked — which is exactly what a migrating team lives
in.

**Action:** two separate things, deliberately not merged. See
[Backend handoff](/design/backend-handoff/).

### P4 — The shared contract is a footnote, not the spine

What makes the thesis work is that _both sides build against the same contract_.
On the page that is a feature card.

**Evidence:** `apps/site/src/components/FeatureGrid.astro:20` and
`apps/site/src/components/QuickStart.astro:28`. Nowhere does the page say the
contract is agreed **with the backend team**, nor that this is why the final
switch is cheap.

**Assessment:** missing. This is the angle the audit was asked for, and it is
defensible with no customer evidence, because it is mechanism.

### P5 — The word "mock" appears nowhere in the hero or in `<head>`

**Evidence:** `grep -c -i mock apps/site/src/pages/index.astro` → `0`, covering
title, description, OG and Twitter tags. First occurrence is mid-page at
`apps/site/src/components/McpSection.astro:15`. By contrast
`apps/cli/package.json` lists `mock-server`, `mock-api`, `api-mocking` as
keywords and describes the product as "A controllable local mock API server".

**Assessment:** missing.

**Action:** "mock server" is the category people search for. "Local API control"
is the differentiator, not the category. The hero can carry both.

## Page-argument findings

**A1 — The page contains no visual proof at all.** All three evidence slots are
placeholders (T1). No panel screenshot, no request log, no terminal, no GIF. The
product whose entire promise is "click and watch it change" shows nothing
changing. If only one item from this audit is done, it is this one.

**A2 — `examples/todo-app` is real, runnable proof and it is buried.** A
TanStack Start frontend running against laqi with pagination, CRUD and a login
flow (`README.md:19-23`), exposed only as a nav link to GitHub
(`apps/site/src/components/SiteNav.astro:14`). It answers "does this actually
work?" and nothing points a visitor at it.

**A3 — Two CTAs compete in the hero and one is broken.** "Quick start" and
"Watch the 20-second demo" carry equal visual weight; the second does not
deliver.

**A4 — There is no before/after section.** The order is
`Hero → ForWhom → QuickStart → ResolutionLayers → FeatureGrid → McpSection → FinalCta`:
promise straight to mechanism, never passing through the problem. Note for
whoever writes it: a before/after diagram **explains**, it does not **prove**.
It is an argument, not evidence.

**A5 — `ResolutionLayers` is well built and correctly placed.** It is the only
section with a single clear persuasive job. Leave it alone.

## Claim-proof backlog

| What needs proving                      | Evidence that would settle it                                  | Status                                                                                  |
| --------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| The product does what it says           | Record the 20s hero demo and the two 30s demos                 | Nothing recorded; 3 empty slots live. See [Page evidence](/design/page-evidence/)       |
| The switch to the real backend is cheap | Perform the switch in `examples/todo-app` and publish the diff | Generable in-repo, no customers needed. See [Backend handoff](/design/backend-handoff/) |
| Teams run "2–3 sprints ahead"           | At least one real team, with context                           | **Impossible today** — 399 downloads/month, no testimonials, no telemetry               |
| laqi beats MSW for this job             | A fair comparison under disclosed conditions                   | Nothing; the internal argument exists but no comparison                                 |
| Buyers have this problem                | Interviews, support language, usage, or research               | One third-party LinkedIn post, unverifiable, n=1                                        |

## Red flags checked against this audit

- No recommendation here amplifies a claim whose evidence slot is empty.
- No price or plan advice is given — laqi has no billing surface to cite.
- Files read span `apps/site/`, `apps/cli/`, `packages/{core,server,mcp,schema,generate,editor}`,
  `.github/workflows/`, the npm registry and the live page.
- The LinkedIn post is treated as a demand signal, not as proof of outcome.
- Source code was used to settle behaviour only, never a customer outcome.
