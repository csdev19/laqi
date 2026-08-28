---
title: Registro de decisiones (ADRs)
---

# Registro de decisiones (ADRs)

Un ADR por decisión estructural. Cada uno responde a _por qué_ se hizo algo, no a
_cómo_ se usa.

| ADR                                              | Decisión                                               | Estado                         | Fecha      |
| ------------------------------------------------ | ------------------------------------------------------ | ------------------------------ | ---------- |
| [0001](/decisiones/0001-rewrite-v2/)             | Rewrite completo en vez de arreglar v1                 | Aceptada                       | 2026-08-24 |
| [0002](/decisiones/0002-hono-sobre-elysia/)      | Hono como framework HTTP                               | Aceptada                       | 2026-08-24 |
| [0003](/decisiones/0003-json-declarativo/)       | JSON declarativo como formato primario                 | Parcialmente superada por 0008 | 2026-08-24 |
| [0004](/decisiones/0004-estado-fuera-de-git/)    | El estado activo no se trackea                         | Aceptada                       | 2026-08-24 |
| [0005](/decisiones/0005-monorepo/)               | Monorepo alineado con rakoi                            | Aceptada                       | 2026-08-24 |
| [0006](/decisiones/0006-servidor-mcp/)           | Servidor MCP como pieza de primera clase               | Aceptada                       | 2026-08-24 |
| [0007](/decisiones/0007-url-publica/)            | URL pública: cloudflared primero, relay propio después | Aceptada                       | 2026-08-24 |
| [0008](/decisiones/0008-multiarchivo-y-nombres/) | Multi-archivo con claves `"METHOD /path"`, y nombres   | Aceptada                       | 2026-08-24 |
| [0009](/decisiones/0009-sin-i18n/)               | No i18n: English everywhere                            | Aceptada                       | 2026-08-27 |
| [0010](/decisiones/0010-release-y-npm/)          | release-please, one version line, npm beta line        | Aceptada                       | 2026-08-28 |

## Estructura

**Contexto** — qué problema había. **Decisión** — qué se hace.
**Alternativas consideradas** — qué se descartó y por qué. **Consecuencias** — lo
bueno y lo que cuesta.

Una decisión que cambia no se edita: se escribe un ADR nuevo que la supera, y el
viejo se marca `Superada por NNNN`.
