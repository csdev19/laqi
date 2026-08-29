---
title: "Plan 09 — English migration: no Spanish left in the repository"
---

# Plan 09 — English migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan
> task-by-task.

**Goal:** Remove every trace of Spanish from the repository — source-code
comments, internal documentation content, directory names, file names, and
the docs app configuration — leaving only the deliberate exceptions listed
below.

**Why:** ADR-0009 (accepted 2026-08-27) already settled that the project's
writing language is English: code comments, commits, PRs, and documentation.
The code comments and the entire internal docs corpus predate that decision
and violate it. Ruled on 2026-08-29: migrate everything.

**Scale, measured on 2026-08-29:**

- ~49 source files carry Spanish comments (editor, core, server, schema,
  mcp, cli).
- 54 internal doc files, 15,564 lines, ~84,000 words of Spanish prose.
- 4 Spanish directory names, ~24 Spanish file names, and the Astro config
  (`defaultLocale: 'es'`, Spanish sidebar labels).

**Spec:** ADR-0009 (`decisiones/0009-sin-i18n.md`, which this plan renames
to `decisions/0009-no-i18n.md`) plus the rulings recorded in
`diseno/sitio-publico.md`.

## Global Constraints

- **Faithful translation, never reinterpretation.** ADRs, plans, and audits
  are historical records. Translate what they say, including decisions that
  were later amended (e.g., the beta line in ADR-0010 — its amendment is the
  authority, the body stays as the record). A translator who "fixes" a
  document has corrupted it.
- **Comments are why-comments.** The Spanish comments in the code explain
  reasoning, not syntax. Translate them fully; never delete or shorten one
  because translating is work.
- **Deliberate exceptions — the only Spanish that survives:**
  - The Quechua/Spanish etymology content in the name document and the
    README (llulla, chasqui, the glosbe.com links). That is subject matter,
    not prose language.
  - Verbatim quotes clearly attributed to a Spanish source, if any exist.
- **Renames go through `git mv`** in their own commits, separate from
  content translation, so git tracks the renames and `git log --follow`
  keeps working.
- **Gates on every task:** `bun run check:ci` (lint + format) and, for code
  tasks, `bun run check-types` (must report 11 of 11) and the full
  `vitest` suite. Note `check:ci` does NOT type-check.
- **Docs gate:** the documentation app must build
  (`bun run build` inside `apps/documentation`) after every docs task.
- Everything lands in **one PR** off `main`, commits per task, following the
  repo's PR-only workflow.

## The authoritative file lists

Lists in this plan are snapshots. At execution time, regenerate them — the
sweeps below are also the final acceptance gates (they must come back empty,
minus the deliberate exceptions):

```sh
# Accented characters anywhere in source:
grep -rln 'ó\|í\|á\|é\|ñ\|ú\|¿\|¡' packages apps/cli scripts examples \
  --include='*.ts' --include='*.tsx' --include='*.css' | grep -v node_modules

# Unaccented Spanish (word-boundary sweep):
grep -rln -E '\b(el|la|los|las|una?|que|para|porque|cuando|siempre|nada|así|aquí|también)\b' \
  packages apps/cli scripts --include='*.ts' --include='*.tsx' --include='*.css' \
  | grep -v node_modules

# Docs content:
grep -rln 'ó\|í\|á\|é\|ñ' apps/documentation/src
```

## Rename map

Directories:

| From | To |
| --- | --- |
| `conceptos/` | `concepts/` |
| `decisiones/` | `decisions/` |
| `diseno/` | `design/` |
| `planes/` | `plans/` |

Files (paths relative to `apps/documentation/src/content/docs/`; files not
listed keep their name):

