# Registro de decisiones (ADRs)

Un ADR por decisión estructural. Cada uno responde a *por qué* se hizo algo, no a
*cómo* se usa — el "cómo" va en `apps/documentation`.

| ADR | Decisión | Estado | Fecha |
|-----|----------|--------|-------|
| [0001](0001-rewrite-v2.md) | Rewrite completo en vez de arreglar v1 | Aceptada | 2026-08-24 |
| [0002](0002-hono-sobre-elysia.md) | Hono como framework HTTP | Aceptada | 2026-08-24 |
| [0003](0003-json-declarativo.md) | JSON declarativo como formato primario | Parcialmente superada por 0008 | 2026-08-24 |
| [0004](0004-estado-fuera-de-git.md) | El estado activo no se trackea | Aceptada | 2026-08-24 |
| [0005](0005-monorepo.md) | Monorepo alineado con rakoi | Aceptada | 2026-08-24 |
| [0006](0006-servidor-mcp.md) | Servidor MCP como pieza de primera clase | Aceptada | 2026-08-24 |
| [0007](0007-url-publica.md) | URL pública: cloudflared primero, relay propio después | Aceptada | 2026-08-24 |
| [0008](0008-multiarchivo-y-nombres.md) | Multi-archivo con claves `"METHOD /path"`, y nombres | Aceptada | 2026-08-24 |

## Estructura

**Contexto** — qué problema había. **Decisión** — qué se hace.
**Alternativas consideradas** — qué se descartó y por qué. **Consecuencias** — lo
bueno y lo que cuesta.

Una decisión que cambia no se edita: se escribe un ADR nuevo que la supera, y el
viejo se marca `Superada por NNNN`.
