---
title: "F1 — Flip an endpoint's live response"
---

# F1 — Flip an endpoint's live response

**Frequency** dozens per hour · **Cost target** one click, zero navigation ·
**Surfaces** endpoint row, command palette, detail view

This is the product. Everything else is arranged around not getting in its way.

## Trigger

The developer is building an error screen and needs `POST /orders` to fail.

## Steps (mouse)

1. The row is already on screen — the list is the default view, nothing is
   collapsed, all responses are visible as chips.
2. Click the `boom 500` chip.
3. **Optimistic paint, immediately:** chip fills magenta, row takes the magenta
   wash, marker appears, layer tag flips `default` → `state`, header
   `Overridden` increments.
4. `PUT /__laqi/api/state` fires with the new override map.
5. The developer triggers the action in their app; the request lands in the log
   within ~50ms reading `POST /orders 500 boom (state)`.

## Steps (keyboard)

1. `⌘K`.
2. Type `orders boom` — tokens match against `METHOD path response`.
3. `↵` on the first result. Palette closes, same optimistic paint.
4. `⌘↵` instead opens the detail view (spec).

## Undo

Click the chip that equals the file `default` (`created` here). The override is
**deleted**, not overwritten: the row returns to untinted and the counter drops.
No separate reset control per row.

## Interaction with other layers

- If a scenario already set this endpoint, the flip wins and the tag reads
  `state`; the scenario stays active elsewhere.
- A request carrying `X-Laqi-Response` still overrides both, for that request
  only, and shows as `(header)` in the log without touching the chips.

## Failure

Write fails → revert the chip to its previous value and print a one-line message
in the row itself (`could not write state — retry`). No toast, no dialog.

## Why this shape

A dropdown or a detail panel would add a click and a mode to the most frequent
action in the product; showing every response as a chip trades horizontal space
for a permanent one-click target. The row tint means the cost of the flip is
paid back immediately in F2.
