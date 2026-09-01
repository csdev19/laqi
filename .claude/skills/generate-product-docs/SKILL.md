---
name: generate-product-docs
description: Use when asked to create, refresh, audit, or update the product docs in apps/documentation/src/content/docs/product/ (pitch, ai-briefing, stack, roadmap, ai-design-brief, ai-business-briefing), after merging feature PRs, after publishing a release, or when a "Last reviewed" / "current as of" date on those pages has gone stale.
---

# Generate product docs

## Overview

The product docs decay by design — they carry date stamps and claims that
go stale with every merge. This skill regenerates them **from repo truth,
never from memory or plan documents**. Every factual claim gets verified
against its source before it is written.

## The docs and their sources of truth

Doc paths are relative to `apps/documentation/src/content/docs/product/`;
`decisions/` and `design/` are sibling folders under the same content tree.
Every other path is relative to the repo root.

| Doc                       | Audience                              | Regenerate from                                                                                                                                |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pitch.md`                | a person                              | positioning only — the live copy in `apps/site/src/components/`                                                                                |
| `ai-briefing.md`          | another AI, pasted whole              | CLI usage block (`apps/cli/src/index.ts`), schemas (`packages/schema/src/`), MCP tools (`packages/mcp/src/server.ts`), `npm view laqi version` |
| `stack.md`                | a dev evaluating                      | every `package.json` dependencies block + ADRs in `decisions/`                                                                                 |
| `roadmap.md`              | "what's the state of laqi"            | shipped = **merged PRs only** (`gh pr list --state merged --limit 100`); in-flight = open PRs (`gh pr list --state open`)                      |
| `ai-design-brief.md`      | an AI doing design work, pasted whole | `packages/tokens/src/tokens.css`, `design/design.md`, `assets/brand/README.md`, site components                                                |
| `ai-business-briefing.md` | an AI reasoning about the venture     | **the founder, not the repo** — see below                                                                                                      |
| `index.md`                | navigation                            | touch only when a doc is added or removed                                                                                                      |

## Process

1. **Gather truth first, write second.** Run the source commands in the
   table before editing anything. Also: today's date, and whether `laqi`
   2.x is on npm (`npm view laqi version`) — several docs carry
   pre-release warnings that must flip when 2.0.0 publishes.
2. **Update each doc per its contract:**
   - `roadmap.md` — move items shipped/in-flight/next strictly by merged
     PRs (plan documents lag and lie). Update **Last reviewed** only when
     the content beneath it was actually re-verified.
   - `ai-briefing.md` — refresh facts and the "current as of" date; it
     must stay self-contained (no links required to understand it).
   - `stack.md` — diff the tables against real `dependencies`: a dep with
     no row, or a row with no dep, is a bug. Keep ADR links.
   - `pitch.md` — most stable; rewrite only if positioning changed on the
     live site. Safe language: "controllable local API", "build your
     frontend before the backend is ready". Never: "create/replace your
     backend", anything implying a hosted production API.
   - `ai-design-brief.md` — self-contained like the ai-briefing: palette
     with semantic meanings, typography rules, structure, brand-asset
     conventions, voice. Exact hex values come from `tokens.css`, never
     from memory.
   - `ai-business-briefing.md` — records founder decisions. If a claim
     is missing or stale, **ask the user; never invent**. Only parts
     verifiable in the repo (e.g. pricing shown on the site) may be
     updated without asking.
   - `index.md` — keep its bullet list exactly matching the docs that
     exist: one line per doc, audience-first, same order as this table.
3. **Creating a doc from scratch:** Starlight frontmatter (`title`,
   `description`), a top `#` heading, and — for the two `ai-*` briefs — a
   leading blockquote saying how to use it and a "current as of" date.
   Match the tone of the existing docs in the folder.
4. **Validate:** `bun run build --filter=@laqi/documentation` must pass
   (it catches bad sidebar slugs), and for every link you wrote or
   touched, confirm the target file exists in the content tree.

## Hard rules

- Everything published is **English**, regardless of chat language.
- A claim you did not verify this session does not go in a doc.
- Scoped runs: `/generate-product-docs roadmap` (or any doc name)
  refreshes only that doc — same process, one contract.

## Common mistakes

| Mistake                                           | Reality                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| Trusting `plans/` or `design/` status lines       | Only merged PRs prove shipped. Those docs record intent, not state. |
| Inventing business facts to fill the briefing     | The repo has no business source of truth. Interview the founder.    |
| Bumping a date stamp without re-verifying content | The date is a promise that everything under it was checked today.   |
| Writing hex values or dep versions from memory    | Read `tokens.css` / `package.json` in-session; memory drifts.       |
| Mirroring chat Spanish into a doc                 | Published artifacts are English. Always.                            |
