---
title: Plan 16 — Docs housekeeping
---

# Plan 16 — Docs housekeeping

**Date:** 2026-10-07
**Linear:** [NIW2-103](https://linear.app/niway/issue/NIW2-103)
**Reference:** `origin/main` at `ee34302`

Bring the internal docs in line with `main`. The roadmap was last reviewed on
2026-09-02, the plans index still listed Plans 11–14 as **Planned**, and the
JSON Schema spec header still said phases 2–6 had not started.

Every status below was checked against `gh pr list --state all` and
`git log origin/main` on 2026-10-07, not against the plan documents.

## What the PRs say

| Work                                           | PR(s)                           | State on 2026-10-07 |
| ---------------------------------------------- | ------------------------------- | ------------------- |
| Plan 11 — response scaffolding                 | #54                             | Merged 2026-09-03   |
| Plan 12 — package-manager toggle               | #55                             | Open                |
| Plan 13 — terminal output, stage 2             | #56                             | Open                |
| ADR-0013 — mocks remember their model          | #61                             | Merged, superseded  |
| Plan 14 — JSON Schema spec                     | #62                             | Merged 2026-09-09   |
| Plan 14 — phases 1–2 (goldens, compiler)       | #63 (into the spec branch), #64 | Merged 2026-09-09   |
| Plan 14 — phases 3–6 (stored schema, adapters) | #65                             | Merged 2026-09-10   |
| Plan 15 — laqi.dev fixes and the v3 home       | #68                             | Merged 2026-10-05   |
| Hero demo, getting ready to record             | #71                             | Merged 2026-10-05   |
| Data-type fidelity (numbers, dates, > 2^53)    | #73                             | Merged 2026-10-06   |
| Hero demo recording published on laqi.dev      | #74                             | Merged 2026-10-07   |
| Releases: `laqi` 2.1.0, site 0.2.0 and 0.3.0   | #50, #48, #75                   | Merged              |
| Editor saved vs live state                     | #66                             | Open                |

## Tasks

- [ ] `product/roadmap.md`: new review date, the shipped table extended
      (Plan 11, Plan 14, stored schema, v3 home, hero demo, data-type
      fidelity, 2.1.0), In flight lists the three open PRs, and the
      "Next" sections that have since shipped or got a PR say so.
- [ ] `plans/index.md`: status column fixed for 11–14, Plan 14 and Plan 16
      added to the table, the header paragraph no longer calls 14 and 15
      proposals.
- [ ] Plan 14's own status line, and Plan 15's.
- [ ] `design/json-schema-adapters.md`: status header says all six phases are
      implemented, with the PRs.
- [ ] `adversarial/storing-models-in-mocks.md`: marked resolved, with a short
      "Outcome" section pointing at what Plan 14 decided.
- [ ] Duplicate keys within one JSON file: documented on laqi.dev's
      [mock files](https://laqi.dev/docs/mock-files/) page (the place a user
      reads the file format), and the Plan 1 audit item marked done.
- [ ] The durable fix for the hand-maintained status column: proposed below.
      Not built in this plan.

## Durable fix — proposal: derive plan status from PR state

The status column has drifted twice (fixed 2026-09-02, again here). Every
time, the plan documents were right about _what_ and wrong about _whether_,
because "merged" is a fact GitHub already holds and the docs copy it by hand.

**Proposal.** Each plan declares the PRs that implement it in frontmatter, and
the status is computed from them, never written:

```yaml
---
title: Plan 11 — Response scaffolding on create
prs: [54]
---
```

1. A script, `scripts/docs/plan-status.ts`, reads every `plans/*.md`
   frontmatter, asks `gh pr view <n> --json state,mergedAt` for each PR, and
   derives one status per plan: **Merged** (every PR merged), **In review**
   (at least one open), **Planned** (no PRs listed), **Abandoned** (all
   closed unmerged).
2. It writes `plans/status.json` (committed), and the plans index renders its
   status column from that file through a small Astro component, so the
   Markdown table no longer has a status column to forget.
3. It runs in two places: by hand (`bun scripts/docs/plan-status.ts`), and in a
   scheduled workflow that opens a PR when `status.json` changes. It never
   runs in `validate.yml`: a PR gate that depends on the GitHub API state of
   _other_ PRs would go red for reasons the PR under review did not cause.
4. `--check` mode exits non-zero when a plan's `**Status:**` prose line
   contradicts the derived state, so the prose cannot drift either.

**Why not now.** It touches the docs app's rendering, needs a workflow with a
token that can open PRs, and changes the format of every plan's frontmatter.
That is a feature, not housekeeping, and deserves its own review.

**Open question for Cristian.** Whether the derived status should also feed the
roadmap's "Shipped" table, or the roadmap stays curated prose (it groups by
feature, not by plan, so it is not a one-to-one mapping).
