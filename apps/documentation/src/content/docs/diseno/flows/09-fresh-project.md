---
title: F9 — Start a fresh project
---

# F9 — Start a fresh project

**Frequency** once per project · **Surface** endpoint pane

## State

`./mocks/` is watched but contains no JSON files, so zero endpoints are loaded.

## What is shown

1. `No endpoints loaded` — serif heading, left-aligned, top of the pane.
2. One sentence naming the watched folder and saying that anything created here
   is written to `mocks/api.json`.
3. A copy-pasteable minimal mock file: one endpoint, three responses
   (`ok` / `empty` / `boom`) — the shape of the whole product in nine lines,
   including the fact that responses come in sets.
4. `Create first endpoint` (→ F6) and `Copy example file`.
5. The request log alongside shows its own waiting state.

## What is deliberately absent

No illustration, no tour, no "welcome to laqi", no feature list, nothing
vertically centred. The empty state is a paste target: the fastest exit from it
is a file, and the snippet is that file.

## Exit

Save a JSON file in the folder → the watcher fires → the list populates in file
order, no reload, no confirmation.
