---
title: Product
description: Positioning and context material — the pitch, a self-contained AI briefing, and the tech stack.
---

# Product

Documents split by audience, because they don't share a shape:

- **[Pitch](/product/pitch/)** — for a person. Problem, solution, why it's
  different, who it's for. Short, persuasive, no internal jargon.
- **[AI briefing](/product/ai-briefing/)** — for another AI. Dense, factual,
  self-contained: everything a model needs to reason about laqi correctly
  with no repo access and no follow-up questions.
- **[AI design brief](/product/ai-design-brief/)** — for an AI doing design
  work. Theme, palette semantics, typography, brand assets, voice — every
  visual decision, self-contained.
- **[Stack](/product/stack/)** — the technology choices, package by package,
  with the reasoning behind each one.
- **[Roadmap](/product/roadmap/)** — what has shipped (verified against
  PRs), what is in flight, and what comes next.

None of these replace the [ADRs](/decisions/) (the historical record of _why_
a decision was made) or the root [README](https://github.com/csdev19/laqi)
(the technical reference for actually using laqi). They exist because
"describe the whole product" and "give a model context" and "list the stack"
are different questions that deserve different answers instead of one
document trying to serve all three.
