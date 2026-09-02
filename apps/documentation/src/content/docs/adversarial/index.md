---
title: Adversarial analyses
---

# Adversarial analyses

Documents that argue against a choice laqi has already made, or is about to make.

The [decisions](/decisions/) section records what was chosen and why. This section
does the opposite job: it takes a direction the project is leaning toward and tries
to find the cost, the blast radius and the failure mode before the direction hardens
into an ADR.

An adversarial analysis is not a veto. It is the case the decision has to survive.
Each one states what was measured rather than assumed, names what is still unknown,
and ends with the single question whose answer changes the outcome.

## The rules

- **Measure, don't estimate.** A number in one of these documents was produced by
  running something. Where that was not possible, the document says so.
- **Argue the expensive side.** The point is to surface what a decision costs, not
  to confirm that it is a good idea.
- **Name the hinge.** Every analysis ends on the one open question that actually
  decides the matter — not a list of considerations.
- **Leave the ledger open.** What has not been analysed yet is listed as such,
  never quietly omitted.

## Index

- [Effect adoption](/adversarial/effect-adoption/) — how far Effect should reach
  across the monorepo, what each level of reach buys, and what a project that
  installs the CLI would feel.
- [Effect migration handoff](/adversarial/effect-migration-handoff/) — the Level 1
  implementation slices, lazy-loading constraint, and review notes for the active
  migration.
