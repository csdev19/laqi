---
title: Quick start
description: From nothing to a controllable local API, and a response flipped from the panel, in under a minute.
---

The goal of this page is not to install a binary — it is to watch a
response change. Under a minute, four steps.

## 1. Scaffold a mock API

```sh
npm i -g laqi@2
laqi init
```

`laqi init` writes a `laqi/` folder with a small todos API — `GET /todos`,
`POST /todos`, `POST /auth/login` — each endpoint carrying named
responses (`ok`, `empty`, `error`, …) and three ready-made scenarios:
`offline`, `logged-out`, and `empty-state`.

Already have a contract? Skip the scaffold and write your own file —
see [Mock files](/docs/mock-files/) — or import an OpenAPI document.

## 2. Run it

```sh
laqi
```

That serves the folder at `http://127.0.0.1:8000` and opens the control
panel at `http://127.0.0.1:8000/__laqi`. (`laqi start` is the same
command, spelled out.) The folder is watched: edit a file and the server
picks it up, no restart.

## 3. Point your frontend at it

Change one base URL — nothing else in your app:

```sh
# .env.local
VITE_API_URL=http://127.0.0.1:8000
```

No frontend handy? `curl` proves the same thing:

```sh
curl http://127.0.0.1:8000/todos
```

## 4. Flip a response

Open [http://127.0.0.1:8000/\_\_laqi](http://127.0.0.1:8000/__laqi), find
`GET /todos`, and click **empty**. Request again — the list is empty.
Click **error** — it fails with a 500. Your frontend just met two states
the real backend would have made you wait for.

That is the whole product in one motion: a local API you control, and a
panel that puts any endpoint in any state.

## Where to go next

- [The control panel](/docs/panel/) — scenarios, the request log, ⌘K.
- [Mock files](/docs/mock-files/) — the JSON format, for writing your
  own contract.
- [Resolution layers](/docs/concepts/resolution-layers/) — why that
  response won, every time.
