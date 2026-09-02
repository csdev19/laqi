---
title: Decision records (ADRs)
---

# Decision records (ADRs)

One ADR per structural decision. Each answers _why_ something was done, not
_how_ it is used.

| ADR                                               | Decision                                               | Status                       | Date       |
| ------------------------------------------------- | ------------------------------------------------------ | ---------------------------- | ---------- |
| [0001](/decisions/0001-rewrite-v2/)               | Full rewrite instead of fixing v1                      | Accepted                     | 2026-08-24 |
| [0002](/decisions/0002-hono-over-elysia/)         | Hono as the HTTP framework                             | Accepted                     | 2026-08-24 |
| [0003](/decisions/0003-declarative-json/)         | Declarative JSON as the primary format                 | Partially superseded by 0008 | 2026-08-24 |
| [0004](/decisions/0004-state-outside-git/)        | Active state is not tracked                            | Accepted                     | 2026-08-24 |
| [0005](/decisions/0005-monorepo/)                 | Monorepo aligned with rakoi                            | Accepted                     | 2026-08-24 |
| [0006](/decisions/0006-mcp-server/)               | MCP server as a first-class piece                      | Accepted                     | 2026-08-24 |
| [0007](/decisions/0007-public-url/)               | Public URL: cloudflared first, self-hosted relay later | Accepted                     | 2026-08-24 |
| [0008](/decisions/0008-multifile-and-names/)      | Multi-file with `"METHOD /path"` keys, and names       | Accepted                     | 2026-08-24 |
| [0009](/decisions/0009-no-i18n/)                  | No i18n: English everywhere                            | Accepted                     | 2026-08-27 |
| [0010](/decisions/0010-release-and-npm/)          | release-please, one version line, npm beta line        | Accepted                     | 2026-08-28 |
| [0011](/decisions/0011-panel-plain-react-spa/)    | The panel is a plain React SPA, not a meta-framework   | Accepted                     | 2026-09-01 |
| [0012](/decisions/0012-effect-first-in-generate/) | Effect-first inside `@laqi/generate`, and nowhere else | Accepted                     | 2026-09-02 |

## Structure

**Context** — what problem existed. **Decision** — what is done.
**Alternatives considered** — what was discarded and why. **Consequences** —
the good and what it costs.

A decision that changes is not edited: a new ADR is written that supersedes
it, and the old one is marked `Superseded by NNNN`.
