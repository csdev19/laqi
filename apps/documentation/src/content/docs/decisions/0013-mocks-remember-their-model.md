---
title: ADR-0013 — Mock files remember the model a body was generated from
---

# ADR-0013 — Mock files remember the model a body was generated from

**Status:** Accepted
**Date:** 2026-09-06

## Context

A response body can be generated from a pasted TypeScript model. Until now
the model was used once and dropped: the file kept the generated data and
nothing else, and `regenerate` re-inferred a shape from that data whenever
new values were wanted.

Two problems followed from that, both reported from the panel.

**The endpoint stops explaining itself.** Opening `GET /invoices` a day
later shows a body full of realistic values and no indication that it came
from a model, let alone which one. The developer's words: "I don't know that
this endpoint was made with a model."

**Re-inferring is lossy, and silently so.** JSON carries no literal unions,
no optional field that happens to be absent, and no tuples. A model
declaring `coordinates: [number, number]` produces two numbers; regenerating
from those two numbers produces three, because one sample cannot say the
array had a fixed length. `status: 'draft' | 'issued' | 'paid' | 'void'`
comes back as an arbitrary string.

## Decision

**A generated response stores the model it came from**, beside the body it
produced:

```json
"ok": {
  "status": 200,
  "body": { "id": "inv_9c1f2a", "status": "issued" },
  "generatedFrom": {
    "typeName": "Invoice",
    "model": "export interface Invoice {\n  readonly id: string\n  ...\n}\n"
  }
}
```

`generatedFrom` is optional and written only by the generator. Both fields
are required together: half of it would claim a model exists when none
does.

Two things follow from having it:

- The panel shows the model as it was pasted, every declaration included,
  rather than only offering to copy types guessed from the body.
- `regenerate` uses the model when there is one, and falls back to inferring
  from the body — saying so — when the stored model no longer parses.

## Why

The relation is one to one, which is the argument that settled it: a model
produces a body, and a body implies a model. Only one direction is
lossless, so the lossy direction should not be the one the tool relies on
when it does not have to be.

The alternative reading — that a body is enough, because types can always be
derived from it — is true only for the shape JSON can express. Every
construct laqi's parser was built to understand is exactly what that
derivation throws away.

## Alternatives rejected

**Derive the interface from the body, store nothing.** No format change, and
the panel could still show an interface for every response including
hand-written ones. Rejected because it cannot answer either half of the
report: it cannot say that an endpoint came from a model, and the interface
it shows is a guess that contradicts the model in the ways listed above.
The derivation is kept, as the fallback for responses with no model.

**Store only the type name.** A marker saying "this came from a model called
Invoice", a few bytes, no source. Rejected because the developer asked to
see the interface, and a name is not one.

**Store the model outside the mock file**, in `.laqi/` beside the state.
Rejected because `.laqi/` is deliberately outside git ([ADR-0004](/decisions/0004-state-outside-git/)):
the model would survive on the machine that pasted it and vanish for
everyone who cloned the repository, which is precisely when the endpoint
most needs to explain itself.

## Consequences

**In favour:**

- An endpoint explains where its body came from, a week later and to
  somebody who was not there.
- Regeneration keeps literal unions, optional fields and tuple arity.
- The model travels with the mocks, through git, to the whole team.

**Against:**

- Mock files grow by the size of the pasted model. A model is typically
  smaller than the body it generates, but it is not nothing, and it sits in
  a file people read and review.
- The stored model can go stale. It records where the body came from, not
  what the body currently is: editing the body by hand leaves the model
  untouched and now describing something else. The panel labels it as the
  model the body was _generated from_ for that reason, and never as the
  body's current type.

## Non-goals

- **Validating bodies against the stored model.** laqi does not check that a
  body still matches; a mock's whole job is sometimes to return something
  wrong on purpose.
- **Keeping the model in sync with the project's real types.** It is a copy
  taken at paste time, not a reference to the source file it came from.
- **Storing a model for a pasted JSON body.** The types for those are
  derivable from the body, so a stored copy would only be a second thing to
  keep in step.

## What would reopen this

A mock file where the stored models are a serious share of its weight —
several endpoints generated from one large shared model, each carrying its
own copy. The answer then is deduplication (one model, referenced by
several responses), not dropping the record.
