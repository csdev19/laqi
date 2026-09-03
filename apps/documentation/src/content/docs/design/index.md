---
title: Control panel design
---

# Control panel design

Design of `packages/editor`, produced with Claude Design from the brief in
[prompt-editor-web](/web-editor-prompt/).

> **Before implementing, read [review-vs-decisions](/design/review-vs-decisions/).**
> Thirteen findings, one of them a blocking security hole (`/__laqi` would be
> exposed through the tunnel) and another that already changed a decision
> ([ADR-0008](/decisions/0008-multifile-and-names/)).

## Contents

| File                                                | What it contains                                                |
| --------------------------------------------------- | --------------------------------------------------------------- |
| [design](/design/design/)                           | Tokens, palette, typography, layout, API contracts              |
| [screens](/design/screens/)                         | What's in each screen and region, and why                       |
| [interactions](/design/interactions/)               | Inventory of interactive elements, states, and the keyboard map |
| [state-model](/design/state-model/)                 | The four resolution layers and their precedence rules           |
| [flows/](/design/flows/)                            | One file per flow (F1–F9): trigger, steps, states, failures     |
| [review-vs-decisions](/design/review-vs-decisions/) | The review against the ADRs                                     |

## Beyond the panel

This folder has grown past the control panel it was named for. The design docs
that are not about `packages/editor`:

| File                                            | What it contains                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| [terminal-output](/design/terminal-output/)     | The three terminal screens, the four shortcut keys, and the staging       |
| [public-site](/design/public-site/)             | laqi.dev — the spec, the reconciliation delta, and the 2026-08-29 rulings |
| [laqi-init](/design/laqi-init/)                 | The `laqi init` scaffold flow and its five questions                      |
| [data-generators](/design/data-generators/)     | Types from live responses, and seeded data from a pasted model            |
| [agent-facing-docs](/design/agent-facing-docs/) | What agents read, and how it differs from what people read                |
| [testing-mcp](/design/testing-mcp/)             | How the MCP surface is tested over real stdio                             |
| [websocket-mocking](/design/websocket-mocking/) | **Open design.** The two questions that block a WebSocket plan            |

**Still needs to be brought over:** `Laqi Control Panel.dc.html`, the reference
interactive prototype. It lives in the design project and can't be
reconstructed from here — copy it into this folder when you can, because
[design](/design/design/) cites it as the source of the exact values.

## Corrections already known

The documents are **verbatim as delivered**. These corrections are already
decided and need to be applied during implementation — they weren't edited
here so the record of what was delivered stays intact:

| Where                                     | Correction                                                                   | Source                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Header, error banner, F6, F8, F9, SCREENS | `./mocks/` → `./laqi/`, `mocks/api.json` → `laqi/api.json`                   | [ADR-0008](/decisions/0008-multifile-and-names/) |
| API contracts                             | Every `/__laqi/*` returns 404 through the tunnel                             | H1                                               |
| API contracts                             | Missing `DELETE /__laqi/api/endpoints/:id`                                   | H8                                               |
| Detail, HEADERS box                       | `x-laqi-resolved` moves out of the editable headers, and carries `(<layer>)` | H4                                               |
| Error banner                              | Also for semantic errors, not just parsing errors                            | H5                                               |
