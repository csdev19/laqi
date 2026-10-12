---
title: ADR-0021 — Mock files are never read through symbolic links
---

# ADR-0021 — Mock files are never read through symbolic links

**Status:** Proposed
**Date:** 2026-10-12
**Ticket:** [NIW2-313](https://linear.app/niway/issue/NIW2-313)
**Implementation:** not implemented; design in [Core hardening — design spec](../specs/core-hardening.md) §1

## Context

The loader walks the mocks folder and reads every `*.json` it finds. On `main` it skips dotfiles and does not recurse into symlinked directories (`Dirent.isDirectory()` is false for a link), but it does read a symlinked _file_, and in single-file mode it reads `laqi.json` even when that is a link. When the target is not JSON, the parse error carries a four-line excerpt of the file, and that excerpt is served by `/api/status`, shown in the panel and returned to coding agents by the MCP `list_endpoints` tool.

So a repository can ship `laqi/leak.json -> ~/.aws/credentials` or `laqi.json -> .env`, and the first lines of the victim's secrets reach every laqi output the moment they run `npx laqi`. The agent channel makes it an exfiltration path, not just a display bug. This is CWE-59 (improper link resolution before file access), and [ADR-0006](/decisions/0006-mcp-server/) already requires MCP to be "strictly scoped to the mocks directory" — for writes. Reads had no equivalent rule.

Other dev servers draw the same line: Vite's `server.fs` refuses to serve outside the workspace root by default and denies `.env`, `.git` and key files even inside it.

## Decision

**A symbolic link found inside the mocks area is never followed.** Neither a linked file nor a linked directory is read; in single-file mode a `laqi.json` that is itself a link is refused. Each link is reported as a load error that names the link's path and a fixed message (`symbolic links are not loaded — copy the file into the mocks folder instead`), with no excerpt and no target path.

The path the user _configured_ (`--dir`, `--file`, or the config defaults) may itself be a symlink: the user chose it, and the writer already supports a mocks directory reached through a link.

Excerpts are built only for regular files that passed this rule, and are clipped to 200 characters per line.

## Alternatives rejected

- **Follow a link when its real path stays inside the real mocks root.** Gives up the strictness for a feature nobody asked for: it would let a monorepo share one mock file between two packages by link, but the write path renames over links (the shared file would silently become a private copy on the first panel edit), directory links would still not be followed, and the check-then-read window needs `O_NOFOLLOW`, which Node lacks on Windows.
- **Follow links but suppress the excerpt for targets outside the root.** Gives up nothing visible, but still parses the foreign file (its top-level keys appear in per-key error messages) and still loads a foreign file that happens to be valid JSON as endpoints.
- **Do nothing and document "do not clone untrusted repos".** Gives up the one property the audit asked for — no content from outside the mocks root in any output — for a tool whose MCP server is meant to be run against repositories the user did not write.

## Consequences

- A project that linked individual mock files into `laqi/` loses those endpoints and gets one error per link, with the remedy in the message. No such project is known; the change is listed under "security" in the changelog.
- The loader's `LoadError` gains an optional `kind: 'symlink'` (and `'too-large'` for the size cap). Consumers that print `message` need no change.
- The existing C2 loader test, which used a dangling link to simulate a file vanishing between scan and read, must be rewritten with a regular file.

## Non-goals

- Hard links. A hard link _is_ the file; no link resolution happens and nothing can be done about it in userland.
- Bind mounts, junctions and other OS-level aliases outside the symlink model.
- Links in the schema-source root (`schemaSources.root`). Those are governed by `resolveSourcePath`, which follows links but requires the real path to stay inside the source root and refuses hidden paths; see the spec §2.

## Reopen condition

A documented user layout that needs linked mock files (for example a monorepo sharing one `laqi/` across packages) _and_ a write path that preserves links instead of renaming over them. Then the "follow if inside the real root" alternative becomes the right answer, implemented with `O_NOFOLLOW` where available.
