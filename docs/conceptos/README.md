# Conceptos

Principios transversales que gobiernan más de una decisión. A diferencia de los
[ADRs](../decisiones/), que registran una decisión puntual y no se editan, estos
documentos describen cómo funciona algo y se mantienen al día.

| Doc | De qué trata | ADRs que dependen de él |
|-----|--------------|--------------------------|
| [Los tres escritores](tres-escritores.md) | Que ahora hay tres escritores sobre los mocks —humano, editor web e IA— y qué le exige eso al formato, a la validación y al estado | [0003](../decisiones/0003-json-declarativo.md), [0004](../decisiones/0004-estado-fuera-de-git.md), [0006](../decisiones/0006-servidor-mcp.md) |
| [Resolución de estado](resolucion-de-estado.md) | Las tres capas que deciden qué respuesta devuelve un endpoint, los escenarios, y el header `X-Laqi-Resolved` | [0004](../decisiones/0004-estado-fuera-de-git.md), [0007](../decisiones/0007-url-publica.md) |
