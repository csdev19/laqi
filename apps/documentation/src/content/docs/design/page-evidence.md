---
title: Page evidence — what the three empty slots must demonstrate
description: The visitor question, the state change and the production constraints for laqi.dev's three unfilled visual slots, plus the two blockers that explain why they were never recorded.
---

# Page evidence — what the three empty slots must demonstrate

**Status:** Draft spec. Two blockers must be resolved before any recording.
**Date:** 2026-10-01
**Produced by:** [the 2026-10-01 page audit](/product/page-audit-2026-10-01/),
findings T1, A1 and A2.

## In one minute

laqi.dev contains no visual proof of any kind. All three evidence slots render a
`DemoPlaceholder`: an empty box whose visible text is the internal production
brief, plus a non-functional `or browse files` affordance. The hero's second CTA
— _"Watch the 20-second demo"_ — points at one of them. This is live.

For a product whose entire promise is _click and watch the response change_, the
page shows nothing changing. Of everything in the audit, this is the single
highest-value fix.

Two concrete blockers explain why the demos were never recorded, and both were
discovered while writing this document rather than being known.

### Decisions

| Decision                                                                 | Why                                                                             | ADR  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---- |
| Each slot answers one named visitor question and shows one state change  | A screenshot proving a UI exists is not evidence; a state change is             | none |
| The demos are recorded against `examples/todo-app`, not an invented app  | It exists, it runs, and it is the thing a visitor can reproduce                 | none |
| Until a demo exists, the slot and its CTA are removed, not left as a box | An empty placeholder reads as abandonment at the moment of highest intent       | none |
| `examples/todo-app` gets a visible entry point from the landing          | It is real runnable proof currently reachable only as a nav link to GitHub (A2) | none |

### Blockers

1. **The demo scripts describe an app that does not exist.** All three briefs
   call for a storefront — `GET /products`, an empty cart, a payment error, a
   `checkout-broken` scenario. The only example in this repository is a todo app
   (`examples/todo-app`), and no `checkout-broken` scenario exists anywhere.
   Either the scripts are rewritten against the todo app, or a storefront example
   has to be built first. **This is almost certainly why nothing was ever
   recorded.**
2. **The example's scenario names are in Spanish**, and they would be on camera.
   `examples/todo-app/laqi/scenarios.json` declares `backend-caido`,
   `usuario-nuevo`, `sesion-expirada` and `red-lenta`. ADR-0009 requires English
   on every user-facing surface, and Plan 9 is recorded as having migrated them.
   `laqi init` scaffolds correctly in English (`offline`, `logged-out`,
   `empty-state` — `apps/cli/src/init/scaffold.ts:82-86`); the shipped example
   was missed.

### Out of scope

Brand and motion direction — that lives in
[the AI design brief](/product/ai-design-brief/). This document decides what each
demo must prove, not how it looks.

---

## Why the current slots fail

`apps/site/src/components/DemoPlaceholder.astro` renders the caption it is given
as visible body text, inside a dashed drop zone with an image icon and the words
`or browse files`. The captions passed to it are production briefs written for
whoever would record the video:

