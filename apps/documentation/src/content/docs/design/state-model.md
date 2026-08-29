---
title: The resolution model
---

# The resolution model

The single concept the whole UI exists to make legible: for any endpoint, **which
response is live** and **which layer decided it**.

```
priority   layer       set by                        persists   colour
   1       header      X-Laqi-Response per request    no         mint   #00FFC2
   2       state       this panel (a flip)            yes        magenta #FF00A0
   3       scenario    an active scenario             yes        violet #A366FF
   4       default     the mock file                  n/a        dim    #5C5678
```

Every response laqi serves carries `X-Laqi-Resolved: <name> (<layer>)`; the log
prints exactly that string, so the panel and the network tab never disagree.

## Precedence rules the UI must encode

1. A per-endpoint flip (`state`) beats the active scenario. Flipping an endpoint
   a scenario covers turns its tag from `scenario` to `state` — the scenario
   stays active for everything else.
2. Only one scenario is active at a time. Activating another replaces it;
   clicking the active chip clears it.
3. `header` never mutates state — it only ever appears in the request log, never
   changes a chip in the endpoint list. That asymmetry is deliberate: a
   per-request header is a fact about one request, not about the server.
4. Clicking the chip that equals the file `default`, when no scenario covers the
   endpoint, **deletes** the override instead of writing an identical one. The
   row returns to untinted, and `Overridden` decrements. There is no separate
   "clear" affordance per row because this one is discoverable and reversible.
5. `Reset all to default` clears overrides **and** the scenario. It only appears
   when at least one endpoint is non-default — an inert reset button is noise.

## How each layer is shown

| Surface              | Live response                         | Layer                                          |
| -------------------- | ------------------------------------- | ---------------------------------------------- |
| Endpoint row         | filled chip                           | chip colour + row tint + 5px marker + word tag |
| Request log row      | `boom (state)`                        | text colour of that string                     |
| Detail header        | `boom · state` pill                   | pill border/text colour                        |
| Detail response list | 5px marker on the live one            | marker colour                                  |
| Command palette      | outlined mint chip on the live option | mint = "already live"                          |

Colour alone never carries it: the word (`default` / `state` / `scenario`) is
always present next to the colour, for colour-blind users and for screenshots.

> **Corrección pendiente (H4)** — el prototipo muestra `"x-laqi-resolved": "ok"`
> dentro de la caja de headers **editables** del detalle. Dos problemas: el valor
> va sin la capa (rompe la promesa de "verbatim" del F3), y lo genera laqi, así
> que no puede vivir en un campo que el usuario edita. Ver
> [revision-vs-decisiones.md](/diseno/revision-vs-decisiones/).
