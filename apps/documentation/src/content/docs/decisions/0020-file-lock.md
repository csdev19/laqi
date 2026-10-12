---
title: ADR-0020 — Cross-process file lock: O_EXCL sidecar with guarded reclaim, async wait, no dependency
---

# ADR-0020 — Cross-process file lock: `O_EXCL` sidecar with guarded reclaim, async wait, no dependency

**Status:** Proposed
**Date:** 2026-10-12
**Ticket:** [NIW2-313](https://linear.app/niway/issue/NIW2-313)
**Implementation:** not implemented; design in [Core hardening — design spec](../specs/core-hardening.md) §5

## Context

Two independent processes write the same files: the CLI's control plane (`laqi`) and the MCP server (`laqi mcp`), both through `Project` in `@laqi/core`. They write mock files and `.laqi/state.json`. [ADR-0004](/decisions/0004-state-outside-git/) put state in that file, and [ADR-0006](/decisions/0006-mcp-server/) promised that MCP works whether or not the server is running, so there is no single process that could own the file.

`atomic-file.ts` on `main` already has a lock: a sidecar `<file>.lock` opened with `O_CREAT|O_EXCL`, the owner's pid inside, reclaimed when the pid is dead. The audit (core.md Q1, Q2, Q3, Q5, Q6, P3) found four defects in it:

1. **Reclaim race.** Two waiters that both judged a lock dead both `rmSync` it; the second removes the _new_ owner's lock. Two processes end up in the critical section and one write is lost — the very failure the lock exists to prevent.
2. **Event-loop stall.** Waiting is `Atomics.wait` on the main thread, up to 5 s, so the HTTP server, the SSE stream and the panel freeze while another process holds the lock.
3. **Silent failure.** `StateStore.write` discards the lock's outcome; a throw inside the critical section escapes the Result-typed API.
4. **Hygiene.** A failed token write leaks the descriptor; a readable pid from another host or pid namespace is judged dead at once; a recycled pid is "alive" forever.

The question is not whether to fix these but _what to replace the lock with_: a library, a kernel lock, a single-writer architecture, or a repaired version of what exists.

## Decision

**Keep the `O_EXCL` sidecar lock, repair it, and add no dependency.** Concretely:

- Lock content is an owner token `pid:hostname:random64`. Liveness is judged by pid only for tokens from this host; foreign hosts are judged by age; a token this process currently holds is alive by definition.
- Waiting is asynchronous (`setTimeout` polling every 10 ms, 5 s deadline). The critical section (`work()`) stays synchronous.
- A lock is removed by someone other than its owner only under a short-lived guard file (`<file>.lock.reclaim`, also `O_EXCL`), and only after re-reading it and matching content, inode and mtime against the snapshot that was judged dead. The owner's release takes the same guard and removes the file only if it still carries its own token.
- Every failure — cannot open, timed out, `work()` threw — is a `{ ok: false, error }` outcome. Callers surface it (503 in the control plane, `isError` in MCP).

## Alternatives rejected

- **`proper-lockfile`.** Gives up the instant reclaim of a crashed owner (its `stale` minimum is 5 s, default 10 s), adds three transitive dependencies to the published bundle, and its README lists "a lockfile is manually removed and someone else acquires the lock right after" as an undetected case — the same race class as defect 1. Its mtime-refresh guard is for long-held locks, which laqi never has.
- **`flock`/`fcntl` range locks.** Would give kernel-enforced release on crash, but Node core does not expose them and shipping a native addon (`fs-ext`) in an `npx` CLI is not acceptable.
- **A single writer process** (MCP forwards writes to the running server). Would remove the lock entirely, but breaks ADR-0006's "works with laqi stopped".
- **`mkdir` as the primitive with pid file inside.** Equivalent to `O_EXCL` on local filesystems and better on NFSv2; gives up nothing but also fixes nothing by itself (the reclaim race is identical). Not worth changing the on-disk shape.
- **Keep synchronous waiting with a shorter timeout.** Gives up nothing in API churn, but still freezes requests for the shortened time.

## Consequences

- Every function that takes the lock becomes `async`; reads stay synchronous. `@laqi/core` is private, so the only consumers are in this repository (`serve.ts`, `control-plane-app.ts`, `mcp/server.ts`), and the compiler lists every call site.
- Two short-lived files can appear next to a written file: `<file>.lock` and `<file>.lock.reclaim`. Both are swept by the stale window after a crash. They are not `.json`, so the loader ignores them; `.gitignore` templates should list `*.lock`.
- The residual race is: a lock judged dead _wrongly_ (recycled pid, foreign host within the stale window) whose owner is slow. The guard closes the owner's release path too, so even then the owner cannot delete the reclaimer's lock; the owner's own in-flight write may still race the reclaimer's. This needs a crash-like misjudgement plus sub-millisecond timing, and is documented in the code.
- `O_EXCL` on NFSv2 is unreliable. laqi assumes a local project directory, the same assumption chokidar makes for hot reload.

## Non-goals

- Locking across machines sharing one project directory. Age-based reclaim makes it _survivable_, not correct.
- Protecting against a human editing a mock file in their editor while laqi writes it. That is the writer's revision check (`responseRevision`), not the lock.
- Long critical sections. If one ever appears, mtime refresh must be added before raising the stale window.

## Reopen condition

Node core gains a portable advisory lock (`fs.flock` or equivalent) that releases on process death, or laqi gains a daemon that owns the project directory. Either removes the need for userland reclaim and this ADR should be superseded.