| Slot                   | Rendered text on the live site                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Hero.astro:40-44`     | `20-second demo poster — a real storefront UI beside the laqi panel; click GET /products → empty, the UI empties — 16:9`               |
| `FeatureGrid.astro:16` | `30-second demo poster — activate scenario 'checkout-broken': empty cart, payment error, visible delay — one click, several endpoints` |
| `FeatureGrid.astro:17` | `30-second demo poster — paste a TypeScript Order interface, generate seeded data, a working UI appears on localhost`                  |

A visitor reads the production notes for a video that was never made, next to an
upload control that does nothing. The component was built as a design scaffold
and shipped as if it were content.

## The three slots, respecified

Each entry names the visitor question, the state change that answers it, and what
would make the recording dishonest.

### Slot 1 — hero, ~20s

**Visitor question:** _"What does this actually do?"_

**State change:** a working UI with a list of todos, next to the panel. One click
on `empty` for `GET /todos`. The list empties without a reload. One click on
`error`. The error state appears. Nothing is typed, no file is saved, no server
restarts.

**Why it is the right first demo:** it is the entire product in one motion, it
takes no explanation, and it is reproducible by the visitor in under a minute via
the quick start — which is the claim the docs already make.

**Dishonest if:** it cuts between takes to hide a reload, speeds up the response,
or uses an app that is not in the repository.

**Rewrite required:** the current brief says storefront and `GET /products`.
Against `examples/todo-app` it becomes todos and `GET /todos`. The `one-page`
response already exists for a pagination beat if one is wanted.

### Slot 2 — feature grid, ~30s

**Visitor question:** _"What does a scenario buy me over flipping one endpoint?"_

**State change:** one click on a scenario, several endpoints moving together,
visible in more than one place in the UI at once. The panel shows which endpoints
the scenario covers; the app shows the consequences simultaneously.

**Against the todo app:** `backend-caido` → `offline` is the strongest candidate
once renamed — it moves all four todo endpoints to `error` at once, which is
exactly the "several endpoints, one move" point. `red-lenta` → `slow-network`
demonstrates latency across two endpoints and could serve the same slot.

**Dishonest if:** it shows a scenario covering endpoints the example does not
declare, or implies scenarios stack. They do not — one is active at a time
(`packages/core/src/state-store.ts`), and the panel says so.

**Rewrite required:** `checkout-broken` does not exist. Either rename, or declare
it in the example.

### Slot 3 — feature grid, ~30s

**Visitor question:** _"Do I have to write all this fake data by hand?"_

**State change:** a TypeScript interface pasted into the panel; seeded, realistic
data generated from it — emails in `email` fields, dates in `createdAt`; the body
written to a response; the app showing it.

**This one is accurate as briefed.** The capability is real
(`packages/generate/src/parse-types.ts`, and `generate_data` over MCP), and the
example app ships models to paste. Only the entity name needs to match the todo
app.

**Dishonest if:** it implies the model is stored as a schema that stays in sync.
It is not — see ADR-0013 for what a mock actually remembers, and Plan 14 for
where that is going.

## The fourth piece of evidence, already built

`examples/todo-app` is a TanStack Start frontend running against laqi with
pagination, CRUD, a profile page and a login flow. It is the most complete
answer the project has to _"does this really work?"_, and the landing exposes it
only as a nav link labelled "Examples" pointing at a GitHub tree
(`apps/site/src/components/SiteNav.astro:14`).

It deserves a visible entry point from the page — ideally adjacent to slot 1, as
the "run this yourself" path under the demo that shows it. A visitor who wants
proof beyond a video should be two clicks from running it, not navigating a
repository.

## Interim state, until a demo exists

**Superseded by the implementation — the interim state is now structural rather
than a removal.**

The original instruction was to delete the three slots and the hero's
_"Watch the 20-second demo"_ CTA, and restore them the day a recording existed.
That was done, and then reversed within the same branch when the recordings
became imminent. The reversal is the better end state, because it removes the
failure mode instead of the markup:

- `apps/site/src/components/Demo.astro` renders a `<video>` when its `src` is
  set. With no file it renders the shooting note, and **only under
  `astro dev`** — so a published page can no longer show a visitor an empty
  box, whatever anyone forgets.
- The three slots are declared in `apps/site/src/lib/demos.ts`. Setting one
  `src` publishes that slot.
- The hero's CTA is gated on the same flag as the hero's slot, so it cannot
  point at something that is not there. That was finding T1's actual defect.
- Recordings go in `apps/site/public/demos/`.

The briefs in `demos.ts` are the ones respecified above, against
`examples/todo-app`, each naming what would make the recording dishonest. Both
blockers are cleared: the storefront scripts are rewritten, and the Spanish
scenario names were renamed in Plan 15 task 7.

Slot 1 is still worth more than every copy change in the audit combined.

## Recording a demo

Learned from the first recording (the hero, 2026-10-06). That take was
published as it was; these notes are for the next one.

**Text sharpness is decided at capture, not at export.** The hero was recorded
on a 27" 1920×1080 monitor without Retina, and the file came out at
2560×1440. Each glyph was drawn with few pixels, scaled up by a non-integer
factor by the recorder, compressed with chroma at half resolution (which
smears thin coloured text on a dark background), then scaled down again to the
~1200px the page shows. Re-encoding cannot restore detail the capture never
had.

- **Record on a Retina display** (the MacBook's built-in screen): every glyph
  gets four times the pixels. This is the largest single improvement.
- **On a 1x monitor, make the content larger instead of recording more of
  it**: browser zoom at 125–150% in both windows, and capture a region of
  about 1280×720 rather than the full screen, so the page shows it near 1:1.
- **Match the recorder's output resolution to the screen.** No upscaling (the
  hero's 1080p screen became a 1440p file), and high quality: CRF 16–18 or
  OBS's "Indistinguishable Quality". 9.5 Mbps was too little for text.
- **Before recording**: hide the menu bar or crop it out; mark "Never on this
  site" on the browser's save-password prompt (it covered the hero take for
  1.3s and had to be cut); sign out first so the story starts at the login.

**Encoding for the page.** H.264 High, 1920×1080, 30fps, CRF 23, `yuv420p`,
`-movflags +faststart`, no audio, padded to exactly 16:9 (the slot uses
`object-fit: cover` and would otherwise crop the sides), plus a JPG poster
from a frame that reads well as a still. The hero went from 28 MB to 3.0 MB:

```bash
ffmpeg -i raw.mp4 -vf "crop=<w>:<h>:<x>:<y>,scale=1920:-2:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b0a0f,fps=30,format=yuv420p" \
  -an -c:v libx264 -preset slow -crf 23 -profile:v high -movflags +faststart demo.mp4
ffmpeg -ss <t> -i demo.mp4 -frames:v 1 -q:v 3 demo.jpg
```

A cut is allowed only where it hides no state change: check that the frames on
both sides show the same loaded screen, and say where the cut is in the
`demos.ts` comment for that slot.
