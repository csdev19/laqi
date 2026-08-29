---
title: Resolution layers
description: The four layers that decide every response.
---

Every request laqi answers passes through four layers. The first one that
has an opinion wins, and the winner is reported back to you in three
places so the panel, the terminal, and your network tab can never
disagree.

:::note
A header override never changes panel state. It answers one request and
leaves no trace — which is what makes it safe to use inside an automated
test.
:::

## Order of precedence

| # | Layer | Set by | Persists |
| - | - | - | - |
| 1 | `header` | `X-Laqi-Response` on the request | no |
| 2 | `state` | a click in the control panel | yes |
| 3 | `scenario` | the active scenario, if it covers this route | yes |
| 4 | `default` | the `default` key in the mock file | — |

## Reading the winner

Every response carries a header naming the response and the layer that
chose it:

```

$ curl -i 127.0.0.1:8000/todos

HTTP/1.1 200 OK
content-type: application/json
x-laqi-resolved: error (state)

```

The same string appears in the terminal stream and in the panel's
request log. If you ever wonder why your app is seeing something odd,
that one line answers it.
