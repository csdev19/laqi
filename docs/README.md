# Documentación interna de laqi

Esta carpeta es el **registro de decisiones** del rewrite de laqi a v2. No es la
documentación de usuario — esa vivirá en `apps/documentation` (Astro + Starlight)
y estará en inglés.

Lo que hay acá es el *por qué*: la evidencia que justificó tirar v1, los criterios
con los que se eligió cada pieza, y las alternativas que se descartaron junto con
la razón. Está en español porque es el idioma en que se discutió.

## Cómo leerlo

Si llegas nuevo, en este orden:

1. **[Análisis de v1](analisis-v1.md)** — qué existía, qué servía, qué estaba roto
   y qué era peligroso. Con evidencia reproducible. Es la base de todo lo demás.
2. **[Conceptos](conceptos/)** — los dos principios transversales que gobiernan
   varias decisiones a la vez.
3. **[Decisiones](decisiones/)** — un ADR por decisión estructural.
4. **[Diseño](diseno/)** — el control panel, y la revisión de ese diseño contra
   los ADRs.

## Índice

### Conceptos

| Doc | De qué trata |
|-----|--------------|
| [Los tres escritores](conceptos/tres-escritores.md) | El principio que decide el formato, la validación y dónde vive el estado |
| [Resolución de estado](conceptos/resolucion-de-estado.md) | Las tres capas que deciden qué respuesta devuelve un endpoint |

### Diseño

| Doc | De qué trata |
|-----|--------------|
| [Prompt del editor](prompt-editor-web.md) | El brief que se le pasó a Claude Design |
| [Diseño del control panel](diseno/) | Lo que volvió: pantallas, interacciones, flujos F1–F9 |
| [Revisión vs decisiones](diseno/revision-vs-decisiones.md) | 13 hallazgos: 1 bloqueante de seguridad, 1 estructural, y las preguntas abiertas |

### Decisiones

| ADR | Decisión | Estado |
|-----|----------|--------|
| [0001](decisiones/0001-rewrite-v2.md) | Rewrite completo en vez de arreglar v1 | Aceptada |
| [0002](decisiones/0002-hono-sobre-elysia.md) | Hono como framework HTTP | Aceptada |
| [0003](decisiones/0003-json-declarativo.md) | JSON declarativo como formato primario | Superada en parte por 0008 |
| [0004](decisiones/0004-estado-fuera-de-git.md) | El estado activo no se trackea | Aceptada |
| [0005](decisiones/0005-monorepo.md) | Monorepo alineado con rakoi | Aceptada |
| [0006](decisiones/0006-servidor-mcp.md) | Servidor MCP como pieza de primera clase | Aceptada |
| [0007](decisiones/0007-url-publica.md) | URL pública: cloudflared primero, relay propio después | Aceptada |
| [0008](decisiones/0008-multiarchivo-y-nombres.md) | Multi-archivo con claves `"METHOD /path"`, y nombres | Aceptada |

## Convención de ADRs

Cada decisión sigue la misma estructura: **Contexto** (qué problema había),
**Decisión** (qué se hace), **Alternativas consideradas** (qué se descartó y por
qué) y **Consecuencias** (lo bueno *y* lo que cuesta).

Un ADR no se edita cuando cambia de opinión: se escribe uno nuevo que lo supera y
se marca el viejo como `Superada por NNNN`. El valor está en poder leer la
historia del razonamiento, no en que el documento esté siempre al día.
