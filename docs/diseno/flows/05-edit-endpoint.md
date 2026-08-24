# F5 — Edit an endpoint definition

**Frequency** a few per day · **Cost target** cheap in *and* out ·
**Surface** detail view (replaces both panes)

## Trigger
A response needs a new field, a different status, a delay — or a whole new
response variant.

## Steps
1. Click the endpoint's **path** (chips flip, the path navigates) or a log row.
2. The detail view replaces the two-pane area. Header: `← Endpoints (esc)`,
   method, path, description, live pill (`boom · state`).
3. **Left column** — every response, status-coloured, marker on the live one.
   Selecting one loads it for editing and *does not* change what is live: the
   two acts are separate, so exploring is free.
4. **Centre** — the JSON body: mono, line numbers, keys violet, strings mint,
   numbers pink, literals magenta. Validity readout under the toolbar
   (`valid JSON · 412 B`); on a parse error it becomes a red line/column
   message and `Set live` is blocked (spec).
5. **Right column** — status, delay (ms), headers, a ready `curl` carrying
   `X-Laqi-Response: <name>` (which is also how the header layer gets taught),
   and the source file the endpoint came from.
6. `Set live` promotes the response being edited; it reads `Live now` with a
   mint outline when it already is.
7. `Rename` / `Delete` / `+ Add response` mutate the set in place.
8. `esc` or `← Endpoints` returns; list scroll position is preserved.

## Persistence
Writes go back to the source JSON file. The file watcher will re-emit
`endpoints-changed`; the UI must diff, not remount — no flash, no lost cursor.

## Why a full view, not a slide-over
JSON needs width, and this is the one flow where the developer is not flipping.
The cost is one keystroke to leave, which keeps the flip-and-check rhythm intact.
