---
title: Conceptos
---

# Conceptos

Principios transversales que gobiernan más de una decisión. A diferencia de los
[ADRs](../decisions/), que registran una decisión puntual y no se editan, estos
documentos describen cómo funciona algo y se mantienen al día.

| Doc                                                 | De qué trata                                                                                                                       | ADRs que dependen de él                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Los tres escritores](/concepts/three-writers/)     | Que ahora hay tres escritores sobre los mocks —humano, editor web e IA— y qué le exige eso al formato, a la validación y al estado | [0003](/decisions/0003-declarative-json/), [0004](/decisions/0004-state-outside-git/), [0006](/decisions/0006-mcp-server/) |
| [Resolución de estado](/concepts/state-resolution/) | Las tres capas que deciden qué respuesta devuelve un endpoint, los escenarios, y el header `X-Laqi-Resolved`                       | [0004](/decisions/0004-state-outside-git/), [0007](/decisions/0007-public-url/)                                            |
