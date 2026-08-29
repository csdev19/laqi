---
title: laqi control panel — design spec
---

# laqi control panel — design spec

Design context for `packages/editor` (React + Vite, served by the laqi CLI at
`http://localhost:8000/__laqi`). Single local user, no accounts, dark-first.
The interactive reference implementation of everything below is
`Laqi Control Panel.dc.html` in this project — read it for exact values.

---

## 1. Product stance

A tool reached for mid-task, not an app that is "used". Every design decision
follows from that:

- **Density over onboarding.** No welcome, no wizards, no illustrated empty states.
- **One click for the frequent action** (flip a response), a detail view only for
  the rare one (edit a definition).
- **Keyboard first.** `⌘K` reaches any endpoint/response pair without the mouse.
- **Modals only for nothing frequent.** Sharing, errors, create-endpoint and
  scenarios are all inline bands or rows, never dialogs.
- Colour is data. Two scan dimensions: **HTTP method** and **status class**.
  Everything else stays quiet.

---

## 2. Visual language

### Palette (dark, default)

```css
--bg:      #0B0A0F   /* app ground            */
--panel:   #121019   /* header, log pane      */
--panel2:  #171522   /* palette surface       */
--line:    #241F35   /* hairline separators   */
--line2:   #332A4A   /* control borders       */
--fg:      #EAE7F2   /* primary text          */
--dim:     #8E88A8   /* secondary text        */
--dim2:    #5C5678   /* labels, inactive      */

/* accents — "cumbia amazónica" */
--vio:     #7A00FF   /* primary interactive, scenarios          */
--viol:    #A366FF   /* violet on dark: POST, scenario layer     */
--mag:     #FF00A0   /* state layer = "I changed this", sharing  */
--magl:    #FF7AC8   /* 4xx                                     */
--mint:    #00FFC2   /* live/healthy, GET, 2xx, header layer     */
--red:     #FF0058   /* 5xx, load failures (deep magenta)        */
```

Semantic assignments — do not reuse these hues decoratively:

| Meaning                                                    | Colour                                |
| ---------------------------------------------------------- | ------------------------------------- |
| GET / 2xx / live server / header layer                     | `--mint`                              |
| POST / scenario layer / primary buttons                    | `--vio` / `--viol`                    |
| PATCH · PUT                                                | `--palev #C9A6FF` · `--palem #7FEFD8` |
| DELETE / **state layer (user override)** / sharing exposed | `--mag`                               |
| 4xx                                                        | `--magl`                              |
| 5xx, invalid mock file                                     | `--red`                               |
| 3xx, untouched/default                                     | `--dim` / `--dim2`                    |

Light mode: keep the same semantics, invert the neutral ramp
(`#F7F6FA` ground, `#17151F` text) and darken the three accents to their 700
steps for text contrast (`#5A00BF`, `#C4007D`, `#008062`). Accents stay identical
for badges and fills.

### Type

- `Source Serif 4` — all chrome, labels, headings, descriptions (italic for
  descriptions). The serif _is_ the UI font; no sans anywhere.
- `JetBrains Mono` — anything a developer could paste: methods, paths, response
  names, JSON, status codes, timings, tokens, file paths.
- Sizes: 9–10px mono uppercase micro-labels (`letter-spacing:.16em`), 11px chips,
  12.5–13px data rows, 15–26px serif for the few headings.

### Structure

- Radius 2px, 1px hairlines, no cards in the main view, no shadows except the
  command palette. Whitespace and the serif scale carry hierarchy.
- Row rhythm: 10px vertical padding (`--rpy`, 6px in compact density).

---

## 3. Layout

```
┌───────────────────────────────────────────────────────────────┐
│ header: ↯ laqi · watching · endpoints · local addr · overridden│
│                              [Share publicly] [Jump to… ⌘K]   │
├───────────────────────────────────────────────────────────────┤
│ sharing band (only when on, magenta)                          │
│ parse-error band (only on failure, red)                       │
├──────────────────────────────────────┬────────────────────────┤
│ scenarios strip                      │  request log           │
│ filter + New endpoint                │  (426px, live, always  │
│ endpoint rows (scroll)               │   visible, never a tab)│
└──────────────────────────────────────┴────────────────────────┘
```

- Endpoint pane is fluid, log pane fixed 426px. At 1024 the log narrows to 340px
  and endpoint descriptions hide; below 900 the log moves under the list.
- The log is **never** behind a tab: trigger-in-app → see-it-land is the loop.

### Endpoint row

`marker · METHOD · path / description · response chips · layer tag`

