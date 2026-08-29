---
title: Interaction inventory
---

# Interaction inventory

Every interactive element, what it does, and its states. `Built` = working in
the prototype. `Drawn` = present but inert. `Spec` = documented, not built.

## Global

| Element           | Action                                       | States                                   | Status |
| ----------------- | -------------------------------------------- | ---------------------------------------- | ------ |
| `⌘K` / `Ctrl+K`   | toggle command palette, clears query         | —                                        | Built  |
| `esc`             | close palette → leave detail → cancel create | —                                        | Built  |
| `Jump to…` button | opens the palette                            | hover: mint border                       | Built  |
| `Share publicly`  | toggles the tunnel + band                    | off: dim outline / on: magenta fill text | Built  |
| Focus ring        | 2px mint, 2px offset, on every control       | `:focus-visible` only                    | Built  |
| `/`               | focus the filter field                       | —                                        | Spec   |
| `p`               | pause/resume the log                         | —                                        | Spec   |

## Endpoint row

| Element                          | Action                                           | States                                                                                                                | Status |
| -------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------ |
| Response chip                    | flip live response for that endpoint             | live (layer-coloured fill + border) / idle (dim, hairline) / hover (brighten) / title tooltip `name · status · delay` | Built  |
| Chip = file default, no scenario | **deletes** the override, row returns to default | —                                                                                                                     | Built  |
| Path button                      | open endpoint detail                             | hover: mint                                                                                                           | Built  |
| Row                              | tint by layer; hover lifts 2% white              | —                                                                                                                     | Built  |
| `1…9` on a focused row           | flip to the nth response                         | —                                                                                                                     | Spec   |
| Right-click row                  | copy curl / copy path / reset row                | —                                                                                                                     | Spec   |

## Scenarios

| Element                | Action                                                             | States                                                | Status |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- | ------ |
| Scenario chip          | activate; click again to deactivate; replaces any other active one | active: violet fill, white text / idle: hairline, dim | Built  |
| Endpoint count in chip | shows how many endpoints it moves                                  | —                                                     | Built  |
| `Reset all to default` | clears every override **and** the scenario                         | only rendered when something is dirty; hover magenta  | Built  |

## Filter + create

| Element                         | Action                                                            | States                                  | Status |
| ------------------------------- | ----------------------------------------------------------------- | --------------------------------------- | ------ |
| Filter input                    | live substring match on method, path, description, response names | focus: violet border; `N shown` updates | Built  |
| `+ New endpoint`                | opens the inline create row                                       | hover: violet tint                      | Built  |
| Method segmented control        | pick method                                                       | selected: method colour border + text   | Built  |
| Path / response / status inputs | define the first response                                         | focus: violet border                    | Built  |
| `Create`                        | appends the endpoint, opens its detail view with the body ready   | disabled behaviour: no-op on empty path | Built  |
| `Cancel`                        | closes the row, keeps nothing                                     | —                                       | Built  |

## Request log

| Element            | Action                                                                        | States                                      | Status |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------- | ------ |
| Stream             | new entries prepend; 60-entry client cap (200 in production)                  | live dot mint / paused grey                 | Built  |
| `Pause` / `Resume` | freeze the stream to read a burst                                             | label swaps                                 | Built  |
| `Clear`            | empties the pane, shows the waiting-for-requests text                         | —                                           | Built  |
| Log row path       | jump to the endpoint that served it                                           | hover mint; no-route rows are not clickable | Built  |
| No-route row       | red tint + `no matching route`, path is one that genuinely is not in the mock | —                                           | Built  |
| Layer legend       | permanent key for the four colours                                            | —                                           | Built  |

## Endpoint detail

| Element                                | Action                                                                    | States                                              | Status            |
| -------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- | ----------------- |
| `← Endpoints` / `esc`                  | back to the main view, list scroll preserved                              | —                                                   | Built             |
| Response list item                     | select for editing (does not change what is live)                         | selected: violet wash / live: layer-coloured marker | Built             |
| `Set live`                             | promote the selected response                                             | reads `Live now` + mint outline when it already is  | Built             |
| Body editor                            | syntax-highlighted JSON, line numbers                                     | validity readout `valid JSON · N B`                 | Built (read-only) |
| Status / Delay inputs                  | edit the response                                                         | focus: violet border                                | Drawn             |
| `Rename` / `Delete` / `+ Add response` | mutate the response set                                                   | delete hovers magenta                               | Drawn             |
| `Copy curl`                            | copies the `X-Laqi-Response` request                                      | —                                                   | Drawn             |
| Invalid JSON                           | red line/column message replaces the validity readout, `Set live` blocked | —                                                   | Spec              |

## Command palette

| Element                | Action                                                        | States                                  | Status |
| ---------------------- | ------------------------------------------------------------- | --------------------------------------- | ------ |
| Query input            | space-separated tokens, all must match `METHOD path response` | autofocused                             | Built  |
| Result row click / `↵` | flip that response live, close the palette                    | already-live option carries a mint chip | Built  |
| `⌘↵`                   | open the endpoint detail instead of flipping                  | —                                       | Spec   |
| `↑` `↓`                | move the highlight                                            | —                                       | Spec   |
| Backdrop click         | close                                                         | —                                       | Spec   |

## Sharing band

| Element                       | Action                                                                                   | Status |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| `Reveal token` / `Hide token` | unmask the bearer token                                                                  | Built  |
| `Copy URL` / `Copy curl`      | clipboard                                                                                | Drawn  |
| `Stop sharing`                | tears the tunnel down, band disappears                                                   | Built  |
| Pulsing dot                   | 1.4s opacity pulse — the only animation in the product besides the band's 160ms slide-in | Built  |

## Error band

| Element          | Action                                                          | Status |
| ---------------- | --------------------------------------------------------------- | ------ |
| `Reload file`    | re-parse; on success the band disappears and the count corrects | Built  |
| `Open in editor` | `$EDITOR file:line:col` via the CLI                             | Drawn  |

## Tweaks (prototype props)

| Prop               | Effect                                                   |
| ------------------ | -------------------------------------------------------- |
| `accent`           | primary interactive colour (#7A00FF / #FF00A0 / #00FFC2) |
| `density`          | regular 40px rows / compact 26px rows                    |
| `showDescriptions` | endpoint descriptions on/off                             |
| `logRate`          | synthetic request interval, 400–4000ms                   |

## Interaction principles

1. **Optimistic paint, always.** Same machine, zero latency — never spin.
2. **No toasts.** Failures appear where the action was taken.
3. **No modals for anything frequent.** One overlay (the palette) and it is
   keyboard-summoned and transient.
4. **Every destructive action is one click away from reversal** — a flip is
   undone by clicking the default chip, a scenario by clicking its chip again.
5. **`esc` always means "up one level"**, in exactly one predictable order.
