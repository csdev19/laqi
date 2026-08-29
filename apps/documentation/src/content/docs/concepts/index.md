---
title: Concepts
---

# Concepts

Cross-cutting principles that govern more than one decision. Unlike
[ADRs](../decisions/), which record a single decision and are never edited,
these documents describe how something works and are kept up to date.

| Doc                                             | What it covers                                                                                                                               | ADRs that depend on it                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [The three writers](/concepts/three-writers/)   | That there are now three writers of the mocks — human, web editor and AI — and what that demands of the format, the validation and the state | [0003](/decisions/0003-declarative-json/), [0004](/decisions/0004-state-outside-git/), [0006](/decisions/0006-mcp-server/) |
| [State resolution](/concepts/state-resolution/) | The three layers that decide which response an endpoint returns, the scenarios, and the `X-Laqi-Resolved` header                             | [0004](/decisions/0004-state-outside-git/), [0007](/decisions/0007-public-url/)                                            |
