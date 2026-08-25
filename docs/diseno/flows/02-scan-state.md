# F2 — Scan what is live right now

**Frequency** continuous · **Cost target** zero clicks · **Surface** endpoint list + header

## The question
"What is live, and which of these did *I* change?" — asked every time the
developer looks back at the panel.

## How the list answers it
| Signal | Reads as |
| --- | --- |
| Magenta row wash + magenta marker + `state` tag | I flipped this |
| Violet row wash + violet marker + `scenario` tag | the active scenario did this |
| No wash, no marker, `default` tag in dim | untouched baseline |
| Header `Overridden 3` in magenta | how much of the API is not baseline |

Three redundant encodings per row (tint, marker, word) so the answer survives
peripheral vision, greyscale screenshots and colour blindness.

## Narrowing
- Filter field: method, path, description or response name. `N shown` keeps the
  count honest while filtered.
- Sort is deliberately absent: a stable, file-order list means muscle memory
  puts the same endpoint in the same place every time.

## Exit
`Reset all to default` (appears only when dirty) returns the whole API to the
file's baseline, clearing overrides and the scenario in one action.

## Why this shape
Read-without-clicking was the constraint that killed every collapsed/grouped
list variant: any accordion re-introduces "what is behind that?" — exactly the
question this flow is supposed to eliminate.
