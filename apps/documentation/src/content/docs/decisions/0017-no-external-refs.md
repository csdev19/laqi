---
title: ADR-0017 — References never leave the document, and there is no switch
---

# ADR-0017 — References never leave the document, and there is no switch

**Status:** Proposed
**Date:** 2026-10-12
**Ticket:** [NIW2-311](https://linear.app/niway/issue/NIW2-311)
**Spec:** [Generate hardening — design spec](/design/generate-hardening/)
**Implementation:** none yet

## Context

laqi's compiler has always said it: "import, generation and export make no network requests" (`compile-schema.ts:623-630` on main). The code honoured that sentence only where the compiler walked. Two gaps were found and reproduced by the audit (NIW2-302, `generate.md` S1):

- The compiler skips `$defs`, `definitions` and `examples` as annotations, and never compiles `additionalProperties` when `properties` is present. A `$ref` to `http://…`, `file://…` or `../secret.json` in those positions imports cleanly and is stored.
- Every non-TypeScript export goes through quicktype-core on its `FetchingJSONSchemaStore`, which reads `file://`, fetches anything `is-url` accepts, and otherwise reads a local path relative to the process cwd. A stored snapshot reaches export without the compiler at all. Clicking "Export → Python" on a mock file from a cloned repository is enough to make the developer's machine issue the request; the body shows up in the error text.

The question this ADR settles is not whether to close the gap — it is whether laqi should keep any way to follow a reference outside the document. Three code generators faced the same question in 2026 and chose a switch: datamodel-code-generator (`--allow-remote-refs`, CVE-2026-54690: the default warned and fetched anyway), Kiota (CVE-2026-59867: fixed with default-deny and `--allowed-external-origins`), and Orval (CVE-2026-62680: SSRF plus local file read through `../`). OWASP's SSRF guidance is "do not accept complete URLs from the user" and "prefer allow-lists" — and notes SSRF "is not limited to the HTTP protocol".

laqi's situation is narrower than a CLI generator's: the document that would carry the reference is committed to a repository and loaded by everyone who clones it, and the actions that would dereference it (export, `get_types`, `import_openapi`) run without a confirmation step on the panel and from agents. The person who would set a flag is not the person whose machine makes the request.

## Decision

1. **Every schema `$ref` laqi reads is a fragment into the same document** — exactly `#` or `#/…`. Anything else, in any position that holds a schema (`$defs` and `definitions` included), is refused by name at import (`unsupported.keyword`, with the pointer) and at export (`PrintError`, with the pointer). `$dynamicRef` and `$recursiveRef` are held to the same rule. Data positions (`examples`, `default`, `const`, `enum`) are never walked: a `$ref` key in example data is data.
2. **quicktype runs on a store that cannot fetch.** `printDocumentEffect` constructs `JSONSchemaInput` with a `JSONSchemaStore` whose `fetch()` returns `undefined` for every address. `FetchingJSONSchemaStore` is not imported anywhere in `packages/`, and a test asserts that. This holds even for a document that bypassed every other check, and regardless of which positions a future quicktype version dereferences.
3. **There is no opt-in.** No CLI flag, no config key, no allow-list of hosts or directories, no environment variable. A multi-file schema or specification is bundled by the user, with the tool of their choice, before laqi sees it. The refusal message says so.

The two mechanisms are deliberately redundant. The walk gives a named, pointed refusal at the moment a document enters laqi; the store is the guarantee that holds when the walk is wrong, incomplete, or bypassed.

## Alternatives rejected

- **A flag (`--allow-remote-refs`) or config key.** Gives up the property that a cloned repository cannot cause a request. Every generator that shipped one shipped a CVE around its default or its bypass, and the flag would be set by the importer, not by the teammate whose machine later exports.
- **An allow-list of origins or a source-root directory for `file:` refs.** Gives up simplicity for a feature nobody has asked for; still requires DNS-rebinding and redirect handling (OWASP) for the HTTP case, and symlink/`..` confinement for the file case — a second copy of `resolveSourcePath`'s problems, for schema text instead of module code.
- **Resolve external refs at import and inline them, never at export.** Gives up the "no network at import" sentence the compiler already makes; moves the request from export time to import time without removing it.
- **The document walk alone, keeping the fetching store.** Gives up the guarantee: which positions quicktype dereferences is quicktype's traversal, and a guard that depends on a third party's traversal order is not a guard.
- **Prototype: keep the fetching store but strip non-`#` refs from the document before handing it to quicktype.** Gives up honesty: it would silently export a type that says less than the stored document, which the adapters spec's loss policy forbids.

## Consequences

- A document that reaches outside itself is refused once, early, with its pointer, and never silently stored. Already-stored documents of that kind stop exporting and say why.
- laqi takes on no URL parsing, host validation, redirect policy, DNS pinning or path confinement for schema text. The entire control is "is the string `#` or does it start with `#/`".
- Users with multi-file OpenAPI or JSON Schema sources must bundle before importing. This was already true for every position the compiler walked; it is now true for every position.
- Export of a stored snapshot that previously printed `unknown` (TypeScript) or fetched (other targets) for a non-local ref now fails for every target. Open question 3 in the spec offers the softer TypeScript-only `unknown` if the owner prefers it.
- quicktype's own "Could not fetch schema" error can still appear for a document that evaded the walk; it carries no fetched content, because nothing was fetched.

## Non-goals

- Resolving `$id`-based or anchor-based (`#name`) references. laqi never supported them; they are refused as non-local, not implemented.
- A sandbox or egress policy for the laqi process as a whole (the `--share` tunnel, MCP, and the control plane have their own tickets).
- Bundling. laqi does not become a `$ref` resolver.

## Reopen when

A user-facing need to import an unbundled multi-file specification is reported by more than one team **and** a bundling step before import is shown to be impractical for them. The answer then is a bundling step inside laqi that runs only on explicit, interactive user action from the terminal or panel (never from a stored document, never from an agent, never at export), with a file-only resolver confined to `schemaSources.root` — not a network resolver, and not a flag that a document can rely on.
