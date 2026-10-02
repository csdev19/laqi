---
title: Plan 15 — laqi.dev correctness fixes
---

# Plan 15 — laqi.dev correctness fixes

**Date:** 2026-10-01
**Status:** Tasks 1, 2, 3, 4, 6, 7 and 8 are implemented on
`wip/laqi-dev-page-audit`. **Task 5 is open** — carrying it out as written
would undo an invariant the deploy workflow documents, so it needs a decision
first. See the task.
**Scope:** The eight correctness defects the
[2026-10-01 page audit](/product/page-audit-2026-10-01/) found on the live site,
plus two product-side inconsistencies discovered while specifying the fixes.
Positioning and new sections are **not** in this plan — they are blocked on
[Positioning](/design/positioning/) and
[Backend handoff](/design/backend-handoff/).

This plan ships only things that are currently false, misleading, or structurally
guaranteed to become false. Every task is independently verifiable against code
that already exists. No task requires a positioning decision.

## Why this is separate from the rewrite

A page cannot be argued into being better while it is also wrong. The audit
ranked by what being wrong costs: a visitor who catches one false statement
discounts every true one around it, and three of these are catchable in under a
minute by the exact reader laqi wants — a developer, or an agent.

The rewrite that follows will move sections and change claims. These fixes do
not depend on any of that, and shipping them first means the rewrite starts from
a page whose remaining sentences are all true.

## Tasks

Ordered by the cost of being wrong, not by effort.

### Task 1 — Remove the three demo placeholders and the demo CTA

The hero's _"Watch the 20-second demo"_ resolves to an empty box rendering an
internal production brief and a dead `or browse files` control.

- Remove the `DemoPlaceholder` usage in `apps/site/src/components/Hero.astro`
  (`:36`, `:40-44`) and the `#demo` CTA.
- Remove the two in `apps/site/src/components/FeatureGrid.astro:16-17`.
- Keep `apps/site/src/components/DemoPlaceholder.astro` in the tree — it is the
  right component once there is something to put in it. If it stays unused past
  the first recording, delete it then.

**Acceptance:** the string `poster` and the string `or browse files` do not
appear in the HTML served by the site build. The hero has exactly one CTA.

**Note:** this is the interim state specified in
[Page evidence](/design/page-evidence/), not the destination. The demo itself is
the highest-value work in the whole audit; it is excluded here only because it is
a production task, not a correctness fix.

### Task 2 — Make the MCP tool list generated, not transcribed

Three public surfaces state three different counts; the server registers fifteen.
`ai-agents.md` additionally claims the list is kept in sync with the
implementation.

- `apps/site/src/content/docs/docs/ai-agents.md` — add the three missing tools
  (`regenerate_response`, `apply_generated_body`, `refresh_schema`), fix the
  count in the frontmatter description and in the `## The twelve tools` heading.
- `apps/site/src/content/docs/docs/index.md:30` — fix the count.
- `apps/site/public/llms.txt:38` — fix the count and the inline list.
- Prefer generating the table from `packages/mcp/src/server.ts` at build time. If
  that is not done in this plan, add a test that fails when the registered tool
  count and the documented count diverge.

**Acceptance:** a test ties the documented set to the registered set. Changing
`server.ts` without touching the docs fails CI.

**Done, by the test rather than by generation.** `packages/mcp/src/documented-tools.test.ts`
starts the server and asserts the names and counts on all three surfaces.
Generation was rejected because the prose beside each name on `ai-agents.md` is
written for a person and is deliberately plainer than the agent-facing
description in `server.ts`; generating it would mean either showing a human the
agent's wording or maintaining a second description table. The file records
that reasoning and what the test does not cover.

**Why it is task 2:** an agent reading `/docs/ai-agents/` verifies this in one
call, and it is the page that tells agents to trust it.

### Task 3 — Fix the "no code changes" and "no cloud" badges

- `apps/site/src/components/Hero.astro:48` — `no code changes` is contradicted by
  the same page's step 03 (`QuickStart.astro:60`). Replace with the true and
  stronger claim: one base URL and nothing else.
- `apps/site/src/components/Hero.astro:47` — `no cloud` is true by default and
  false under `--share`, which opens a Cloudflare tunnel and needs the
  `cloudflared` binary (`apps/cli/src/tunnel.ts:26-34`). Qualify it.
- `apps/site/public/llms.txt:5` — "without touching a line of code" has the same
  defect.

**Acceptance:** no claim in the hero is contradicted by another section of the
same page or by `llms.txt`.

**Do not touch** `apps/site/src/components/FinalCta.astro:17-19`. The audit
verified that `--share` genuinely never exposes the control plane
(`packages/server/src/public-app.ts:41-47`); that sentence is correct and
precise.

### Task 4 — Stop advertising YAML OpenAPI, in the page and in the product

OpenAPI import is JSON-only (`packages/mcp/src/openapi.ts:36-39`) and fails YAML
with an explicit error (`apps/cli/src/init/run.ts:307-311`).

- `apps/site/src/components/McpSection.astro:7` — `openapi.yaml` → `openapi.json`.
- `apps/cli/src/init/prompt.ts:185` — the placeholder `.yaml or .json` invites
  the exact input the next step rejects. Make it `.json`.

**Acceptance:** no user-facing surface offers a YAML spec as an accepted input.

