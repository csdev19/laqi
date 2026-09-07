---
title: The control panel
description: What every part of the panel does — flipping responses, the request log, the command palette, and sharing publicly.
---

`/__laqi` is a local web panel over the same control-plane API laqi uses
internally. It is the fastest way to do the thing you do fifty times a
day — flip which response an endpoint serves — without touching a file
or restarting anything.

## Flipping a response

Every response is a visible chip on its endpoint's row. Clicking one
makes it live immediately — no file edit, no restart. Clicking the
file's own default again removes the override rather than writing an
identical one back.

The list tells you what changed without opening anything:

- **Magenta** rows are overridden by you, right now.
- **Violet** rows were moved by an active scenario.
- Each row names the layer that decided it — the same word the
  `X-Laqi-Resolved` header uses. See
  [Resolution layers](/docs/concepts/resolution-layers/) for the full
  precedence order.

## Scenarios

The scenario strip moves several endpoints at once — activate
`offline` or `checkout-broken` with one click instead of flipping each
endpoint by hand. Only one scenario is active at a time; a
per-endpoint override still beats it on any route it targets.

## The request log

A live log sits beside the endpoint list, never behind a tab. Requests
that matched no route get the loudest row in the pane, because "why is
my mock not answering?" is the most common confusion a mock server
produces. Clicking a row jumps to the endpoint that served it.

## The command palette

`⌘K` reaches any endpoint/response pair by name — typing `orders boom`
flips `POST /orders` to its `boom` response without touching the mouse.

## Editing an endpoint

The endpoint detail view edits the definition itself — status, delay,
body, response names — and writes it back to the file it came from. It
also hands you a ready-made `curl` carrying `X-Laqi-Response`, and the
[data generation](/docs/data-generators/) tools: paste a model for a
realistic body, or copy the current response's types in twenty-five
languages.

## Three ways to say what it returns

**+ New endpoint** offers **blank**, **from a model** and **from JSON**. The
path, the response name and the status mean the same thing in all three and
never move; only the source of the body changes. Blank writes a placeholder,
a model generates realistic data from your types, and JSON takes the body
you paste, exactly as pasted. Once it exists, the endpoint detail turns that
body back into types in twenty-five languages, and regenerates it.

The status field is also the catalogue's search box, so it accepts whatever
you type; what it will not accept is a code that is not one. `201e44` reads
as a number to JavaScript and used to reach the mock file, coming back as a
complaint about integer limits. It is now refused where it was typed.

## Pasting a model

**+ New endpoint → from a model** opens a small code box, not a form field.
It highlights TypeScript and behaves the way an editor does: `Tab` indents
(`Shift+Tab` outdents), `Enter` keeps the indentation and opens a block
between `{}`, and brackets and quotes close themselves. Native undo still
works. TypeScript is the only language today; the box is built to grow.

The response name and the status sit beside the path in both flows: the
model decides the body, not what the response is called or what it returns.

A model file declares several types, and the parser generates from the
first exported one, which is rarely the one you meant. Name the type in the
box to settle it, or leave it empty and the panel reports which declaration
it used. The examples fill it in for you.

The JSON flow has its own examples, and one of them is deliberately the
same data the **flat** model describes. Paste it, create the endpoint, then
ask that response for its types: what comes back is the interface the model
declares, give or take what JSON cannot carry — a date arrives as a string,
and an absent optional field is not there to be seen. That is the way round
from a body you already have to the model behind it.

Four ready-made models sit in the corner of the box — **simple**,
**medium**, **complex** and **flat** — and fill it with one click, so there
is something to paste on the first run. The complex one nests four levels
deep and mixes unions, intersections, `Pick`/`Omit`, tuples and `readonly`,
which is about as dirty as a real model file gets. The flat one goes as
wide without inheriting anything: one interface, no helper types, every
level written inline. The same four models are what the parser's tests run
against.

## Seeing what a response is

The detail pane shows the response's types, not just a button that copies
them. What it shows depends on where the body came from, and it says which:

- **Generated from a model.** The model is stored beside the body it
  produced, so the pane shows it exactly as pasted, every declaration
  included. That is the only place the literal unions, optional fields and
  tuples survive: a body cannot carry them.
- **Anything else** — a body you pasted as JSON, one you wrote by hand, an
  endpoint that predates all this — shows the types derived from the body.
  Ask for a language other than TypeScript and you get the derived form
  too, since a stored model can only be TypeScript.

Because the model is kept, **Regenerate** uses it rather than guessing the
shape back out of one sample. Guessing is what turned a `[number, number]`
into three numbers and a four-way literal union into a random string. When
there is no model, it still infers from the body, which is the old
behaviour.

The model is a copy taken when you pasted it. It records where the body came
from, not what the body is now: edit the body by hand and the model stays as
it was. See [ADR-0013](https://laqi.dev/decisions/0013-mocks-remember-their-model/).

## The status field, and the usual siblings

The status on the create form and in the detail pane is a searchable list,
not a number you have to remember. Type `404` or `not found` — both reach
`404 Not Found`. Codes are grouped by class and named, and anything not on
the list is still typeable: a mock server has to be able to return `599`.

Beside **+ Add response**, laqi offers the responses the endpoint probably
wants and does not have yet. What it offers depends on the method _and_ the
path shape:

| Endpoint             | Offered                                     |
| -------------------- | ------------------------------------------- |
| `GET /orders`        | `ok` · `empty` · `error`                    |
| `GET /orders/:id`    | `ok` · `not-found` · `error`                |
| `POST /orders`       | `created` · `validation-error` · `conflict` |
| `PUT /orders/:id`    | `ok` · `not-found` · `conflict`             |
| `DELETE /orders/:id` | `deleted` · `not-found`                     |

A collection returns an empty list; the one with an `:id` is the one that
404s. The button names exactly what it will add, and it disappears once
nothing is missing.

It only ever **adds**. A response you already wrote keeps its body, and the
default keeps serving whatever it was serving. The scaffolded bodies are
placeholders — regenerate them from a pasted model with the
[data generators](/docs/data-generators/).

Agents get the same thing in one call, through the `scaffold_responses` MCP
tool.

## Sharing it publicly

`localhost` is not reachable from a physical phone, from Expo Go on
mobile data, or from a teammate on another network. `laqi --share` opens
a public URL to your mocks, using [`cloudflared`](https://github.com/cloudflare/cloudflared)
(no account, no login needed) — laqi prints the URL, a bearer token, and
a ready-to-paste `curl`.

What goes through the tunnel is only the mocks. The panel and the
control-plane API stay on a second, local-only listener — every
`/__laqi` path answers 404 through the public URL, so having the shared
URL never means being able to rewrite your mock files. Every request
without `Authorization: Bearer <token>` gets rejected unless you pass
`--public`, which turns that off and says so loudly.

The panel is served only when laqi is listening on loopback — with
`--host 0.0.0.0` neither the panel nor the API is mounted.
