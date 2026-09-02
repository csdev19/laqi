# Briefings binding

Where laqi's briefings live and what regenerates them. Read by the
`generate-briefings` skill (global; source: `niway-dev/skills`). Paths are
relative to the repo root.

## Location

`apps/documentation/src/content/docs/product/` — this repo calls the set
**product**, and it is served by the internal Starlight docs app
(`apps/documentation`), which is never deployed publicly.

## Briefings in this repo

Canonical names on the left (what a scoped run is invoked with); this
repo's filenames on the right.

| Briefing         | File                 | Notes                                          |
| ---------------- | -------------------- | ---------------------------------------------- |
| `index`          | `index.md`           | one line per briefing, reader-first            |
| `pitch`          | `pitch.md`           |                                                |
| `ai-briefing`    | `ai-briefing.md`     | self-contained; carries a "current as of" date |
| `stack`          | `stack.md`           | one table per layer, each row states the why   |
| `roadmap`        | `roadmap.md`         | carries "Last reviewed"                        |
| `design-brief`   | `ai-design-brief.md` | self-contained; values mirror `tokens.css`     |
| `business-brief` | —                    | not created; founder not yet interviewed       |

## Sources of truth

| For                     | Read                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| shipped / in flight     | `gh pr list --state merged --limit 100`, `gh pr list --state open`                                                                 |
| CLI commands and flags  | `apps/cli/src/index.ts` (the usage block is authoritative)                                                                         |
| mock file format        | `packages/schema/src/` (`response.ts`, `endpoint.ts`, `config.ts`)                                                                 |
| MCP tools               | `packages/mcp/src/server.ts`                                                                                                       |
| stack                   | every `package.json` under `apps/` and `packages/` + `apps/documentation/src/content/docs/decisions/`                              |
| design values           | `packages/tokens/src/tokens.css` (authoritative), `apps/documentation/src/content/docs/design/design.md`, `assets/brand/README.md` |
| site copy / positioning | `apps/site/src/components/`, `apps/site/public/llms.txt`                                                                           |
| published version       | `npm view laqi version` vs `apps/cli/package.json`                                                                                 |

## Repo rules

- **Language:** English on every published surface, regardless of the
  language of the conversation.
- **Safe positioning:** "a controllable local API", "build your frontend
  before the backend is ready", "a local mock server with a control panel".
- **Never claim:** "create/replace your backend", a hosted production API
  or database, or that the control panel (`/__laqi`) is or can be exposed
  publicly — `--share` tunnels the mocks only.
- **No prerelease line:** the first v2 release is plain `2.0.0` (ruled
  2026-08-29). No beta, no prerelease dist-tag.
- **Release topology:** the CLI cuts `v*` tags (publishes to npm); the site
  cuts `site-v*` tags (deploys laqi.dev). They are independent.

## Validation

```sh
bun run build --filter=@laqi/documentation
```
