---
title: laqi internal documentation
description: Log of decisions, concepts, design and plans for the laqi v2 rewrite.
---

# laqi internal documentation

This site is the **decision log** for the laqi v2 rewrite (it used to live in
`docs/` and `documentacion/` at the monorepo root; it is now published from
`apps/documentation` with Astro + Starlight).

What's here is the _why_: the evidence that justified scrapping v1, the
criteria used to choose each piece, and the alternatives that were discarded,
along with the reason. It was originally written in Spanish, the language it
was discussed in, and translated to English as part of the project's move to
English everywhere ([ADR-0009](/decisions/0009-no-i18n/)).

## How to read it

If you are new here, in this order:

1. **[v1 analysis](/v1-analysis/)** — what existed, what worked, what was
   broken and what was dangerous. With reproducible evidence. It is the
   foundation for everything else.
2. **[Concepts](concepts/)** — the two cross-cutting principles that govern
   several decisions at once.
3. **[Decisions](decisions/)** — one ADR per structural decision.
4. **[Design](design/)** — the control panel, and the review of that design
   against the ADRs.

## Index

### Concepts

| Doc                                             | What it covers                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| [The three writers](/concepts/three-writers/)   | The principle that decides the format, the validation and where the state lives |
| [State resolution](/concepts/state-resolution/) | The three layers that decide which response an endpoint returns                 |

### Design

| Doc                                                 | What it covers                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| [Editor prompt](/web-editor-prompt/)                | The brief handed to Claude Design                                     |
| [Control panel design](design/)                     | What came back: screens, interactions, F1–F9 flows                    |
| [Review vs decisions](/design/review-vs-decisions/) | 13 findings: 1 security blocker, 1 structural, and the open questions |

### Decisions

| ADR                                          | Decision                                               | Status                       |
| -------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| [0001](/decisions/0001-rewrite-v2/)          | Full rewrite instead of fixing v1                      | Accepted                     |
| [0002](/decisions/0002-hono-over-elysia/)    | Hono as the HTTP framework                             | Accepted                     |
| [0003](/decisions/0003-declarative-json/)    | Declarative JSON as the primary format                 | Partially superseded by 0008 |
| [0004](/decisions/0004-state-outside-git/)   | Active state is not tracked                            | Accepted                     |
| [0005](/decisions/0005-monorepo/)            | Monorepo aligned with rakoi                            | Accepted                     |
| [0006](/decisions/0006-mcp-server/)          | MCP server as a first-class piece                      | Accepted                     |
| [0007](/decisions/0007-public-url/)          | Public URL: cloudflared first, self-hosted relay later | Accepted                     |
| [0008](/decisions/0008-multifile-and-names/) | Multi-file with `"METHOD /path"` keys, and names       | Accepted                     |

## ADR convention

Every decision follows the same structure: **Context** (what problem existed),
**Decision** (what is being done), **Alternatives considered** (what was
discarded and why) and **Consequences** (the good _and_ the cost).

An ADR is never edited when its author changes their mind: a new one is
written that supersedes it, and the old one is marked `Superseded by NNNN`.
The value is in being able to read the history of the reasoning, not in the
document always being up to date.