**Follow-up, not in this plan:** most real OpenAPI documents are YAML. Whether to
add a parser is a product decision with a real dependency cost, argued in
`packages/mcp/src/openapi.ts`. This task only stops promising it.

### Task 5 — Make the version badge structurally correct

The badge reads `v2.0.0`; npm `latest` is `2.0.1`. `apps/site/src/lib/version.ts`
reads `apps/cli/package.json` at build time, but
`.github/workflows/deploy-site.yml:12-15` deploys only on a `site-v*` tag, so a
CLI release never redeploys the site. This recurs on every release.

Two options, pick one:

1. Add `v*` to the deploy workflow's tag triggers, so a CLI release redeploys the
   site. Simple; couples the two deployables' _deploys_ while leaving their
   version lines separate, which the deploy workflow's own comment was written to
   avoid. Read that comment before choosing.
2. Read the version from the npm registry at build time, with the local
   `package.json` as fallback. Keeps the pipelines decoupled; still stale between
   deploys, just less often.

**Recommendation when this plan was written:** option 1, and update the workflow
comment to say why the coupling is now deliberate.

**That recommendation does not survive reading the comment, which is why this
task is still open.** `deploy-site.yml:4-11` does not merely prefer the
decoupling as a matter of taste — it records that the site releases through its
own release-please component, so `main` routinely holds site content that has
not been released yet. Adding `v*` to the deploy triggers would mean a CLI
patch release publishes whatever unreleased site content happens to be sitting
on `main`, with no site release PR and nobody deciding to ship it. That is a
worse failure than a stale badge, and it is silent.

A third option avoids both problems and was not considered when this plan was
written:

3. **Stop claiming a patch version.** The badge reads `v2`, matching the
   install command the page already shows (`npm i -g laqi@2`). It cannot go
   stale within a major, needs no new machinery, and no visitor chooses a mock
   server on a patch number.
   _Argument against:_ a precise version is weak evidence that the project is
   maintained, and `v2` gives that up. The counter is that the badge was never
   reliable evidence of freshness anyway — that is the defect.

**Recommendation now: option 3.** It removes the class of defect instead of
adding machinery to track it, and it is the only option that does not trade the
badge's correctness against the deploy pipeline's safety. Option 1 should be
taken only with a deliberate decision to couple the two deploys, and then the
workflow comment has to be rewritten rather than amended.

**Acceptance:** the deployed badge cannot disagree with what `npm i -g laqi@2`
installs, and no CLI release can publish unreleased site content.

### Task 6 — Align the landing's first step with the docs' first step

The landing says "write a JSON file"; the docs and `llms.txt` say `laqi init`,
which scaffolds three endpoints and three scenarios.

- `apps/site/src/components/QuickStart.astro:28-30` — step 01 becomes `laqi init`,
  with hand-written JSON as the "already have a contract" path, matching
  `apps/site/src/content/docs/docs/quick-start.md:13-20`.
- While in the file: the sample terminal output at `:47` hardcodes
  `⚡ laqi 2.0.0`. Either derive it or accept it as an illustrative sample — but
  not alongside a version badge claiming to be live.

**Acceptance:** the landing and `/docs/quick-start/` recommend the same first
command.

### Task 7 — Rename the example's scenarios to English

`examples/todo-app/laqi/scenarios.json` declares `backend-caido`,
`usuario-nuevo`, `sesion-expirada` and `red-lenta`. ADR-0009 requires English on
every user-facing surface and Plan 9 is recorded as having completed that
migration; this file was missed. `laqi init` already scaffolds in English
(`apps/cli/src/init/scaffold.ts:82-86`).

Proposed names, consistent with the init scaffold: `offline`, `new-user`,
`session-expired`, `slow-network`.

- Rename in `examples/todo-app/laqi/scenarios.json`.
- Update any reference in `examples/todo-app/README.md` and in the docs.

**Acceptance:** no Spanish identifier remains in a shipped example. Required
before any demo recording — these names appear in the panel, on camera.

### Task 8 — Decide on "the fifty times a day"

`apps/site/src/components/FeatureGrid.astro:22` is the page's only figure and it
supports nothing. Low cost, listed for completeness: keep it if it reads clearly
as rhetoric, replace it if anything demonstrable can take its place.

**Decided: replaced.** "the fifty times a day" presents a number as a fact about
the reader's own behaviour, which does not read clearly enough as rhetoric to
survive on a page whose credibility problem is unsupported claims. The heading
now names the triggering circumstance rather than counting it — the states a
real backend will not produce on demand — which is a mechanism claim and is what
the six cards actually deliver.

## Verification

- `bun run validate` — the existing gate covers format, lint, types, tests, the
  site build, the content lint and the link check.
- Manual: load the built site and confirm no placeholder text, one hero CTA, and
  a version badge matching `npm view laqi version`.
- Task 2's test is the only new test this plan requires.

## Explicitly not in this plan

| Excluded                                          | Where it is decided                             |
| ------------------------------------------------- | ----------------------------------------------- |
| Naming competitors; the category word in the hero | [Positioning](/design/positioning/)             |
| Who the page is written for                       | [Positioning](/design/positioning/), question 1 |
| The backend-handoff section and docs page         | [Backend handoff](/design/backend-handoff/)     |
| Whether laqi gains a proxy                        | [Backend handoff](/design/backend-handoff/)     |
| Recording the demos                               | [Page evidence](/design/page-evidence/)         |
| A YAML parser for OpenAPI                         | Undecided; see task 4                           |
