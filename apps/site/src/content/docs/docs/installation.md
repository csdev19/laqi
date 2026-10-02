---
title: Installation
description: Install the laqi binary — npm, requirements, and verifying it runs.
---

Two ways, and the second is the one to pick for a team.

## Globally

```sh
npm i -g laqi
```

One binary on your PATH, usable in any project. No account, nothing added
to the project you are working on.

## As a dev dependency

Better when more than one person runs it, because the version is then part
of the repo rather than part of each machine:

```sh
npm i -D laqi
```

Add a script so nobody has to remember the command:

```json
{
  "scripts": {
    "mock": "laqi"
  }
}
```

Then `npm run mock` serves `./laqi/` and opens the panel, using the version
the lockfile pins. A teammate who clones the repo and runs `npm install`
gets the same laqi you have, which a global install cannot promise.

`npx laqi` runs it without installing anything, which is fine for a look
but downloads on every cold run.

This is what [`examples/todo-app`](https://github.com/csdev19/laqi/tree/main/examples/todo-app)
does — its `mock` script runs laqi from the project, beside the frontend's
own `dev` script, so the two processes start the same way.

## Requirements

- Node.js 20 or newer.

## Verify

```sh
laqi --help
```

That prints the command list. laqi has no `--version` flag — the version
is in the startup banner every time you run it, on the first line beside
the name:

```
⚡ laqi 2.1.3
serving   127.0.0.1:8000
```

(An illustrative number. Yours is whatever you installed.)

## Next step

Installation is not the goal — a response flipping in the panel is.
Head to the [Quick start](/docs/quick-start/): scaffold a mock API with
`laqi init` and watch your frontend meet its empty state a minute from
now.