- **Marker** — 5px square, coloured by layer, invisible when default.
- **Row tint** — `rgba(255,0,160,.055)` when overridden by the panel,
  `rgba(122,0,255,.075)` when set by the active scenario, none when default.
  Scanning the list answers "what did I change?" with zero clicks.
- **Chips** — every response, always visible, one click each. The live one is
  filled/outlined **in its layer colour**; the rest are dim with their status
  number in status colour.
- **Layer tag** — `default` / `state` / `scenario`, right-aligned, bold when not
  default.
- Clicking the path (not a chip) opens the detail view.
- Clicking the chip that equals the file `default` while no scenario covers the
  endpoint **removes** the override rather than writing an identical one.

### Request log row

`time · METHOD · path · status · resolved (layer) · ms`

- No-route requests get a red tint, red path and `no matching route` — the most
  common source of confusion, so it must be unmissable.
- Clicking a row opens that endpoint's detail view.
- Footer is a permanent legend of the four layers.
- Pause / Clear; 60-entry cap in the client.

---

## 4. The three layers (the core concept)

```
1. X-Laqi-Response header   per request, changes no state   → mint
2. Active state (panel)     persisted by the panel          → magenta
3. default (file)           the baseline                    → dim
   + scenario selection sits between 2 and 3                → violet
```

Rules the UI must encode:

- A per-endpoint override **beats** the active scenario.
- Only one scenario is active at a time; activating another replaces it.
- Every surface that shows a live response also shows **which layer decided**
  (chip colour + word). Never one without the other.
- `Reset all to default` clears overrides _and_ the scenario; it appears only
  when something is dirty.

---

## 5. UX flows

See [`flows/`](flows/) for the full set (F1–F9), one file each.

---

## 6. Keyboard map

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| `⌘K` / `Ctrl K` | command palette (endpoint + response)        |
| `↵`             | set the highlighted response live            |
| `⌘↵`            | open the endpoint's detail view              |
| `esc`           | close palette / leave detail / cancel create |
| `/`             | focus the filter field                       |
| `1…9`           | in a focused row, flip to the nth response   |
| `p`             | pause/resume the log                         |

---

## 7. Data contracts (assumed)

```
GET    /__laqi/api/endpoints        → [{ id, method, path, description, default,
                                        responses: { name: { status, body, delay?, headers? } },
                                        file }]
GET    /__laqi/api/state            → { overrides: { [id]: name }, scenario: string|null }
PUT    /__laqi/api/state            ← { overrides, scenario }
PUT    /__laqi/api/endpoints/:id    ← full endpoint definition (writes the file)
POST   /__laqi/api/endpoints        ← { method, path, responses }
GET    /__laqi/api/scenarios        → { [name]: { [endpointId]: responseName } }
POST   /__laqi/api/share            ← { enabled: boolean } → { url, token }
GET    /__laqi/api/status           → { watching, endpointCount, address, errors: [{file,line,col,message,excerpt}] }
GET    /__laqi/events               → SSE: request | endpoints-changed | error | share-changed
```

Latency is same-machine: paint optimistically, reconcile on the event.

> **Correcciones pendientes** — ver [revision-vs-decisiones.md](/diseno/revision-vs-decisiones/):
> falta `DELETE /__laqi/api/endpoints/:id` (H8), y **todo `/__laqi/*` debe
> devolver 404 a través del túnel** (H1, bloqueante de seguridad).

---

## 8. Implementation notes

- React + Vite, static assets embedded in the CLI binary — keep the bundle
  modest. No component library, no CSS-in-JS runtime; CSS variables + plain
  stylesheet is enough for this surface.
- Suggested tree: `App` → `Header`, `ShareBand`, `ErrorBand`,
  `ScenarioStrip`, `EndpointList/EndpointRow/ResponseChip`, `RequestLog/LogRow`,
  `EndpointDetail` (`ResponseList`, `JsonEditor`, `ResponseMeta`),
  `CommandPalette`, `CreateEndpointRow`.
- The log is the only high-frequency render: cap at 200 entries, key by seq,
  virtualise only if profiling asks for it.
- 100 endpoints must not break the layout: the list is the only scroll
  container, chips wrap to at most two lines, the header stays fixed.
- Syntax highlighting: a ~40-line tokenizer (string/key/number/boolean/punct) is
  enough — do not ship a full editor for this.
- Contrast: neon accents on `#0B0A0F` pass for chips, badges and 12px+ mono, but
  never set body copy in `--mint`/`--mag` at 300 weight.
