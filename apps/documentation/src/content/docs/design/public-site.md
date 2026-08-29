---
title: "laqi.dev — the site spec, reconciled with the codebase"
---

# laqi.dev — the site spec, reconciled with the codebase

**Status:** Review of an external spec against what this repository actually
contains. The original document's decisions in its §1 stand; this records the
eight places where it meets code that already exists, and what changes as a
result.

Read the original alongside this. Nothing here restates it — this is only the
delta.

## Rulings (2026-08-29)

After reviewing this delta, the author ruled on the open points. These rulings
override anything below that says otherwise:

1. **No beta.** v2 ships as plain `2.0.0` — the first version published when
   we decide to go to production. The prerelease machinery (versioning
   strategy, `beta` dist-tag as the default path) is removed. The
   `dist-tag.ts` guard stays as a safety net.
2. **The panel is not published to npm**, and the live demo / playground is
   deferred to a later iteration of the site — it does not block the initial
   launch. The transport extraction goes with it.
3. **The site is in English**, with a Spanish version considered from the
   start via Starlight's built-in i18n (English at the root, `es/` as a
   locale) — the same model the Astro, Vite and NestJS docs use. ADR-0009
   covers the product's surfaces (CLI, panel), not the site, so this is an
   addition, not a reversal.
4. **The new app hosts both the landing and the docs** — one Astro app,
   public, separate from `apps/documentation` (internal, never deployed).

## Two decisions the spec left open are already settled

**The npm name (§17.2).** The spec says to verify `laqi` is free before
investing. It is not free — **it is ours**. `laqi@1.2.1` was published in April
2022 from this account, and v2 goes out under the same name as plain `2.0.0`
(Ruling 1). No scope, no rename, no twenty places to touch. That decision is
closed.

**The changelog page (§2, `/docs/changelog/`).** release-please already
generates `CHANGELOG.md` at the repository root on every release. The docs page
renders that file; nobody writes it. See ADR-0010.

## The landing's install command constrains the launch order

§8 specifies a copyable install block reading `npm i -g laqi`.

Under Ruling 1 that string is correct — but only **after `2.0.0` is on npm**.
Today it installs the 2022 v1, an Express-based mock library with an
incompatible interface, because `latest` still points at `1.2.1`.

So the constraint is sequencing, not wording: **publish `2.0.0` before or
with the site launch, never after.** A live laqi.dev whose hero installs a
different program is worse than no site.

Whoever builds the landing should read the version from one place rather than
hard-coding it — the hero block and the version badge in the nav come from
the same source, and change once per release.

## `apps/documentation` already exists, and it is Starlight

The spec proposes `apps/site` as if starting from zero. This repository already
has an Astro + Starlight app at `apps/documentation` — 53 pages of ADRs,
implementation plans, design specs and analysis.

**Those are engineering records and must never appear on laqi.dev.** The
decision log explaining why Hono was chosen over Elysia is not user
documentation.

So the site is a second Starlight app, and both must not be confused:

|                  | `apps/documentation`            | `apps/site` (new)              |
| ---------------- | ------------------------------- | ------------------------------ |
| Audience         | us                              | users                          |
| Content          | ADRs, plans, design specs       | quick start, concepts, recipes |
| Deployed         | **never**                       | laqi.dev                       |
| In release scope | no — already in `exclude-paths` | no                             |

That `exclude-paths` entry in `release-please-config.json` already encodes the
intent: internal docs do not cut releases. `apps/site` joins it for the same
reason — a typo fix on the landing is not a version of laqi.

The alternative — one Starlight app serving both, with internal pages excluded
from the public build — trades a clear boundary for a build-time filter that
will eventually leak. Two apps, one public.

## Publishing `@laqi/panel` collides with the release topology

This is the largest consequence in the spec and it is unstated.

§10 says the panel should be "published as a monorepo package (`@laqi/panel`)
and the site imports it". Today the panel is `@laqi/editor`, `private: true`,
and tsdown inlines it into the CLI bundle. That is deliberate: **one tarball
ships, not six** (ADR-0010).

Publishing the panel makes a second published package. The release playbook's
closure rule then applies:

> Two deployables whose closures intersect must share one version line.

The CLI imports the panel. The site imports the panel. Their closures intersect
through it, so publishing it forces either a shared version line across the CLI
and the site, or a written compatibility contract between them — the site
holding a panel version older than the one the CLI ships, and both being fine
with that.

