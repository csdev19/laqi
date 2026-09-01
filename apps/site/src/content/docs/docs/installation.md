---
title: Installation
description: Install the laqi binary — npm, requirements, and verifying it runs.
---

```sh
npm i -g laqi@2
```

The `@2` pin matters: it installs laqi 2.x specifically, never an older
major. One global binary, no account, no cloud, no project dependencies.

Prefer not to install globally? `npx laqi@2` runs it on demand, and
`npm i -D laqi@2` pins it per-project so the whole team gets the same
version.

## Requirements

- Node.js 20 or newer.

## Verify

```sh
laqi --version
```

## Next step

Installation is not the goal — a response flipping in the panel is.
Head to the [Quick start](/docs/quick-start/): scaffold a mock API with
`laqi init` and watch your frontend meet its empty state a minute from
now.
