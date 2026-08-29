---
title: ADR-0004 — Active state is not tracked
---

# ADR-0004 — Active state is not tracked

**Status:** Accepted
**Date:** 2026-08-24

## Context

In v1, the `codeResponse` field lived **inside the mock file**, which gets
committed:

```json
{
  "post": {
    "method": "GET",
    "codeResponse": "200",        <-- the active state, inside the committed file
    "responses": [ ... ]
  }
}
```

That field mixes two things of different natures:

- **Definition** — what responses exist. Stable, shared, makes sense in git.
- **State** — which one is active right now. Volatile, personal, changes
  forty times an afternoon.

With the web editor and the MCP writing to those same files, it had to be
decided where state lives.

## Decision

**The definition is committed. Active state is not tracked.**

```
laqi.json               definition + "default"       committed
laqi/scenarios.json     named scenarios                committed
.laqi/state.json        active state                    gitignored, auto-created
X-Laqi-Response         per-request override             stateless
```

The precedence details are in
[state resolution](/concepts/state-resolution/).

**Important note:** the state **is** persisted to disk. The decision isn't
"save or don't save", it's **where**: in a separate file that doesn't go to
git, not inside the committed file.

## What's lost if state lives in the committed file

**1. A dirty diff, every day.**

You show the designer the 401, then the 500, then go back to the 200. Three
modifications to `laqi.json`. Now `git status` is dirty and you have to
decide: if you commit, you push your demo state to the whole team; if you
don't commit, it stays in the working tree forever and collides on every
`pull`. There's no good way out — it's daily friction over something that
isn't code.

**2. Merge conflicts that mean nothing.**

Dev A commits `"default": "boom"` because they were testing errors. Dev B
commits `"default": "empty"`. Conflict. A merge conflict should mean "two
people touched the same logic"; here it means nothing, and that trains the
team to resolve conflicts on autopilot — the habit that ends up losing a real
change one day.

**3. The public URL becomes single-user.** ← the deciding reason

Specific to the feature that justifies v2. You spin up the tunnel and share
the URL. You're testing your error screen, so you set `POST /orders` to 500.

At that exact moment **the designer is viewing the demo on her phone,
against that same URL, and gets a 500.** And so does your backend teammate
validating contracts.

With a global field, the shared mock has one state at a time — and sharing
it was half the reason to have the URL. With the `X-Laqi-Response` header,
each person declares what they want and nobody steps on anybody else.

**4. E2E tests get serialized.**

A Playwright test that needs the 500 has to mutate global state, so no other
test can run in parallel meanwhile. With a header, each test asks for its
own and they all run together.

## What this decision costs

It's only fair to say it:

**1. State stops traveling in the repo.**

In v1, committing `codeResponse: "error401"` made your teammate clone and
reproduce your exact setup. That's a real capability.

**Not lost: that's what scenarios are for.** `scenarios.json` is committed,
has a name, and `laqi scenario checkout-broken` reproduces the same state.
It's the same capability, explicit and named instead of implicit and
accidental — in v1 you shared it by accident, here you share it on purpose.

**2. One more concept and one more file.** Real cost. Mitigated by it being
gitignored, auto-created, and never opened by hand: the editor and the MCP
handle it.

**3. Opening `laqi.json` no longer tells you what's active.** Also real.
Mitigated with `laqi status`, the server's startup log, and the web editor.

**4. Two places to look when something returns something odd.**

The most annoying cost, and it has a clean solution: laqi returns a header
on **every** response saying which layer decided.

```
X-Laqi-Resolved: boom (state)      ← the editor set it
X-Laqi-Resolved: ok (default)      ← nobody touched anything
X-Laqi-Resolved: boom (header)     ← this request asked for it
```

You open devtools and see where the response came from. The problem
disappears.

## Alternatives considered

**State inside the mock, like v1.** Simpler, a single file, zero new
concepts, and state shared via git. Discarded for the four points above —
above all the third, which breaks v2's central feature.

It would be the right decision if laqi were for one dev, on one machine,
with no shared URL, no editor and no AI. That is no longer the laqi being
built: the rewrite's three pillars are exactly the three cases where global
state hurts.

**In-memory only, without persisting.** Git stays as clean as with a
separate file, but you build a demo setup touching eight endpoints, hit
Ctrl-C, and lose the work. It's strictly worse than the separate file for
the price of a `JSON.stringify` — you pay the cost without gaining anything.
Discarded.

## Consequences

**In favour:**

- Clean git; mock diffs only show real definition changes.
- The public URL serves several people with different states.
- E2E tests run in parallel.
- The web editor and the MCP write without dirtying the working tree.

**Against:**

- One more file and concept to learn.
- `X-Laqi-Resolved` and `laqi status` have to be implemented so
  traceability doesn't degrade. **They are not optional**: without them,
  cost 4 comes back.

## Escape hatch

`.laqi/state.json` is gitignored **by convention, not by obligation**.
Taking it out of `.gitignore` and committing it is a one-line change, if some
team decides they want state shared via git.