**Neither is necessary.** The site is built inside this monorepo, so it can
import the panel as a workspace dependency exactly as `apps/cli` does. No npm
publish, no second published package, no topology change. The panel stays
`private: true` and the single version line survives intact.

Publish the panel only if something outside this repository needs it. Nothing
does.

## The transport extraction is real work, and it pays for itself

§10's `LaqiTransport` interface is the right idea and the reasoning is correct:
the demo becomes the real panel rather than a mock that drifts.

Worth stating what it actually costs. The panel talks to `/__laqi/api/*` and an
SSE stream today, and `packages/server`'s control plane is already a defined,
tested contract — `getEndpoints`, `getState`, `setState`, `getScenarios`,
`subscribe` map onto routes that exist. So the interface is a description of
what is already there, not a new design.

The work is threading it through the components and writing `MemoryTransport`.
The second benefit the spec names — testability — is real: the panel's tests
currently reach for `fetch`.

## The spec's own consistency rule already caught something

§15 says: _"the same action is called the same everywhere: if the panel says
`Set live`, the docs say `Set live`."_

The rule is right. The example is already out of date. `Set live` was renamed to
**`Serve this`** / **`Serving`** because nobody could tell what it did until
they clicked it — and because the CLI's start screen already says
`serving  http://127.0.0.1:8000`, so the panel and the terminal now use one verb
for one idea.

Docs written against the old label would have been wrong before they shipped.
That is the rule working, one day early.

## Shared tokens need a mechanism, not an intention

§6 says `tokens.css` is "identical to the panel's — same hex, same names". The
panel's tokens live in `packages/editor/src/styles.css`, mixed into 1,324 lines
of component styling.

"Identical" maintained by hand diverges the first time someone adjusts a hairline
under deadline. Extract the token block into something both consume — a small
package, or a single CSS file imported by both. Until that exists, the claim in
§6 is aspirational.

The panel's palette is the source of truth, not the site's: the panel shipped
first and its colours are already in the terminal renderer too.

## The site is a second deployable, and it should not be tag-driven

§14 specifies Cloudflare Workers. Today there is exactly one deploy pipeline:
`release-npm.yml`, triggered by a `v*` tag cut by release-please.

The instinct will be to model the site the same way. Do not. The site is
content; a typo fix should reach laqi.dev without cutting a version of the CLI.
**Deploy the site on merge to `main`, not on a tag.** That keeps it out of the
version line entirely and removes the topology question before it is asked.

The performance budgets and the link validation in §13 and §14 belong in
`validate.yml`, which already gates every pull request — including stacked ones,
since it now triggers on all `pull_request` events rather than only those into
`main`.

## The content lint is cheap and worth doing first

§15 wants "Laqi" and "LAQI" to fail the build. That is a few lines in
`validate.yml` and it is the kind of rule that only works if it exists before
the content does — retrofitting it means fixing every page at once.

Add it with the first page, not the hundredth.

## `llms.txt` is half the agent story

§11 is thorough on documentation for LLMs. It omits that **laqi already ships an
MCP server with eleven tools**, which is the other half — and the stronger one.

A typed tool arrives in an agent's context with its schema and gets validated on
call. Prose has to be found, opened and believed. An agent that reads
`/docs/llm-prompt/` and never learns `laqi mcp` exists will write mock files by
hand when it could have called `create_endpoint`.

`/docs/llm-prompt/` must name the MCP server first and the file format second.
See `design/testing-mcp.md` for what the tools are and how they are tested.

## What did not change

Everything in §1. The single domain, `/docs` as a subpath, Astro, Starlight,
one repo and one build are all sound, and the rejections in that section are
argued correctly. `apps/documentation` being Astro + Starlight already is
independent evidence for the framework choice.

§8's ban list — no decorative gradients, no emoji, no invented testimonials, no
exclamation marks — matches the product's voice and the panel's restraint. Keep
it.

## Suggested first slice

The spec's own recommended writing order is right. In build terms, the smallest
thing worth deploying:

1. The new public app with the landing and the six core pages, plain CSS on
   shared tokens, no demo island. English at the root, Spanish as a Starlight
   locale (Ruling 3).
2. The content lint and the link validator in CI, before there is content to
   retrofit.

Deferred by Ruling 2, in this order when the time comes:

3. The transport extraction in the panel package.
4. The demo island, `client:visible`, with its static fallback.

The demo is the memorable part and it is also the part that can wait — a site
with six honest pages and a correct install command beats an empty one with a
live panel.
