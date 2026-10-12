---
title: ADR-0022 — MCP overwrites are confirmed by the client, never by a tool argument
---

# ADR-0022 — MCP overwrites are confirmed by the client, never by a tool argument

**Status:** Proposed
**Date:** 2026-10-12
**Ticket:** [NIW2-314](https://linear.app/niway/issue/NIW2-314)
**Spec:** [MCP tool safety](/design/mcp-tool-safety/)

## Context

Five MCP tools can discard content a person wrote: `apply_generated_body` over a hand-written body, `update_endpoint` when it omits responses, `delete_endpoint`, `import_openapi` with `overwrite`, and `refresh_schema` when the re-read schema is an approximation. Today each is guarded by a boolean the agent passes — `confirm`, `overwrite`, `allowLoss` — and a description that says "Ask the person first". The server cannot tell whether anyone was asked. A prompt-injected agent sets the flag itself, and nothing in laqi involves a human.

The adapters spec wrote that rule down as the best available at the time: "A transport that cannot ask (MCP) returns the conflict and requires a follow-up call with `confirm: true`". The panel, which can ask, uses a single-use token a person redeems. MCP had no equivalent channel.

It has one now. MCP elicitation lets a server ask the user a small structured question through the client's own UI during a tool call; the client declares the capability at connect time. Claude Code ships it (2.1.76; VS Code and Cursor unverified at the time of writing), the 2026-07-28 protocol revision made it a first-class multi round-trip result, and the TypeScript SDK laqi uses (1.30) exposes it over stdio. Not every client has it, and a headless session cannot show a dialog.

## Decision

1. For a gated write, when the connected client declares form-mode elicitation, **laqi asks the person itself** and ignores the agent's flag. The question names the endpoint, the file, and what is discarded; the answer is a two-option enum (`proceed` / `keep`). Anything but an explicit `proceed` refuses the write.
2. When the client cannot ask, the flag keeps its current meaning, the tool is annotated `destructiveHint: true` so the host can prompt, and a rolling pre-write copy of the mock file is kept under `.laqi/backup/`.
3. `laqi.config.json` can pin the fallback: `"mcp": { "confirmations": "flags" }`. It is a standing decision written by hand in a file MCP cannot write, the same posture as `mcp.modules`.
4. A declined or cancelled question is final for that call. laqi never honors the flag on a retry while the client can ask; the opt-out is the config key, not a second call.

## Alternatives rejected

**Keep the flags and rely on tool annotations alone.** Simplest; the host's own prompt is the gate. Rejected because the annotation is a hint the spec tells clients to treat as untrusted, hosts differ in whether and when they prompt, and the flag would still be the thing laqi reads.

**Refuse every gated write when the client cannot elicit.** No self-asserted flag survives. Rejected because it makes `laqi mcp` unusable on clients without elicitation and in headless runs, which pushes every such user to the opt-out permanently — the same state as the fallback, with more friction and no backup.

**A panel-style token the person redeems in the terminal.** Consistent with module approval. Rejected because an MCP session has no terminal of its own (stdout is the protocol channel) and the client already provides the UI the token would need; building a second channel beside elicitation duplicates it.

**Honor the flag after a declined or cancelled elicitation.** Lets a headless client proceed without config. Rejected because an automated client cancels every time, which turns the gate back into the flag.

**Ten timestamped backups per file.** More forgiving. Not adopted by default: one rolling copy is a last-write net, not a history, and git holds the history for committed work. Left as a question to the owner.

## Consequences

- An agent on Claude Code or VS Code sees a dialog before laqi discards content, and no longer needs the flags; agents that still pass them are not harmed.
- Tool descriptions stop saying "Ask the person first" and say what actually happens in each regime.
- `.laqi/backup/` appears, one file per mock file, outside git (ADR-0004). The copy is taken outside core's file lock, so a panel write landing between copy and write is not in it.
- The server logs the active regime once to stderr at startup, so a person watching the terminal knows whether laqi will ask.
- The adapters spec's MCP row is amended: the conflict-plus-`confirm` loop becomes the fallback branch.
- When laqi moves to the TypeScript SDK 2 line and the 2026-07-28 multi round-trip pattern, only `ask.ts` changes; the gates and the fallback do not.
- The agent-first CLI's verbs get the same gates through an `ask` port, supplied by a TTY prompt or `--yes`; a flag is a human's flag there.

## Non-goals

- Gating reads, previews, or state flips (`set_response`, `set_scenario`, `reset_state`); nothing a person wrote is lost by them.
- Gating body edits made through `update_endpoint` that keep every response; there is no per-endpoint revision or hash to compare today (open question in the spec).
- Replacing the panel's module-approval token with elicitation; the panel can already ask.
- Sandboxing what an approved write does. This decides who confirms, not what is possible.

## Reopen condition

- A major client that laqi users rely on is observed auto-accepting elicitation (making the dialog a rubber stamp), or the MCP spec removes form-mode elicitation. Then the gate must move back into the server (token or interactive TTY) or the fallback must become refusal.
- Every client laqi documents supports elicitation and headless use is shown to go through hooks rather than cancellation. Then the `"flags"` fallback can be removed.
