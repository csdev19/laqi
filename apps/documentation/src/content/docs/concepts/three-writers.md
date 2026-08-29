---
title: The three writers
---

# The three writers

**Date:** 2026-08-24

This is the principle that governs several v2 decisions at once: the format
([ADR-0003](/decisions/0003-declarative-json/)), where the state lives
([ADR-0004](/decisions/0004-state-outside-git/)) and why validation
is mandatory at load time. It is worth understanding before the ADRs, because
they all point back here.

## The change from v1

In laqi v1, mock files had **a single writer**: the human, with their text
editor. That allows any format — YAML with comments, TypeScript, whatever —
because a human reads the context, respects the existing style and doesn't
break anything while editing.

In v2 there are **three writers** on the same data:

| Writer             | How it writes           | What it needs from the format                                                  |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------ |
| **The human**      | Text editor, by hand    | Readable, diffable, with autocomplete                                          |
| **The web editor** | Clicks in a UI          | Safe round-trip: read → modify one field → rewrite without destroying the rest |
| **The AI (MCP)**   | Programmatic generation | Predictable, validatable structure; an error should be detected, not executed  |

## What that implies

### 1. The format has to be round-trippable by a machine

This is the hard constraint. The web editor has to be able to open the file,
change one field and write it back **without losing anything** — no comments,
no ordering, no formatting of the fields it didn't touch.

That rules out any format that requires interpreting code to understand it:

- **TypeScript / JavaScript** — rewriting a `.ts` file from a UI requires an
  AST codemod, and even then the result degrades with every pass. On top of
  that, loading `.ts` files means **executing arbitrary code**, and drags a
  transpiler into the CLI.
- **YAML with comments** — preserving comments through a round-trip is
  possible but fragile, and the three writers would each treat it differently.

**JSON wins**, not out of conservatism, but because it is the only format all
three writers share without friction. See
[ADR-0003](/decisions/0003-declarative-json/).

### 2. Validation stops being a luxury

With a single human writer, a typo gets caught when something looks off and
you fix it. With three writers — two of them automatic, one of them a
language model that occasionally hallucinates a field — **invalid data is
inevitable**.

That's why v2 validates with Zod **at load time**, not at runtime. Defects B,
C and G from the [v1 analysis](/v1-analysis/) are exactly this: invalid input
that went undetected and produced a silent 404, a hung request, or a call to
an arbitrary property.

A selector that doesn't exist has to be an error with the file name and the
line. Never a request that hangs.

**Noisy, but not fatal.** Validation fails **per file**, not for the whole
server: an invalid file shows its error, only its endpoints are pulled, and
the rest of the mock keeps being served (the panel's counter reads `26 (+1
file failed)`, so the number never lies). Restarting the entire mock because
one file has an extra comma is hostile, and the developer is almost always in
the middle of something else when it happens.

This applies equally to parse errors (`JSON.parse`) and to semantic errors (a
`default` that points to a nonexistent response, an invalid method, a
duplicated route between files): the same surface, the same error format.

### 3. The state can't live where all three write

If the web editor and the MCP write the active state into the same file you
commit, every click and every instruction to the AI dirties your working
tree.

The human commits. The editor and the AI shouldn't have to decide whether
what they write goes to git. The separation resolves that: **the definition
belongs to the human and is committed; the state belongs to the session and
is not tracked.** See
[ADR-0004](/decisions/0004-state-outside-git/).

## The rule, in one line

> If a change can originate from a machine, the format has to be validatable
> and rewritable by a machine — and what the machine writes doesn't go to
> git.
