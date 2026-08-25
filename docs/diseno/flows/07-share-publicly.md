# F7 — Share the mock publicly

**Frequency** a few per week · **Surface** header button + magenta band

## Trigger
A teammate, or a phone on mobile data, needs to hit the mock.

## Steps
1. Header reads `Share publicly` (dim outline). Click.
2. `POST /__laqi/api/share {enabled:true}` → `{ url, token }`.
3. The magenta band appears under the header (160ms slide-in) with a pulsing
   dot and `EXPOSED TO THE INTERNET`, the public URL, the bearer token masked
   as `lq_••••••••••••`, and `Reveal token` / `Copy URL` / `Copy curl` /
   `Stop sharing`. The header button turns magenta and reads `Sharing live`.
4. `Copy curl` yields a request already carrying
   `Authorization: Bearer <token>`.
5. `Stop sharing` tears the tunnel down; the band disappears.

## Rules
- Off by default, every session. Never remembered.
- Token masked until `Reveal` — the panel is often on a shared screen.
- The band is the only loud element in the product; no other surface may use a
  pulsing dot or a full-width accent fill.

## Why a persistent band
Exposure is a condition, not a task: it must be visible in every screenshot and
impossible to forget. A modal confirming it and disappearing would be worse than
nothing.
