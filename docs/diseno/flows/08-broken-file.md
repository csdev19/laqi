# F8 — Recover from a broken mock file

**Frequency** a few per week, always urgent · **Surface** red band under the header

## Trigger
The developer saves a mock file with invalid JSON. This is the single most
common failure in the product.

## Steps
1. The watcher fails to parse; `GET /__laqi/api/status` returns the error and
   the SSE `error` event fires.
2. A red band appears under the header:
   - `LOAD FAILED` label
   - `mocks/orders.json:14:7` — file, line, column, in mono
   - the cause in plain words: "Unexpected token } — a trailing comma after the
     `boom` response."
   - a three-line source excerpt with a caret under the offending column
   - "Endpoints from this file are unavailable. The rest of the mock is still
     being served." — so the developer knows the blast radius
3. Header count reads `26 (+1 file failed)`; the number never silently lies.
4. `Open in editor` launches `$EDITOR file:line:col`. `Reload file` re-parses.
5. On success the band disappears, the count corrects, endpoints reappear in
   file order.

## Why inline and this verbose
The panel is the only place the developer is looking when this happens, and the
fix needs three facts: which file, which line, and what is wrong in human words.
A truncated `SyntaxError` sends them to the terminal, which is the failure this
band exists to prevent.
