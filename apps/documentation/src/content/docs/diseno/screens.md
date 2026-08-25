---
title: Screens and regions — what is in them and why
---

# Screens and regions — what is in them and why

Three views total (main, endpoint detail, command palette) plus two bands and
five list/log states. Anything that could have been a fourth view was folded
into a band or an inline row instead, because a developer flipping responses
must never lose the endpoint list.

---

## 0. Prototype-states bar (prototype only)

Thin bar above the header: Mixed overrides · Scenario active · Sharing on ·
Parse error · Log empty · Fresh project. It exists to review the required states
in one file and **ships nowhere** — delete it in `packages/editor`.

## 1. Header (always visible, 1 row)

`↯ laqi v2.0.1 | Watching ./mocks/ | Endpoints 27 | Local localhost:8000 | Overridden 3`
then `[Share publicly]` `[Jump to… ⌘K]`.

Why these four facts and no others: they are the "is my setup what I think it is"
questions that otherwise cost a terminal switch. `Overridden` is the only number
that changes minute to minute, so it is the only one that takes an accent
(magenta when non-zero, dim at zero) — the answer to "did I leave something
flipped?" without reading a single row.

Nothing here is a nav: there are no other pages. No logo lockup, no avatar, no
bell, no settings gear — there is one user and the config lives in a file.

## 2. Sharing band (conditional, magenta)

Pinned under the header only while the tunnel is up: pulsing dot,
`EXPOSED TO THE INTERNET`, public URL, masked bearer token, Reveal / Copy URL /
Copy curl / Stop sharing.

Why a band and not a panel or a modal: exposure is a **persistent condition**,
not a task. It must be visible in every screenshot the developer takes and
impossible to forget about. It is the loudest thing in the product; nothing else
is allowed to compete with it.

## 3. Error band (conditional, red)

`file:line:col`, the cause in plain words ("a trailing comma after the `boom`
response"), a three-line source excerpt with a caret, a sentence saying the rest
of the mock is still served, and `Open in editor` / `Reload file`.

Why so much detail inline: a broken mock file is the single most common failure,
and the panel is the only place the developer is looking when it happens. The
header count reads `26 (+1 file failed)` so the number never silently lies.

## 4. Scenarios strip (always visible)

Five chips (`checkout-broken 3`, `new-user 3`, `offline 5`, `slow-network 4`,
`logged-out 3`) with the endpoint count each one touches; the active chip is
filled violet. `Reset all to default` appears at the right only when something
is dirty.

Why above the list and never in a drawer: activating a scenario is the demo move
and the fastest route to a known state. Showing the count answers "how much does
this change?" before the click.

## 5. Filter row

Filter field (method, path, description, response names), `N shown`,
`+ New endpoint`.

Why a filter and a palette both: the filter narrows what you _look at_, the
palette acts without looking. Different jobs; the palette does not filter the
list behind it.

## 6. Endpoint list (the product)

Row anatomy — `marker · METHOD · path / description · response chips · layer tag`:

- **Marker** (5px square, layer colour, invisible when default) — peripheral
  "mine vs untouched" at any zoom level.
- **METHOD** in mono, colour-coded — one of the two dimensions a developer scans
  for. Fixed 54px column so the paths align into a single readable edge.
- **path** mono 13px, clickable → detail. **description** serif italic dim,
  hideable via the `showDescriptions` tweak for maximum density.
- **Response chips**, all of them, always — the flip must cost one click, so the
  targets cannot live behind a dropdown. Live chip is filled in its layer
  colour; the others are dim outlines with their status number in status colour
  (the second scan dimension). Right-aligned and wrapping at 52% width so long
  response sets never push the path around.
- **Layer tag** (`default`/`state`/`scenario`), right edge, bold when not default.
- **Row tint**: magenta wash for `state`, violet wash for `scenario`, none for
  `default`. Overridden rows read as a group from across the desk.

Row height 40px (26px in compact) → ~24 rows visible at 1080p, which is the
"~25 endpoints" target with no scrolling. At 100 endpoints the list is the only
scroll container; header, scenarios and log stay put.

## 7. Request log (fixed 426px, always visible)

Header: live dot (mint streaming / grey paused), `Requests · N`, Pause, Clear.
Row: `time · METHOD · path · status · resolved (layer) · ms`. Footer: a permanent
legend of the four layer colours.

Why beside the list and never behind a tab: the loop is trigger-in-app →
see-it-land → flip → trigger again. A tab would hide half of that loop.
Why the resolved string verbatim: it is the same text as the response header, so
the panel is verifiable against the network tab.
No-route requests get a red tint, red path and `no matching route` — the most
common confusion ("why is my mock not answering?") gets the loudest row in the
pane. Clicking any row jumps to the endpoint that served it.
Empty state: two lines of text, no illustration, no vertical centring — real
content stays above the fold.

## 8. Endpoint detail (replaces the two panes)

Header: `← Endpoints (esc)`, method, path, description, and the live pill
(`boom · state`). Three columns:

1. **Responses (232px)** — every response with status colour and a marker on the
   live one; `+ Add response` as a dashed ghost at the bottom.
2. **Body (fluid)** — mono, line numbers, syntax highlighting (keys violet,
   strings mint, numbers pink, literals magenta, punctuation grey), a validity
   readout (`valid JSON · 412 B`), `Set live` / `Rename` / `Delete`.
3. **Meta (290px)** — status, delay (ms), headers, a ready-made `curl` carrying
   `X-Laqi-Response`, and the file the endpoint came from.

Why a full view rather than a slide-over: JSON editing needs width, and this is
the one flow where the developer is not flipping. Why not a route change: `esc`
must always mean "back to the list", including from the palette.
Why the curl is here: it is how you test a response without touching the app,
and it teaches the header layer by showing it.

## 9. Command palette (⌘K, overlay)

Single input, then rows of `METHOD · path · set live · response`. Multi-token
matching (`orders boom`). Already-live options carry a mint outlined chip so you
never flip something that is already flipped. Footer: `↵ set live`,
`⌘↵ open detail`, `esc close`.

Why it exists in v1: the developer usually knows the endpoint by name, and
typing beats hunting in a 100-row list. It is the only overlay in the product —
justified because it is transient and keyboard-summoned.

## 10. Fresh project

Heading `No endpoints loaded`, one sentence naming the watched folder, a
copy-pasteable minimal mock file, `Create first endpoint` /
`Copy example file`. Left-aligned, top of the pane, no illustration — it is a
paste target, not a welcome screen.
