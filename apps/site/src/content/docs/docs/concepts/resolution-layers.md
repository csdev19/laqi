---
title: Resolution layers
description: The four layers that decide every response.
---

Every request laqi answers passes through four layers: `header`, `state`,
`scenario`, and `default`. The first one that has an opinion wins.

## Order of precedence

| # | Layer | Set by | Persists |
| - | - | - | - |
| 1 | `header` | `X-Laqi-Response` on the request | no |
| 2 | `state` | a click in the control panel | yes |
| 3 | `scenario` | the active scenario, if it covers this route | yes |
| 4 | `default` | the `default` key in the mock file | — |