| From | To |
| --- | --- |
| `analisis-v1.md` | `v1-analysis.md` |
| `nombre.md` | `the-name.md` |
| `probar-v2.md` | `trying-v2.md` |
| `prompt-editor-web.md` | `web-editor-prompt.md` |
| `conceptos/resolucion-de-estado.md` | `concepts/state-resolution.md` |
| `conceptos/tres-escritores.md` | `concepts/three-writers.md` |
| `decisiones/0002-hono-sobre-elysia.md` | `decisions/0002-hono-over-elysia.md` |
| `decisiones/0003-json-declarativo.md` | `decisions/0003-declarative-json.md` |
| `decisiones/0004-estado-fuera-de-git.md` | `decisions/0004-state-outside-git.md` |
| `decisiones/0006-servidor-mcp.md` | `decisions/0006-mcp-server.md` |
| `decisiones/0007-url-publica.md` | `decisions/0007-public-url.md` |
| `decisiones/0008-multiarchivo-y-nombres.md` | `decisions/0008-multifile-and-names.md` |
| `decisiones/0009-sin-i18n.md` | `decisions/0009-no-i18n.md` |
| `decisiones/0010-release-y-npm.md` | `decisions/0010-release-and-npm.md` |
| `diseno/revision-vs-decisiones.md` | `design/review-vs-decisions.md` |
| `diseno/sitio-publico.md` | `design/public-site.md` |
| `planes/2026-08-24-01-fundacion-y-servidor.md` | `plans/2026-08-24-01-foundation-and-server.md` |
| `planes/2026-08-25-02b-editor-web.md` | `plans/2026-08-25-02b-web-editor.md` |
| `planes/2026-08-25-03-servidor-mcp.md` | `plans/2026-08-25-03-mcp-server.md` |
| `planes/2026-08-25-04-url-publica.md` | `plans/2026-08-25-04-public-url.md` |
| `planes/2026-08-25-05-empaquetado.md` | `plans/2026-08-25-05-packaging.md` |
| `planes/2026-08-28-07-release-y-publicacion.md` | `plans/2026-08-28-07-release-and-publication.md` |
| `planes/auditoria-plan-01.md` | `plans/plan-01-audit.md` |
| `planes/auditoria-plan-06.md` | `plans/plan-06-audit.md` |
| `planes/auditoria-v2.md` | `plans/v2-audit.md` |
| `planes/2026-08-29-09-english-migration.md` | `plans/2026-08-29-09-english-migration.md` (this plan moves itself) |

Known external references to the renamed paths — regenerate this list at
execution time with `grep -rn 'diseno\|decisiones\|conceptos\|planes' ...`:

- `README.md` — links to `probar-v2.md`, `nombre.md`,
  `decisiones/0010-release-y-npm.md`
- `apps/cli/src/tunnel.ts` — link to `decisiones/0007-url-publica.md`
- `apps/documentation/astro.config.mjs` — the four `autogenerate`
  directories, the sidebar slugs, and the sidebar labels

## Tasks

### Task 1 — Code comments: `packages/editor` (~21 files)

Translate every Spanish comment in `packages/editor/src/**` (including
`styles.css`) and `packages/editor/vite.config.ts`. UI copy is already
English product copy — do not touch strings, only comments. Gates: sweep
greps clean for this package, `check:ci`, `check-types`, `vitest run` for
the package.

### Task 2 — Code comments: `packages/core`, `packages/schema`, `packages/server` (~15 files)

Same contract as Task 1 for those three packages.

### Task 3 — Code comments: `apps/cli`, `packages/mcp`, and everything the sweep still finds (~13 files)

Same contract; this task also owns the leftovers — test files, `scripts/`,
`examples/`, any file the regenerated sweep lists that Tasks 1–2 did not
cover. After this task the code sweeps must come back **empty**.

### Task 4 — Docs structure: renames, config, external links (no translation)

`git mv` every directory and file in the rename map. Update
`astro.config.mjs`: the `autogenerate` directories, sidebar slugs, sidebar
labels (`Inicio` → `Start`, `Contexto` → `Context`, `Conceptos` →
`Concepts`, `Decisiones` → `Decisions`, `Diseño` → `Design`, `Planes` →
`Plans`), and `defaultLocale` / root locale to English (`lang: 'en'`).
Update every internal cross-link inside the docs and the external
references (README, `tunnel.ts`). Spanish content at English paths is fine
at this point. Gate: the docs app builds with zero broken-link warnings.

### Tasks 5–9 — Content translation, one batch per area

One task per directory, ~11 files each, dispatched to a mid-tier model
(translation needs judgment; it is not transcription):

- Task 5: the five root pages + `concepts/` (8 files)
- Task 6: `decisions/` (11 files — includes frontmatter titles like
  "ADR-0002 — Hono over Elysia")
- Task 7: `design/` minus flows (12 files)
- Task 8: `design/flows/` (10 files)
- Task 9: `plans/` (13 files)

Each task: translate prose and frontmatter titles, keep code blocks,
tables, file paths, and product copy byte-identical unless they are
themselves Spanish prose. Gate per task: docs build green, sweep clean for
that directory.

### Task 10 — Final sweep and acceptance

Regenerate all three sweeps → empty (minus the etymology exception). Docs
build green. `check:ci`, `check-types` 11/11, full `vitest` suite. Confirm
`git log --follow` traces one renamed file as a rename, not a delete+add.

## Cost note

Tasks 5–9 are the expensive part: ~84,000 words of technical prose through
translation subagents. Nothing else in the plan comes close. If budget
matters, Tasks 1–4 alone already deliver an English-only codebase and an
English-named, English-configured docs tree, and each translation batch is
independently shippable afterwards.
