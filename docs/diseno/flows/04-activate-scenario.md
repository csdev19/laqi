# F4 — Activate a scenario

**Frequency** several per day, and the demo move · **Surface** scenarios strip, main view

## Trigger
"Show me the app with checkout broken" — one action, whole API in a known state.

## Steps
1. Chips sit above the list, always visible: `checkout-broken 3`,
   `new-user 3`, `offline 5`, `slow-network 4`, `logged-out 3`. The number is
   how many endpoints the scenario moves — the blast radius, shown before the
   click.
2. Click a chip → violet fill, white label. Every endpoint it touches takes the
   violet wash and its layer tag reads `scenario`.
3. Only one scenario is active; clicking another replaces it. Clicking the
   active one clears it.
4. `PUT /__laqi/api/state` persists `{ scenario }` alongside the overrides.

## Interaction with F1
A per-endpoint flip beats the scenario. The row turns magenta and reads
`state`; the scenario chip stays active for everything else. This is how a
developer demos `offline` while keeping `GET /health` green.

## Exit
Click the active chip, or `Reset all to default` (clears scenario + overrides).

## Why not a dropdown
Scenarios are the fastest route to a known state, and a dropdown hides both the
options and the fact that one is active. Chips also make the active scenario
readable in a screenshot, which is what people paste into a bug report.

## Editing scenarios
Out of scope for the panel: scenarios live in the config file. The panel
activates them, it does not author them (a settings surface for something that
belongs in a file was explicitly ruled out).
