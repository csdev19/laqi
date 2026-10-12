---
title: Module execution trust — design spec
---

# Module execution trust — design spec

**Status:** proposed, not implemented
**Date:** 2026-10-12
**Ticket:** [NIW2-310 — Require a real human decision before running project modules](https://linear.app/niway/issue/NIW2-310), part of the laqi audit umbrella NIW2-302
**Supersedes:** the section "Executing project code" of the [JSON Schema adapters spec](/design/json-schema-adapters/#executing-project-code) and the "From MCP" paragraph that follows it, once implemented. Everything else in that spec stands.
**ADR:** [ADR-0016 — Running project code needs a decision made outside the channel that asked](/decisions/0016-module-execution-trust/) (draft, number assigned by the parent)

This document turns one audit finding into contracts an implementer can build and a
reviewer can check. Normative statements use **must** / **must not**. Code blocks
marked _illustrative_ show intent, not final declarations. Line numbers refer to the
read-only export of `origin/main` taken on 2026-10-12; the audits were written against
`feat/hero-demo`, so every finding was re-located and the current lines are the ones cited.

## One-minute block

### Summary

laqi can execute a file from the user's project to read a schema out of it
(`project-module` sources). Today the two gates in front of that execution are not
gates: on the local HTTP control plane the same caller runs `prepare` and then
`confirm` with the token `prepare` just handed it, and for MCP the allowlist that
pre-approves modules ships inside the repository, so a cloned repo approves its own
code. The child process that runs the module also inherits every environment variable
laqi has, buffers its output without limit, and finds its own verdict with a string
search that a legitimate schema can defeat.

The design: **a decision to run project code must be made on a channel the requester
cannot read or write.** For the panel, that channel is laqi's terminal: `prepare`
prints a short approval code there and never returns it over HTTP; `confirm` needs
the token _and_ the code. For agents, that channel is a person at a terminal running
`laqi trust` once per machine, which records the resolved path and content hash of
each listed module in a user-level store that no repository or MCP client config can
pre-populate. Tokens and codes come from the CSPRNG, are single-use and expire. The
child gets an allowlisted environment, a bounded output, a dedicated verdict channel,
and verifies the file's digest itself immediately before importing it. MCP stops
advertising the module path as read-only: the module path becomes its own tool,
`generate_from_module`, so `generate_data` keeps its read-only hint for the sources
that are read-only.

### Decisions

| #   | Decision                                                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                   | ADR                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| D1  | Panel approval = token (returned over HTTP) **plus** an approval code printed only in laqi's terminal. Confirm needs both.                                                                                                   | The only thing an HTTP caller on 127.0.0.1 cannot read is laqi's own stdout. A per-panel secret would prove origin, not a person; a TTY prompt needs stdin, which `laqi start` often does not own (turbo, concurrently, CI).                          | creates ADR-0016                                         |
| D2  | Agent approval = listed in `mcp.modules` **and** approved on this machine by `laqi trust`, recorded in `$XDG_CONFIG_HOME/laqi/trusted-modules.json`.                                                                         | The repo-local list is the author's statement, not the developer's. Like direnv `allow`, mise `trust` and VS Code Workspace Trust, the decision has to live outside the thing being trusted.                                                          | creates ADR-0016                                         |
| D3  | Trust is keyed by resolved real path + export + side + **sha256 of the file's content**. An edit or a `git pull` that changes the file revokes it; fail closed.                                                              | Path-only trust (VS Code) survives a hostile commit; a hash of the config (audit suggestion) survives a change to the module itself. Content-bound trust is what direnv and mise converged on.                                                        | reuses ADR-0016                                          |
| D4  | The trust store honours `XDG_CONFIG_HOME`/`HOME` but refuses a store located under the project root, not owned by the current user, or group/world accessible.                                                               | A repo-local `.vscode/mcp.json` or `.cursor/mcp.json` can set the MCP server's environment. mise shipped exactly this bug (CVE-2026-35533: project config relocated its own trust list). Structural checks beat a laqi-specific env override.         | reuses ADR-0016                                          |
| D5  | Tokens are 32 CSPRNG bytes; codes are 8 CSPRNG symbols from a 32-symbol alphabet; a wrong code spends the token; 3 wrong codes lock module prepare for 60 s.                                                                 | `sha256(path + time + Math.random())` is not a secret. One guess per prepare, and every prepare prints a line a person sees, makes brute force loud and slow.                                                                                         | none                                                     |
| D6  | `generate_data` keeps `readOnlyHint: true` and **refuses** `project-module`; a new tool `generate_from_module` carries `readOnlyHint: false, openWorldHint: false` and the execution semantics in its description.           | Dropping the hint on `generate_data` would make the common, harmless path (pasted TypeScript) prompt in every host that honours annotations. A separate tool names the dangerous act and lets hosts gate exactly it.                                  | none (annotation policy for all other tools is NIW2-314) |
| D7  | The child gets an allowlisted environment, 64 KiB caps on captured stdout/stderr (discard, do not kill), an 8 MiB verdict on fd 3, process-group kill on timeout, and verifies the expected sha256 itself before `import()`. | Minimal env closes the secret leak. fd 3 removes the `lastIndexOf('{"ok":')` ambiguity and lets stdout be capped without truncating the verdict. The in-child digest check shrinks the TOCTOU window to the import call itself.                       | none                                                     |
| D8  | No runtime sandbox (`node --permission`, Bun equivalent) in this ticket. Stays a documented non-goal with a reopen condition.                                                                                                | `engines.node >= 20` and a Bun parent (`bunx laqi`) cannot be given a uniform permission set; the fs-read allowlist follows symlinks (documented Node limitation) and breaks hoisted/global package stores. A gate that asks a person is the control. | reuses ADR-0016 (non-goal)                               |

### Open questions for the owner

1. **Terminal accelerator.** When `laqi start` owns a TTY, should pressing `y` in the
   terminal also approve the pending load (so the person does not have to copy the
   code into the panel)? Recommendation: not in this ticket; the code works for every
   way laqi is launched and adds one mechanism, not two. Reopen if users complain.
2. **MCP elicitation.** When the MCP client declares the `elicitation` capability,
   should `generate_from_module` offer a session-only approval through the host's own
   dialog instead of refusing with "run `laqi trust`"? Recommendation: defer. The MCP
   spec says clients SHOULD implement approval controls, but laqi cannot tell a human
   answer from an auto-accepting client, and the spec forbids eliciting sensitive
   data, which a code-execution grant arguably is. See [Alternatives](#alternatives-considered-and-rejected).
3. **Panel approval also trusting for agents.** After a person types a code in the
   panel, should the panel offer "also allow agents to run this module"? Recommendation:
   no. `laqi trust` stays the single place a standing permission is granted; mixing
   the two meanings is what the current code comments warn against.
4. **Lockout numbers.** 3 wrong codes → 60 s lockout, 3 pending loads per process,
   120 s TTL. These are judgement calls, not measurements; say if you want different ones.
5. **Tool name.** `generate_from_module` versus `load_project_module`. The spec uses the
   former because the result shape is `generate_data`'s.

### Out of scope

- Host/Origin/CSRF on the control plane, panel security headers, SSE, CLI lifecycle:
  NIW2-309. This spec assumes those land; it does not depend on them.
- `schemaSources.root` default, `refresh_schema` file reads, symlink handling in the
  loader, `resolveSourcePath` returning the lexical path: NIW2-313.
- Config path grammar for `dir`, `file`, `schemaSources.root`, `mcp.modules[].file`,
  fail-closed config, unknown keys: NIW2-315. This spec adds a defence-in-depth check
  on module entries only.
- Annotations of every MCP tool other than `generate_data` and the new tool,
  prompt-injection delimiting, output caps on other tools: NIW2-314.
- TUI control-character sanitising: NIW2-316. The approval notice prints a project
  path; it **must** go through whatever sanitiser NIW2-316 adds, or strip
  `\x00-\x1f\x7f` locally until then.
- Running project modules from the public listener (`--share`): already impossible on
  main (the control plane is not mounted there) and stays so.
- A security sandbox for the module's code (D8).
- Whether Node 20/22 can import a `.ts` module at all without `--experimental-strip-types`
  (unflagged from 22.18 / 23.6). Unverified here and unchanged by this ticket.

## Vocabulary

| Term          | Meaning here                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Module        | A file under `schemaSources.root` that laqi imports to read a Standard JSON Schema export out of it.             |
| Load          | One execution of a module to convert one export on one side. Always in a child process.                          |
| Requester     | Whoever sends the request that would cause a load: the panel's JavaScript, any local process, an MCP client.     |
| Approval      | A decision, made by a person, that laqi can distinguish from anything the requester could have produced.         |
| Token         | The handle `prepare` returns to the requester. Identifies a pending load; proves nothing about a person.         |
| Approval code | The short secret printed in laqi's terminal for one pending load. Never travels over HTTP from laqi to a client. |
| Trust store   | The user-level file where `laqi trust` records which listed modules a person approved on this machine.           |
| Listed        | Present in `mcp.modules` in the project's `laqi.config.json`.                                                    |
| Trusted       | Listed, resolvable inside the source root, and recorded in the trust store with the file's current content hash. |

## Findings and designed behaviour

### F1. Prepare and confirm are callable by the same caller

**Current behaviour (main).**

- `packages/core/src/module-permission.ts:67-93` — `prepare()` resolves and digests the
  file and puts a `PreparedModule` in an in-memory map; `:103-132` — `confirm(token)`
  spends the token and returns the prepared load if the digest still matches. Nothing
  else is checked.
- `packages/server/src/control-plane-app.ts:756-781` — `POST /api/schema/module/prepare`
  returns `{ token, resolvedPath, exportName, side }` to the caller; `:783-806` —
  `POST /api/schema/module/confirm` takes `{ token, allowLoss? }` and runs the import.
  The comment at `:789-791` says a `confirmed: true` field is not approval, which is
  true, but the token is handed to the same caller, so it is not approval either.
- `apps/cli/src/serve.ts:393-427` wires both to `ModuleApprovals` and `importSchema`.
- `packages/editor/src/App.tsx:260-319` and `components/CreateEndpointRow.tsx:288-298`
  show the resolved path and a "Run" button. The person sees the path; the server
  cannot know whether a person was there.
- The only other protection is the Origin guard at `control-plane-app.ts:285-305`, which
  accepts any `http://localhost:*` origin and does not apply to requests without an
  `Origin` header. Tightening it is NIW2-309; it stays a browser-only control either way.

Nothing about this changed between the audited branch and main (the routes moved from
`:712-762` to `:756-806`).

**Threat.** Any process on the developer's machine that can open a TCP connection to
127.0.0.1:8000, or any page that gets past the Origin guard, calls `prepare` with
`{ file: "scripts/evil.ts" }` then `confirm` with the token it received, and laqi
executes that file with the developer's permissions. The file must already be under
`schemaSources.root` (default `.`), which in a cloned repository is the attacker's
own tree. The audits rate this high (server S2, security-scan F3, core S4, cli X3).

**Designed behaviour.**

1. `prepare` **must** generate two independent secrets: a `token` and an
   `approvalCode`, both from `node:crypto` (`randomBytes(32)` and `randomInt`
   respectively). `Math.random` **must not** appear in this module.
2. The HTTP response of `prepare` **must** contain `token`, `resolvedPath`,
   `exportName`, `side` and `expiresAt`, picked field by field. It **must not**
   contain the approval code, in any field, encoding or header.
3. Before `prepare` returns, the runtime **must** present the approval code to the
   person through a channel that is not the HTTP response. For `laqi start` that is
   the process's stdout, as a notice in the TUI style:

   ```
   ? the panel asks to run a project module
     file     /home/me/shop/src/types/api.ts
     export   Invoice (output)
     code     7KQ4-M2XW
     type this code in the panel to run it · expires in 120 s
     if you did not ask for this in the panel, ignore it: something else on this machine is asking laqi to run project code
   ```

   The presenter is an injectable function on `startServer` so tests can play the
   person. The default presenter writes to stdout at the normal output level and
   **must** pass `resolvedPath` through the control-character sanitiser (NIW2-316) or
   strip `\x00-\x1f\x7f` itself.

4. `confirm` **must** take `{ token, code, allowLoss? }`. The code is compared after
   normalisation (uppercase, dashes and whitespace removed) with
   `crypto.timingSafeEqual` on equal-length buffers. A request without `code` is a
   400 like any other schema failure.
5. A token is spent on its **first** redemption whatever the outcome: wrong code,
   expired, digest changed. A second `confirm` with the same token **must** fail. This
   makes one `prepare` worth exactly one guess.
6. After three wrong codes within any ten-minute window, the store **must** refuse
   `prepare` and `confirm` for 60 seconds with code `locked` (HTTP 429 from the route)
   and the presenter **must** print one warning line. The window and counter are
   per-process.
7. The pending map **must** hold at most three loads; a fourth `prepare` evicts the
   oldest and prints that it did. Expired entries are swept on every `prepare`.
8. A loss refusal on `confirm` **must** return `{ code: 'loss', diagnostics, retryToken }`.
   `confirm({ token: retryToken, allowLoss: true })` is accepted **once**, without a
   code, until the original `expiresAt`, and only for the same digest. The person
   approved running that exact file; asking them to read a second code to accept an
   approximation of the same run is friction without a security gain. The retry
   **should** reuse the document the first load produced rather than execute again;
   if it executes again it **must** re-check the digest.
9. The panel **must** show, after `prepare`, the resolved path and export, an input for
   the code, and the sentence "laqi printed an approval code in its terminal". A
   wrong code shows the server's message and clears the pending load (the token is
   spent). A `locked` refusal shows the wait time.
10. `POST /api/schema/import` with `source.kind === 'project-module'` keeps refusing
    (`serve.ts:283-295`) and the message **must** name both steps and the terminal code.

**Interfaces** (_illustrative_):

```ts
// packages/core/src/module-permission.ts
export const MODULE_TOKEN_TTL_MS = 120_000
export const MAX_PENDING_MODULES = 3
export const MODULE_LOCKOUT_MS = 60_000
export const MODULE_LOCKOUT_AFTER = 3

export type PreparedModule = {
  token: string            // 64 hex chars, randomBytes(32)
  approvalCode: string     // "XXXX-XXXX", alphabet 0-9 A-H J K M N P-T V-Z (no I, L, O, U)
  file: string
  resolvedPath: string
  exportName: string
  side: 'input' | 'output'
  digest: string           // sha256 hex of the file at prepare time
  expiresAt: number
}

export type PrepareFailure = { ok: false; error: string; code: 'invalid' | 'not-found' | 'locked' }
export type ConfirmFailure = { ok: false; error: string; code: 'invalid' | 'locked' }

export class ModuleApprovals {
  constructor(root: string, config: LaqiConfig, now?: () => number)
  prepare(request: ModuleRequest): { ok: true; value: PreparedModule } | PrepareFailure
  /** Spends the token. `code` is required unless `token` is a retry token. */
  confirm(token: string, code: string | undefined): { ok: true; value: PreparedModule; retry: boolean } | ConfirmFailure
  /** Issued by the runtime after a loss refusal; bound to the same digest and expiry. */
  issueRetry(prepared: PreparedModule): string
}
```

```ts
// packages/server/src/control-plane-app.ts — request schemas
const ConfirmModuleRequestSchema = z.object({
  token: z.string().min(1).max(128),
  code: z.string().min(1).max(32).optional(),   // optional only so a retry token can omit it
  allowLoss: z.boolean().optional(),
})
// prepare response: { token, resolvedPath, exportName, side, expiresAt }
// confirm 400 on loss: { error, message, diagnostics, retryToken }
// confirm 429 on lockout: { error, message, retryAfterSeconds }
```

```ts
// apps/cli/src/serve.ts — startServer options
showModuleApproval?: (prepared: PreparedModule) => void
```

**Migration.** The panel and the CLI ship in one package (`tsdown.config.ts` copies
`packages/editor/dist` into the bundle), so there is no version skew: a new CLI
serves a new panel. Anyone scripting `prepare`/`confirm` directly against the control
plane loses the ability to run modules unattended. That is the point, and the only
documented client is the panel. No config key changes.

**Tests.**

| Test (file)                                                                                            | Input                                                                                                      | Expected                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module-permission.test.ts` — "issues tokens and codes from the CSPRNG, different every time"          | 50 × `prepare(request)`                                                                                    | 50 distinct tokens matching `/^[0-9a-f]{64}$/`, codes matching `/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/`; source contains no `Math.random` (grep in a test or a lint rule) |
| "refuses a token without the code the person was shown"                                                | `confirm(token, undefined)` and `confirm(token, '')`                                                       | `{ ok: false, code: 'invalid' }`, message mentions "approval code"                                                                                                                 |
| "spends the token on a wrong code"                                                                     | `confirm(token, 'ZZZZ-ZZZZ')` then `confirm(token, rightCode)`                                             | second call `{ ok: false }`                                                                                                                                                        |
| "forgives case, dashes and spaces in a typed code"                                                     | `confirm(token, ' 7kq4m2xw ')`                                                                             | `{ ok: true }`                                                                                                                                                                     |
| "locks module loads after three wrong codes"                                                           | 3 × prepare+wrong confirm, then `prepare`                                                                  | `{ ok: false, code: 'locked' }`; after clock += 60 s, `prepare` succeeds                                                                                                           |
| "keeps three pending loads and evicts the oldest"                                                      | 4 × `prepare`, confirm the first                                                                           | first `{ ok: false }`, fourth `{ ok: true }`                                                                                                                                       |
| "a retry token confirms once without a code and only before the original expiry"                       | `issueRetry(p)`; `confirm(retry, undefined)` twice; again after TTL                                        | first `{ ok: true, retry: true }`, second `{ ok: false }`, expired `{ ok: false }`                                                                                                 |
| existing: single use, expiry, digest change, refusal spends token                                      | unchanged inputs                                                                                           | unchanged, with `code` added to the calls                                                                                                                                          |
| `serve.schema.test.ts` — "prepare never returns the approval code"                                     | `startServer({ showModuleApproval: capture })`, POST prepare                                               | `JSON.stringify(response)` does not contain the captured code, in any case or without dash                                                                                         |
| "confirm with token alone is refused; with token and the printed code it imports"                      | POST confirm `{ token }` → 400; POST confirm `{ token, code }` → 200 with snapshot                         | as stated; `snapshot.source.kind === 'project-module'`                                                                                                                             |
| "a loss refusal hands back a retry token that works once with allowLoss"                               | module whose output uses an unsupported keyword; confirm; confirm `{ token: retryToken, allowLoss: true }` | first 400 with `retryToken`; second 200; third 400                                                                                                                                 |
| "three wrong codes answer 429 with a retry time"                                                       | 3 × wrong confirm, then prepare                                                                            | 429, body has `retryAfterSeconds`                                                                                                                                                  |
| "the printed notice carries no control characters"                                                     | module path containing `\x1b]52;c;...\x07` (if the filesystem allows) or a unit test of the formatter      | formatter output matches `/^[^\x00-\x1f\x7f]*$/m` except `\n`                                                                                                                      |
| `control-plane-app.test.ts` — "confirm rejects a body without code unless the runtime reports a retry" | stubbed runtime                                                                                            | 400 schema message names `code`                                                                                                                                                    |

### F2. `generate_data` is annotated read-only but can execute project modules

**Current behaviour (main).** `packages/mcp/src/server.ts:356-401` registers
`generate_data` with `annotations: { readOnlyHint: true }` at `:400`; `:434-446` is the
`project-module` branch that consults `approvals.allowedForAgents` and then `:448`
calls `importSchema`, which spawns the module (`packages/generate/src/import-schema.ts:329-335`).
`refresh_schema` (`:621-638`) has no annotations and cannot reach a module because
`packages/core/src/refresh-source.ts:39-44` refuses every source kind but `json-schema`
(the audit's claim that it "correctly refuses modules" holds). Unchanged since the audit.

**Threat.** The MCP spec says clients MUST treat annotations as untrusted unless the
server is trusted, and that there SHOULD be a human in the loop; in practice hosts use
`readOnlyHint` to decide what to auto-approve or run concurrently (Codex CLI
reportedly dispatches read-only tools concurrently; Claude Code's own read tools are
auto-allowed; both secondary sources, see References). A host that trusts laqi and
honours the hint runs a listed module, and everything it imports, with no prompt, as
often as an injected instruction asks. The annotation makes laqi lie to the host.

**Designed behaviour.**

1. `generate_data` keeps `readOnlyHint: true` and **must** refuse
   `source.kind === 'project-module'` with an `isError` result that names
   `generate_from_module`. The refusal happens before any path is resolved.
2. A new tool `generate_from_module` **must** be registered with:
   - `inputSchema`: `{ file, exportName, side?, allowLoss?, arrayLength?, seed? }` — the
     `project-module` fields flattened, so the schema the agent reads says what it is.
   - `annotations: { readOnlyHint: false, openWorldHint: false }`; `destructiveHint`
     and `idempotentHint` are left at their defaults (true and false) because laqi
     cannot promise anything about the module's side effects.
   - `title: 'Generate mock data by running a project module'`.
   - A description whose first sentence is "Runs the named file from the project, and
     everything it imports, in a child process, to read a JSON Schema from one of its
     exports." and which states that the module must be listed in `mcp.modules` **and**
     approved on this machine with `laqi trust`.
   - The same result shape as `generate_data` (`preview`, `schema`, `generation`,
     `diagnostics`, `warnings`), so `apply_generated_body` works unchanged.
3. The server `instructions` **must** gain one line: "`generate_from_module` executes
   project code; it only runs what a person listed and approved, and it says what to
   ask the person for when it cannot."
4. `documented-tools.test.ts` and `tool-descriptions.test.ts` keep passing: the agent
   briefing (`product/ai-briefing.md`) and the adapters spec's MCP table gain the tool.

**Migration.** Breaking for agents that pass `project-module` to `generate_data`: they
get a text error that names the replacement, and agents follow text errors. No config
change. Note in the changelog as a breaking change under ADR-0010's one-version-line rule.

**Tests** (`packages/mcp/src/stdio.test.ts`, section "executing a project module, from an agent").

| Test                                                                       | Input                                                                                          | Expected                                                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "generate_data refuses a project module and names the tool that runs them" | `generate_data({ source: { kind: 'project-module', ... } })`                                   | `isError`, text contains `generate_from_module`; no child process spawned (module file writes a marker on import; marker absent) |
| "readOnlyHint is set only on tools that spawn nothing and write nothing"   | `listTools()`                                                                                  | the set of tools with `readOnlyHint: true` does not contain `generate_from_module`; `generate_data` has it                       |
| "generate_from_module is not read-only and not open-world"                 | `listTools()`                                                                                  | `annotations` deep-equals `{ readOnlyHint: false, openWorldHint: false }`                                                        |
| "generate_from_module runs a listed and trusted module"                    | config lists `src/types.ts#Invoice`; trust store (temp `XDG_CONFIG_HOME`) holds its hash; call | `isError: false`, `schema.source` equals the project-module descriptor                                                           |
| existing "has no tool that writes mcp.modules"                             | unchanged                                                                                      | unchanged; also asserts no tool input mentions `trusted-modules`                                                                 |

### F3. A repo-local `laqi.config.json` pre-approves modules that `laqi mcp` runs without a prompt

**Current behaviour (main).**

- `apps/cli/src/index.ts:44-77` loads `laqi.config.json` from `process.cwd()`;
  `:160-166` starts `laqi mcp` with that config. Nothing is printed about what the file
  granted.
- `packages/schema/src/config.ts:30-42` declares `mcp.modules` as `{ file, exportName,
side }` with `file: z.string().min(1)`: absolute paths and `..` are accepted (NIW2-315
  owns the grammar). `schemaSources.root` (`:21`) defaults to `.`.
- `packages/core/src/module-permission.ts:143-150` — `allowedForAgents` is a string
  comparison against that list. `packages/mcp/src/server.ts:62` builds the store from
  the loaded config. No user-level state exists anywhere.
- `stdio.test.ts:640-663` proves a listed module executes with no other step.

Unchanged since the audit (cli X6, schema S1, core S5, mcp S2/S6).

**Threat.** A repository ships `laqi.config.json` with
`"mcp": { "modules": [{ "file": "scripts/setup.ts", "exportName": "Schema" }] }`. A
developer clones it and has `laqi mcp` configured in their agent (VS Code
`.vscode/mcp.json` in the same repo can even add the server). The agent, following a
README, calls the tool; laqi executes `scripts/setup.ts` with the developer's
permissions. The config comment says the list is "a file MCP cannot write", which is
true and beside the point: the attacker wrote it before the clone. This is the
`.vscode/tasks.json` / `.envrc` / `postinstall` class of problem, and every tool in
that class ended up with an out-of-repo trust decision (VS Code Workspace Trust,
direnv `allow`, mise `trust`, pnpm `onlyBuiltDependencies` plus `approve-builds`).

**Designed behaviour.**

1. A listed module **must not** execute for an agent unless the trust store holds an
   entry whose `path` equals the module's resolved real path, whose `exportName` and
   `side` match, and whose `sha256` equals the sha256 of the file's current bytes. The
   check runs on every call, not at startup: a `git pull` that changes the file must
   revoke it without a restart, and a `laqi trust` in another terminal must take effect
   without one.
2. The trust store lives at `join(XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'laqi', 'trusted-modules.json')`.
   It is written atomically (temp file + rename), with directory mode `0700` and file
   mode `0600`. The store **must** be ignored (treated as empty, with one stderr line
   saying why) when any of these hold:
   - its real path is inside the project root's real path;
   - on POSIX, its owner uid is not `process.getuid()` or its mode has any group/other bit set;
   - it is not valid JSON, has no `modules` array, or `version !== 1`.
     There is **no** laqi-specific environment variable or config key that relocates it.
3. Trust **must** be keyed by `{ path, exportName, side }` and compared on `sha256`.
   Re-trusting replaces the older record for the same key. The record also carries
   `project` (the root's real path) and `approvedAt`, for display and for `--revoke`.
4. `laqi trust` (new verb in `apps/cli/src/index.ts`):
   - reads the project config, resolves every entry of `mcp.modules` with
     `resolveSourcePath`, digests each file, and prints each entry with its state:
     `approved`, `not approved`, `changed since approved`, `unusable: <error>`;
   - **must** refuse to approve unless `process.stdin.isTTY && process.stdout.isTTY`,
     exit code 5, with the message "approving code is a decision for a person, not for
     a pipe or a script". There is **no** `--yes`, and `CI` or any env var **must not**
     auto-approve (mise's `yes = true` bypass, CVE-2026-35533);
   - asks one `[y/N]` question per module to approve, after printing its resolved path
     and sha256 prefix, and records each `y`;
   - `laqi trust --status` prints the table and exits 0 without asking;
   - `laqi trust --revoke` removes every record whose `project` is this root, no prompt.
5. `laqi mcp` **must** print on stderr at startup one line per listed module with its
   state, and the sentence "agents may only run modules you approved on this machine
   with `laqi trust`" when any entry is not approved. Printing host/`schemaSources.root`
   at startup belongs to NIW2-309/NIW2-315.
6. Refusals from `generate_from_module` **must** be specific and actionable:
   - unlisted: today's text (add the entry to `mcp.modules`) plus "then run `laqi trust`";
   - listed, not approved: "`src/types.ts` is listed in laqi.config.json but nobody on
     this machine has approved running it. Ask the person to run `laqi trust` in `<root>`.";
   - changed: "`src/types.ts` changed since it was approved; ask the person to run
     `laqi trust` again";
   - unusable: the resolution error (outside the source root, missing file).
     The refusal **must not** include the sha256 of the current file (it would let an agent
     coach the person into approving a specific content without looking).
7. Defence in depth, independent of NIW2-315: an `mcp.modules` entry whose `file` is
   absolute, has a Windows drive or UNC prefix, or contains a `..` segment is `unusable`
   and never resolved. Panel requests are already confined by `resolveSourcePath`.
8. The panel path (F1) **must not** read or write the trust store. The two approvals
   mean different things, as the comment at `packages/mcp/src/server.ts:57-61` already says.

**Interfaces** (_illustrative_):

```ts
// packages/core/src/module-trust.ts
export type TrustedModule = {
  path: string          // resolved real path
  exportName: string
  side: 'input' | 'output'
  sha256: string
  project: string       // real path of the project root at approval time
  approvedAt: string    // ISO 8601
}

export type TrustFile = { version: 1; modules: TrustedModule[] }

export function defaultTrustFile(env?: NodeJS.ProcessEnv): string

export class ModuleTrustStore {
  constructor(file?: string, guard?: { projectRoot: string; uid?: number })
  /** Empty when the file is missing, malformed, inside the project, or not private. `reason` says which. */
  read(): { modules: TrustedModule[]; reason?: string }
  has(entry: Omit<TrustedModule, 'project' | 'approvedAt'>): boolean
  add(entries: TrustedModule[]): void
  revokeProject(project: string): number
}

export type AgentModuleStatus =
  | { state: 'trusted'; request: ModuleRequest; path: string; sha256: string }
  | { state: 'untrusted'; request: ModuleRequest; path: string; sha256: string }
  | { state: 'changed'; request: ModuleRequest; path: string; sha256: string }
  | { state: 'unusable'; request: ModuleRequest; error: string }

export class AgentModulePolicy {
  constructor(root: string, config: LaqiConfig, store: ModuleTrustStore)
  listed(): AgentModuleStatus[]
  decide(request: ModuleRequest): { ok: true; path: string; sha256: string } | { ok: false; state: 'unlisted' | 'untrusted' | 'changed' | 'unusable'; error: string }
}
```

```json
// ~/.config/laqi/trusted-modules.json — illustrative
{
  "version": 1,
  "modules": [
    {
      "path": "/home/me/shop/src/types/api.ts",
      "exportName": "Invoice",
      "side": "output",
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "project": "/home/me/shop",
      "approvedAt": "2026-10-12T09:30:00.000Z"
    }
  ]
}
```

**Migration.** Breaking for every project that already relies on `mcp.modules`: after
upgrading, `laqi mcp` refuses those modules until each developer runs `laqi trust`
once per machine, and again whenever the file changes. The refusal text and the
startup line say exactly that. Changelog: breaking. No change to `laqi.config.json`'s
shape. CI pipelines that run `laqi mcp` non-interactively cannot approve modules — by
design; a CI job has no person.

**Tests.**

| Test (file)                                                                                                         | Input                                                                                                | Expected                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `module-trust.test.ts` — "trusts nothing without a file"                                                            | fresh temp dir                                                                                       | `has(entry) === false`                                                                 |
| "remembers an approval bound to the exact bytes"                                                                    | `add([entry])`; `has(entry)`, `has({ ...entry, sha256: other })`, `has({ ...entry, side: 'input' })` | true, false, false                                                                     |
| "replaces an older approval of the same module"                                                                     | `add([e1])`, `add([{ ...e1, sha256: other }])`                                                       | file holds one record; `has(e1) === false`                                             |
| "is private to its owner"                                                                                           | `add([entry])`                                                                                       | `statSync(file).mode & 0o077 === 0`; directory mode `& 0o077 === 0` (skipped on win32) |
| "fails closed on a corrupt file"                                                                                    | write `{ not json`                                                                                   | `read()` → `[]`, `reason` set                                                          |
| "ignores a store inside the project root"                                                                           | `XDG_CONFIG_HOME = join(root, '.laqi-trust')` pre-populated with a valid record                      | `has(entry) === false`, `reason` mentions the project                                  |
| "ignores a store readable by others"                                                                                | chmod `0644` after write (POSIX only)                                                                | `has(entry) === false`                                                                 |
| "resolves the default path from XDG_CONFIG_HOME, else ~/.config"                                                    | `defaultTrustFile({ XDG_CONFIG_HOME: '/x' })`, `defaultTrustFile({})`                                | `/x/laqi/trusted-modules.json`, `<home>/.config/laqi/trusted-modules.json`             |
| `module-permission.test.ts` / policy — "allows nothing a person on this machine has not approved, even when listed" | config lists `types.ts`; empty store                                                                 | `decide()` → `{ ok: false, state: 'untrusted' }`; message contains `laqi trust`        |
| "stops allowing an approved module once the file changes"                                                           | approve, then rewrite `types.ts`                                                                     | `{ ok: false, state: 'changed' }`                                                      |
| "allows exactly what is listed and approved, on all three fields"                                                   | approved `types.ts#Invoice/output`; ask `Other`, ask `input`                                         | ok / not ok / not ok                                                                   |
| "marks absolute, drive-letter, UNC and .. entries unusable without resolving them"                                  | entries `/etc/x.ts`, `C:\x.ts`, `\\srv\x.ts`, `../x.ts`                                              | all `unusable`; a spy on `resolveSourcePath` is not called                             |
| "refusals never contain the file's hash"                                                                            | untrusted and changed states                                                                         | error text does not match `/[0-9a-f]{64}/`                                             |
| `trust.test.ts` (cli) — "refuses to approve without a terminal"                                                     | `runTrust({ input: notTTY })`                                                                        | exit 5; store untouched                                                                |
| "approves only the modules answered y"                                                                              | two listed modules, scripted TTY answers `y`, `n`                                                    | store holds the first only                                                             |
| "--status never asks and never writes"                                                                              | `--status` on a non-TTY                                                                              | exit 0; store mtime unchanged                                                          |
| "--revoke removes this project's records only"                                                                      | store with two projects                                                                              | one record left, other project's                                                       |
| `stdio.test.ts` — "refuses a listed module nobody approved on this machine and says what to ask for"                | config lists; `XDG_CONFIG_HOME` = empty temp dir                                                     | `isError`, text contains `laqi trust` and the project path                             |
| "refuses an approved module after the file changed"                                                                 | approve via `ModuleTrustStore.add` in the test, rewrite file                                         | `isError`, text contains `changed`                                                     |
| "takes a new approval without restarting the server"                                                                | call → refused; `add` to store; call again                                                           | second call `isError: false`                                                           |
| "prints the module trust status at startup on stderr"                                                               | spawn `laqi mcp` with one listed, unapproved module                                                  | stderr contains the file name and `laqi trust`                                         |

### F4. The child process inherits the full environment, buffers output without limit, kills only itself, and parses its verdict with `lastIndexOf`

**Current behaviour (main).** `packages/generate/src/load-module.ts`:

- `:112-115` — `spawn(process.execPath, ['-e', CHILD], { env: { ...process.env, LAQI_MODULE_REQUEST } })`.
- `:137-142` — `out += chunk`, `err += chunk`, no cap. The audit reproduced a parent
  `RangeError: Out of memory` from a module writing 1 MB chunks for 9 s (generate S6).
- `:128-135` — `child.kill('SIGKILL')` on the 10 s timeout; grandchildren survive.
- `:176-184` — `readResult` finds the verdict with `out.lastIndexOf('{"ok":')`; a
  document whose `default` or `examples` contains `{"ok":` makes the parse fail and the
  user sees "ended with exit code 0 and said nothing" (generate Q1, reproduced).
- `:38-93` — the child program; `:46` imports the path it was given with no check that
  the bytes are the ones that were digested at `prepare`/`trust` time.

Unchanged since the audit; the audit's line numbers (`:75-78`, `:100-105`, `:139-147`)
are from the older branch.

**Threat.** The module, or any dependency it transitively imports, reads `process.env`
and exfiltrates `AWS_*`, `NPM_TOKEN`, `GITHUB_TOKEN`; nothing in "generate a mock body"
suggests that exposure. A chatty import takes the mock server down. A file swapped
between the digest check and the `import()` executes unapproved bytes (core S3 names
the window).

**Designed behaviour.**

1. The child's environment **must** be built from an allowlist, copied by
   case-insensitive name on win32 and exact name elsewhere:
   `PATH`, `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `SYSTEMROOT`, `WINDIR`,
   `COMSPEC`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`,
   `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `NO_COLOR`, `FORCE_COLOR`,
   plus laqi's own `LAQI_MODULE_REQUEST`. Everything else is dropped, including every
   `npm_*`, `*_TOKEN`, `*_KEY`, `*_SECRET`. The list is a named constant with a test
   that spawns a module which prints `Object.keys(process.env)`.
   `NODE_OPTIONS` is kept on purpose: it is the user's own runtime configuration and
   dropping it would make the child behave differently from the parent on Node
   versions that need `--experimental-strip-types`.
2. The verdict **must** travel on file descriptor 3 (`stdio: ['ignore', 'pipe', 'pipe', 'pipe']`),
   written once by `say()`, and the parent **must** parse the whole fd-3 buffer as one
   JSON value. stdout and stderr are captured only for error messages: each is capped
   at 64 KiB, and bytes past the cap are discarded (the module keeps running; a logging
   import is ordinary). The verdict buffer is capped at 8 MiB; past it the child is
   killed and the result is `{ ok: false, code: 'too-large' }`. `ModuleLoadFailure` gains
   `'too-large'`, and `import-schema.ts` maps it to a diagnostic.
   The implementer **must** verify fd 3 piping under Bun as well as Node, because the
   test suite runs on Bun and `process.execPath` is then `bun` (unverified in this
   session; Bun documents `node:child_process` compatibility). If Bun cannot pipe fd 3,
   the fallback is a 32-byte random nonce passed in the environment and used as a
   line delimiter around the verdict on stdout, with the verdict still exempt from the
   64 KiB cap — but one mechanism, decided by a test, not both at runtime.
3. The `ModuleLoadRequest` **must** carry `expectedSha256`. The child reads the file
   bytes, hashes them, and refuses with `{ ok: false, code: 'changed' }` if they differ,
   **before** `import()`. The residual window between that read and the import is
   accepted and documented: closing it would require importing from a copy, which
   breaks the module's relative imports. `ModuleLoadFailure` gains `'changed'`.
4. On POSIX the child is spawned `detached: true` and the timeout kills the process
   group (`process.kill(-child.pid, 'SIGKILL')`); on win32 `child.kill()` as today,
   with a comment that grandchildren may survive there. Best effort either way.
5. The child program **must not** change what it reads from the module: the
   `~standard.jsonSchema[side]` discovery stays as it is.
6. `loadModuleSchema` is the only place in the repository that spawns `process.execPath`;
   the existing `spawns use fixed argv, no shell` property is unchanged.

**Interfaces** (_illustrative_):

```ts
// packages/generate/src/load-module.ts
export const MODULE_LOAD_TIMEOUT_MS = 10_000
export const MODULE_NOISE_CAP_BYTES = 64 * 1024
export const MODULE_VERDICT_CAP_BYTES = 8 * 1024 * 1024
export const MODULE_CHILD_ENV = [ 'PATH', 'HOME', /* ... */ ] as const

export type ModuleLoadRequest = {
  resolvedPath: string
  exportName: string
  side: 'input' | 'output'
  expectedSha256: string
}

export type ModuleLoadFailure =
  | 'not-found' | 'capability' | 'conversion' | 'crashed' | 'timeout'
  | 'changed' | 'too-large'
```

**Migration.** None visible to users. A module that depended on an inherited variable
(`DATABASE_URL` read at import time) now sees it undefined; that module was never a
good schema source, and the error message it throws is reported as `crashed` with
the module's own stderr, as today.

**Tests** (`packages/generate/src/load-module.test.ts`).

| Test                                                                                                                                              | Input                                                                                                                      | Expected                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| "hands the module an allowlisted environment and nothing else"                                                                                    | parent env has `AWS_SECRET_ACCESS_KEY=x`, `npm_config_registry=y`; module converts to `{ keys: Object.keys(process.env) }` | result document's keys ⊆ `MODULE_CHILD_ENV ∪ { LAQI_MODULE_REQUEST }`, contain `PATH`, not `AWS_*`/`npm_*`    |
| "reads the verdict even when the document contains {\"ok\":"                                                                                      | export whose schema has `default: { ok: true }`                                                                            | `{ ok: true }`, document round-trips                                                                          |
| "reads the verdict even when the module floods stdout"                                                                                            | module writes 1 MiB × 20 to stdout at import, then converts                                                                | `{ ok: true }`; parent RSS growth < 32 MiB (measure `process.memoryUsage().rss` before/after, generous bound) |
| "keeps the last 64 KiB of stderr for the error message"                                                                                           | module throws after writing 1 MiB to stderr                                                                                | `code: 'crashed'`, `error.length <= 65536 + slack`                                                            |
| "refuses a verdict over 8 MiB"                                                                                                                    | module converts to a document with a 9 MiB string                                                                          | `{ ok: false, code: 'too-large' }`, child not alive afterwards                                                |
| "refuses to import a file whose bytes changed after it was digested"                                                                              | `expectedSha256` of old content; file rewritten before load                                                                | `{ ok: false, code: 'changed' }`; marker file the module would write on import is absent                      |
| "kills the module's own children on timeout" (POSIX only)                                                                                         | module spawns `sleep 60` then never settles                                                                                | `code: 'timeout'`; `sleep` pid not alive after the call                                                       |
| existing: Zod/ArkType conversion, side selection, not-found, capability, conversion error, throws on import, never finishes, prints on its way in | unchanged                                                                                                                  | unchanged                                                                                                     |
| `import-schema.test.ts` — "maps changed and too-large to diagnostics"                                                                             | stubbed loader results                                                                                                     | `ImportError` with `diagnostics[0].code` set, message names the file                                          |

### F5. Tokens from `Math.random`, pending map unbounded

Covered by F1 items 1, 5, 6 and 7 (core S4, core P5, mcp SC3). `module-permission.ts:81-83`
and `:54`/`:91` on main are the lines.

## Who is "the human", per surface

| Surface                     | Requester                            | Where the person is                 | Mechanism in this spec                                                       |
| --------------------------- | ------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------- |
| Panel over local HTTP       | the panel's JS, or any local process | at the terminal that started `laqi` | approval code printed on stdout, typed into the panel (F1)                   |
| `laqi mcp` over stdio       | the agent, via its host              | at a terminal, not necessarily now  | `laqi trust`, once per machine and per file content (F3)                     |
| Terminal                    | the person                           | right there                         | `laqi trust` is interactive and TTY-only (F3.4)                              |
| MCP host's own confirmation | the host, from annotations           | in the host's UI                    | honest annotations on a dedicated tool (F2); not relied on, per the MCP spec |
| MCP elicitation             | the host, on laqi's request          | in the host's UI                    | deferred (open question 2)                                                   |
| Public listener (`--share`) | the internet                         | nowhere                             | not mounted; unchanged                                                       |

## Alternatives considered and rejected

**A per-session panel secret in the served HTML, required as a custom header on
`confirm`.** Strongest argument for it: it is what the audits suggested, it needs no
terminal, and with NIW2-309's CSP it defeats every cross-origin and clickjacking
path. Rejected as the gate because any local process can `GET /__laqi` and read the
secret: it proves the request came from code that read the panel, not that a person
decided. It is a good CSRF control and NIW2-309 may add it for the whole control plane;
it is not approval.

**A `y/N` prompt on laqi's stdin.** Strongest argument: no code to copy. Rejected
for this ticket because `laqi start` frequently does not own a TTY (turbo, concurrently,
npm scripts, a terminal multiplexer pane that is not focused), the server would need a
raw-mode stdin reader living next to the HTTP server, and a prompt that scrolls away
under request logs is easy to answer by accident. Kept as the accelerator in open
question 1.

**Drop `readOnlyHint` from `generate_data` instead of adding a tool.** Strongest
argument: smallest diff, no new tool to document. Rejected because the common path —
pasted TypeScript, JSON Schema documents, regenerate-from-response — is read-only and
would start prompting in every host that honours the hint, which is the behaviour
that makes agents stop using the tool.

**Hash the config's `mcp.modules` array (audit suggestion) instead of each module's
content.** Strongest argument: one approval per project, not per file. Rejected
because the thing that executes is the module, and a hostile commit can change
`src/types.ts` without touching the config. direnv and mise both hash the file that
runs. Cost accepted: every edit to a listed module needs `laqi trust` again; the
refusal says so and the command takes seconds.

**Key trust by path only, like VS Code Workspace Trust.** Strongest argument: no
re-approval after every edit. Rejected: VS Code trusts a folder once because it
cannot enumerate what runs; laqi knows exactly which file runs and can bind to it.

**Trust store relocatable by a laqi env var (`LAQI_TRUST_FILE`).** Strongest argument:
tests and unusual setups. Rejected: an MCP client config inside the repository sets
the server's environment, so the variable would hand the repository the store. Tests
use `XDG_CONFIG_HOME` pointed outside the project, which the structural checks allow.

**MCP elicitation as the approval for agents.** Strongest argument: it is the
protocol's own human-in-the-loop primitive, supported by VS Code and others, and it
keeps the person in the host UI they are already using. Rejected for now:
(1) laqi cannot distinguish a person's `accept` from a client that auto-accepts or
from a model-generated answer in a client that gets it wrong; (2) the spec says
servers MUST NOT elicit sensitive information, and "run this code" is at least as
sensitive; (3) support is uneven, so `laqi trust` is needed anyway. Reopen when a
major host documents elicitation as always presented to the user and never to the
model.

**`node --permission` for the child.** Strongest argument: a real capability boundary
for free on Node ≥ 22.13 / 23.5 (stable). Rejected for this ticket: (1) the parent may
be Bun (`bunx laqi`), which has no permission model as of mid-2026 (secondary sources;
unverified against Bun's docs), so the boundary would exist only sometimes and users
would not know which; (2) `--allow-fs-read` follows symlinks outside the granted paths
(documented limitation) and a correct allowlist must include every package store the
module's imports resolve through; (3) the module needs `--allow-child-process` and
network for many real schema libraries' imports, at which point the sandbox grants
most of what matters. The gate stays "who may ask". Reopen condition in the ADR.

**Importing from a temp copy or `data:` URL to close the TOCTOU window.** Strongest
argument: the executed bytes are exactly the digested bytes. Rejected: relative
imports (`./enums`) resolve against the module's own location and would break; the
in-child digest check before `import()` leaves a window of one syscall and needs a
local attacker who already has code execution through the project's own scripts.

**Kill the child when stdout exceeds the cap (audit suggestion).** Rejected in favour
of discarding: a library that logs on import is common and killing it turns "noisy"
into "broken"; the cap already bounds memory.

## Cross-ticket dependencies and file boundaries

| File / area                                                                           | This ticket                                                                                                                       | Other ticket                                                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/core/src/module-permission.ts`, `module-trust.ts` (new), tests              | owns                                                                                                                              | —                                                                             |
| `packages/core/src/writer.ts` (`resolveSourcePath`)                                   | reads only; expects `path` to stay the resolved target                                                                            | NIW2-313 (return real path, symlinks)                                         |
| `packages/server/src/control-plane-app.ts`                                            | the two module routes, their schemas, `ControlPlaneRuntime.prepareModule/confirmModule` types only                                | NIW2-309 owns the rest (origin guard at `:285-305`, headers, SSE)             |
| `apps/cli/src/serve.ts`                                                               | `showModuleApproval`, the `prepareModule`/`confirmModule` wiring at `:393-427`                                                    | NIW2-309 owns reload/exit lifecycle and tunnel                                |
| `apps/cli/src/index.ts`                                                               | adds the `trust` verb, `USAGE` line, and the `laqi mcp` startup status line                                                       | NIW2-309 (serve/exit codes), NIW2-315 (`loadConfig` fail-closed)              |
| `apps/cli/src/module-trust.ts` (new), `apps/cli/src/trust.test.ts`                    | owns                                                                                                                              | —                                                                             |
| `packages/generate/src/load-module.ts`, `import-schema.ts` (`codeFor`, request shape) | owns                                                                                                                              | NIW2-311 owns everything else in `@laqi/generate`                             |
| `packages/mcp/src/server.ts`                                                          | `generate_data`'s module refusal and annotation; the new `generate_from_module`; `instructions` line; `approvals` wiring at `:62` | NIW2-314 owns all other annotations, output caps, prompt-injection delimiting |
| `packages/schema/src/config.ts`                                                       | no change                                                                                                                         | NIW2-315 (path grammar; this spec's F3.7 is the defence-in-depth twin)        |
| `packages/editor/src/App.tsx`, `api.ts`, `components/CreateEndpointRow.tsx`           | the module flow only (code input, retry on loss, lockout message)                                                                 | NIW2-316 owns the rest of the editor                                          |
| `packages/tui`                                                                        | uses `row`/`paint`; uses the sanitiser NIW2-316 adds                                                                              | NIW2-316                                                                      |
| `apps/documentation/.../design/json-schema-adapters.md`                               | replaces "Executing project code" with a pointer to this spec                                                                     | —                                                                             |
| `apps/documentation/.../product/ai-briefing.md`                                       | the "Executing project code is gated" paragraph, the tool table                                                                   | NIW2-314 may touch other paragraphs; coordinate on the same PR or rebase      |
| `CHANGELOG.md`                                                                        | two breaking notes (F2, F3)                                                                                                       | NIW2-312 owns release mechanics                                               |

Order of landing against other tickets: this ticket does not block on any of them.
NIW2-315's path grammar makes F3.7 redundant but harmless. NIW2-309's origin tightening
and NIW2-316's sanitiser should land before or with step 1 below; if they land after,
step 1 strips control characters locally and that line is deleted later.

## Rollout, in small steps

Each step is one PR with its tests green on its own; no step depends on a later one.

1. **Core and panel approval code** (F1, F5). `module-permission.ts`: CSPRNG token and
   code, `confirm(token, code)`, lockout, pending cap, retry token. `control-plane-app.ts`
   request schemas and responses. `serve.ts` presenter. Panel input. Update
   `serve.schema.test.ts` and `module-permission.test.ts`. Changelog: panel now asks for
   the code printed in the terminal.
2. **Child hardening** (F4). `load-module.ts`: env allowlist, fd 3 verdict, caps,
   group kill, `expectedSha256`. `import-schema.ts` passes the digest it already has
   from `resolveSourcePath` + a read (or receives it from the caller). New tests. No
   user-visible change.
3. **Trust store and `laqi trust`** (F3). `module-trust.ts` in core, `AgentModulePolicy`,
   the CLI verb, startup status on stderr, refusal texts. `stdio.test.ts` additions.
   Changelog: breaking for `mcp.modules` users.
4. **MCP tool split** (F2). `generate_from_module`, `generate_data` refusal,
   annotations, `instructions`, docs updates that `documented-tools.test.ts` and
   `tool-descriptions.test.ts` enforce. Changelog: breaking for agents.
5. **Docs**: mark the adapters spec section superseded; accept the ADR; link this spec
   from `design/index.md`.

Steps 3 and 4 can be swapped; 1 and 2 can run in parallel with them.

## Unverified claims

- That a Bun parent can pipe fd 3 to a child (F4.2). Decided by a test in step 2.
- That any current MCP host auto-approves on `readOnlyHint` (F2). The design does not
  depend on it: the hint is made honest either way.
- Bun's lack of a permission model (D8): secondary sources only.
- The git-checkout mode argument for D4 (a repository cannot ship a `0600` file): true
  for git, which stores only the executable bit; not re-verified for other VCSs.
- Node 20/22 importing `.ts` from the child without a flag: out of scope, noted above.

## References

- laqi audits: `workspace-temp/audits/{server,mcp,cli,schema,core,generate,security-scan}.md` and `SUMMARY.md` item 2 (not in the repo).
- [JSON Schema adapters — design spec](/design/json-schema-adapters/), "Executing project code".
- [ADR-0006 — MCP server as a first-class piece](/decisions/0006-mcp-server/); [ADR-0004 — Active state is not tracked](/decisions/0004-state-outside-git/) (the trust store is likewise outside git, and additionally outside the project).
- General knowledge hub: [ADR pattern](https://github.com/csdev19/general-knowledge/blob/main/conventions/adr-pattern.md), [design workflow](https://github.com/csdev19/general-knowledge/blob/main/conventions/design-workflow.md); the "lifecycle guards must be applied everywhere" rule in [security hardening](https://github.com/csdev19/general-knowledge/blob/main/architecture/security-hardening.md) is the same idea as F1.10 (the plain import route must refuse what the gated route gates).
- MCP specification 2025-06-18, [Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools): "clients MUST consider tool annotations to be untrusted unless they come from trusted servers"; "there SHOULD always be a human in the loop with the ability to deny tool invocations". [Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation): client capability, three actions, "Servers MUST NOT use elicitation to request sensitive information".
- Secondary, on how hosts use annotations: [Stacklok on tool annotations as risk vocabulary](https://stacklok.com/blog/tool-annotations-are-becoming-the-risk-vocabulary-for-agentic-systems-that-matters-more-than-it-might-seem/); [Codex CLI and readOnlyHint](https://codex.danielvaughan.com/2026/05/27/codex-cli-mcp-readonlyhint-concurrent-tool-execution-annotations-parallelism/); [Claude Code feature request on read-only MCP auto-approval](https://github.com/anthropics/claude-code/issues/25966).
- [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust): Restricted Mode, trust stored outside the folder, "can't prevent a malicious extension from executing code"; [VS Code agents trust and safety](https://code.visualstudio.com/docs/agents/concepts/trust-and-safety.md): `.vscode/mcp.json` inherits Workspace Trust.
- [direnv(1)](https://direnv.net/man/direnv.1.html): `direnv allow`/`deny`, allow list under `$XDG_DATA_HOME/direnv/allow`; a changed `.envrc` must be allowed again (content-bound; the hash details are from direnv's source and were not re-verified here).
- [mise paranoid mode](https://mise.jdx.dev/paranoid) and [`mise trust`](https://mise.jdx.dev/cli/trust.html): per-content trust, re-trust on edit; [CVE-2026-35533](https://www.wiz.io/vulnerability-database/cve/cve-2026-35533): project config relocating trust settings and `yes`/`ci` auto-approval bypass — the reason for D4 and for `laqi trust` having no `--yes`.
- [pnpm build settings](https://pnpm.io/settings/build): lifecycle scripts off by default since pnpm 10, `onlyBuiltDependencies` / `approve-builds` as the allowlist.
- [Node.js Permission Model](https://nodejs.org/api/permissions.html): stable since 22.13 / 23.5; `--allow-fs-read` symlink limitation; what `--permission` restricts.
- [Node.js TypeScript support](https://nodejs.org/api/typescript.md): type stripping on by default from 22.18 / 23.6 (secondary confirmation in the search results).
- Bun permission model status, secondary: [safeguard.sh runtime comparison](https://www.safeguard.sh/resources/blog/nodejs-deno-bun-security-model-comparison).
