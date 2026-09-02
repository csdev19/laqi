---
title: AI design brief
description: Self-contained design context — theme, palette, typography, and every visual decision. Paste it whole into an AI doing design work on laqi.
---

# AI design brief

> **How to use this document:** paste it whole into the context of an AI
> that will design or build UI for laqi (the panel, laqi.dev, marketing
> assets). It is self-contained. Exact values are duplicated here from
> `packages/tokens/src/tokens.css` — if the two ever disagree, tokens.css
> wins. Current as of 2026-09-01.

## The aesthetic in one paragraph

Dark, editorial, technical. A serif carries the voice; a monospace carries
the data; violet is the identity. The look reads as a well-typeset
engineering document, not a SaaS dashboard: hairline separators, tiny
radii, no cards, no shadows, no decorative gradients. Density is a feature
— this is a tool reached for mid-task, and whitespace plus the serif scale
carry hierarchy instead of boxes.

## Palette (dark, the default)

Neutrals:

```css
--bg:     #0b0a0f  /* app/site ground          */
--panel:  #121019  /* raised surfaces          */
--panel2: #171522  /* second-level surfaces    */
--line:   #241f35  /* hairline separators      */
--line2:  #332a4a  /* control borders          */
--fg:     #eae7f2  /* primary text             */
--dim:    #8e88a8  /* secondary text           */
--dim2:   #5c5678  /* labels, inactive         */
```

Accents — internally nicknamed "Amazonian cumbia":

```css
--vio:   #7a00ff  /* primary interactive, brand violet */
--viol:  #a366ff  /* violet legible on dark            */
--mag:   #ff00a0  /* magenta                           */
--magl:  #ff7ac8  /* magenta light                     */
--mint:  #00ffc2  /* mint                              */
--red:   #ff0058  /* failure red                       */
--warn:  #ffb020  /* warning amber                     */
--palev: #c9a6ff  /* pale violet                       */
--palem: #7fefd8  /* pale mint                         */
```

**Color is data — never decoration.** Each accent has a fixed semantic and
must not be reused for looks:

| Meaning                                                  | Color                 |
| -------------------------------------------------------- | --------------------- |
| GET / 2xx / live-healthy / header layer                  | `--mint`              |
| POST / scenario layer / primary buttons                  | `--vio` / `--viol`    |
| PATCH / PUT                                              | `--palev` / `--palem` |
| DELETE / state layer ("I changed this") / sharing active | `--mag`               |
| 4xx                                                      | `--magl`              |
| 5xx / invalid file / load failure                        | `--red`               |
| 3xx / untouched default                                  | `--dim` / `--dim2`    |

Light mode (panel only; the site is dark-only): keep the same semantics,
invert the neutral ramp (`#F7F6FA` ground, `#17151F` text), and darken the
three main accents to 700-step equivalents for text contrast (`#5A00BF`,
`#C4007D`, `#008062`). Accents stay identical for badges and fills.

## Typography

Two faces, self-hosted via Fontsource — no CDN, no third face, no sans:

- **Source Serif 4** — the UI/display voice: headings, labels, chrome,
  descriptions (italic for descriptions). Weights loaded: 400 and 600
  only — always pin `font-weight: 600` on headings or the browser fakes a
  700 and renders jagged.
- **JetBrains Mono** — anything a developer could paste: methods, paths,
  response names, JSON, status codes, timings, file paths, eyebrows.
  Weights: 400/500/600.

Recurring patterns: mono uppercase micro-labels with generous tracking
(`letter-spacing: .08–.16em`) for eyebrows and section labels; serif at
15–26px (panel) or clamp up to 4rem (site hero) for headings.

## Structure and texture

- Radius: 2px in the panel, 6–8px on the site. 1px hairlines everywhere.
- No cards in the panel's main view; the site uses bordered `--panel`
  cards sparingly. No shadows except floating overlays (command palette).
- Response chips are the signature motif: small rounded-full pills,
  border and text in the semantic color, ~8% tinted background. The
  landing hero reuses them as the evidence line.
- Background atmosphere on the site: a single subtle violet radial glow
  (`color-mix` of `--vio` at ~10–12% into transparent), nothing else.

## Brand assets

Canonical home `assets/brand/` (see its README). Naming: **no suffix =
dark variant (the default), `-light` suffix = light variant.**

- `favicon.svg` — bolt on violet rounded square; works on any background.
- `icon.svg` / `icon-light.svg` — bare bolt (plum vs pink shadow).
- `logo.png` / `logo-light.png` — transparent lockups (bolt + serif
  wordmark "laqi", light vs dark text).
- `og-image.png` — 1200×630 social card: dark ground, violet glow,
  lockup, tagline, `laqi.dev` in mono.
- Brand violet in assets is `#7B00FF` (one step off the token `#7a00ff`;
  visually identical — do not "fix" one to the other without a ruling).

## Voice

- English on every published surface, regardless of working language.
- Headlines are serif, sentence-case, and outcome-led ("Your backend
  isn't ready. Your frontend can be."). Eyebrows are mono, uppercase.
- Safe positioning: "controllable local API", "build your frontend before
  the backend is ready". Never: "create/replace your backend", anything
  implying a hosted production API or an exposed control panel.

## Product stance (drives every panel decision)

Reached for mid-task, not "used": density over onboarding, one click for
the frequent action, keyboard first (`⌘K`), modals only for the rare, and
the request log always visible — trigger-in-app → see-it-land is the loop.
