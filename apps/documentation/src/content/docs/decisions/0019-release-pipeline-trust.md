---
title: ADR-0019 — What the release pipeline trusts
---

# ADR-0019 — What the release pipeline trusts

**Status:** Proposed
**Date:** 2026-10-12
**Spec:** [Supply-chain hardening](/design/supply-chain-hardening/) (NIW2-312)
**Supersedes:** the "Tokens" section and the validation-skip paragraph of the addendum in [ADR-0010](/decisions/0010-release-and-npm/). The version topology, the dist-tag rule and the two-workflow split of ADR-0010 stand.

## Context

ADR-0010 built the release path: release-please cuts a tag, a tag-triggered workflow publishes with provenance. It left three trust decisions implicit, and the audit found all three wanting (verified on 2026-10-12 through the owner's account):

- The publish job authenticates with a long-lived `NPM_TOKEN`, a bearer capability that publishes `laqi@latest` to every team that runs `npx laqi`, held in an environment with no protection rules.
- Every action is addressed by a movable tag, while the jobs hold the npm token, a Cloudflare API token and a PAT with write on contents and pull requests.
- `main` has no protection, no ruleset guards `v*` tags, the default `GITHUB_TOKEN` permission is `write`, and a release is published after a build with no lint, type-check or tests on the tagged commit. Release PRs skip validation by branch name.

Other teams will run what this pipeline publishes. The question is not "is the pipeline convenient" but "what, exactly, does it trust, and is each of those things earned".

## Decision

The pipeline trusts **this repository's workflow files at a reviewed commit, verified on the same SHA, run by GitHub-hosted runners**, and nothing else.

1. **Publishing identity is the workflow, not a secret.** npm Trusted Publishing binds the right to publish `laqi` to `csdev19/laqi`, workflow file `release-npm.yml`, environment `production`. The job runs on Node 24 (npm ≥ 11.5.1) and sets no `NODE_AUTH_TOKEN`. Once the first OIDC publish succeeds, the package disallows tokens and the granular token is revoked.
2. **Actions are immutable references.** Every `uses:` is a full commit SHA with a version comment; the repository setting requires it; Dependabot moves them.
3. **Publishing is gated on the tagged SHA.** `release-npm.yml` and `deploy-site.yml` have a `verify` job (`bun run verify`, `bun run audit`, pack-and-install smoke) that the publishing job `needs:`. This is the hub's rule R1 applied; a tag is a trigger, not a certificate.
4. **The release PR is validated.** `validate.yml` runs on `release-please--*` branches; `Validate` is a required status check on `main`. A skipped job cannot be required, and a branch name is choosable by anyone with push.
5. **The repository enforces the path.** Ruleset on `main` (pull request required, `Validate` required, no force push, no deletion, no bypass); ruleset on `v*` and `site-v*` tags (creation, update and deletion restricted to repository admins, which is what lets release-please's PAT cut tags); `production` environment restricted to those tags plus `main` for dry runs, with a required reviewer; `RELEASE_PLEASE_TOKEN` in its own `release-please` environment restricted to `main`; default workflow token read-only; Dependabot alerts, secret scanning and push protection on.

## Alternatives rejected

**Keep `NPM_TOKEN`, rotate it, require 2FA.** The proven path with no cut-over risk. Rejected: rotation shortens exposure but a token at rest is still a publish capability that a compromised action or a leaked log can use; OIDC removes the object entirely and ties publishing to a reviewed workflow file. The cut-over is ordered so a working path exists at every step (spec, checklist B).

**Tag pinning with Dependabot "security updates" for actions.** Simpler to read. Rejected: GitHub's own guidance says a full-length SHA is the only immutable reference; a moved tag runs with `id-token: write`.

**Skip validation on release PRs, use a cheap gate job (hub `pr-checks` pattern).** Saves a run per merge to `main`. Rejected: the release PR is the last point before a tag exists, and the hub's normative release-gated-verification page names it the candidate tier that runs `verify`. The playbook's step 6 predates that page. Minutes on a public repository are the price.

**No required reviewer on `production`.** One click fewer per release; keeps "merging the release PR is the act of releasing" literally true. Kept as an option for the owner (spec open question 2). Rejected as the default because it is the only control that stops a stolen PAT from publishing unattended: the PAT can cut a tag (admin bypass on the tag ruleset is required for release-please), the tag triggers the publish, and without a reviewer nothing human stands between them.

**Download the verified artifact into the publish job.** Publishes the bytes that were verified. Rejected for now: same SHA, same lockfile, same Bun version; the hub asks for verification on the same SHA. Reopen if a build proves non-deterministic.

**Self-hosted or third-party runners.** Not considered: npm trusted publishing supports GitHub-hosted runners only.

## Consequences

**Good.** No publish secret exists to steal. Each action's code is fixed until a reviewed PR moves it. A release is published only after the full `verify` and an audit of the tarball on the tagged commit. Tag creation and merges to `main` go through the pipeline or not at all. The one remaining long-lived credential (`RELEASE_PLEASE_TOKEN`) can cut a tag but cannot publish without a human approval.

**Costs.** One approval click per release and per site deploy. One extra `Validate` run per merge to `main` (the release PR updates). Two environments instead of one. Dependabot opens weekly PRs that must be merged for the pins not to rot. The first OIDC publish cannot be rehearsed end to end; the recovery procedure is written down in the spec. The PAT still expires and will one day fail a tag cut (ADR-0010's cost, now halved).

## Non-goals

- Verifying provenance on the consumer side, SLSA levels beyond what npm records, Sigstore policy.
- Signed commits on `main` (a ruleset option; not required here because the pipeline trusts reviewed workflow files at a SHA, not authorship).
- Replacing the PAT for release-please with a GitHub App installation token. It would remove the last long-lived credential; deferred because the app's installation itself is a standing capability and the environment restriction already bounds the PAT.

## Reopen condition

- npm or GitHub changes the trusted-publishing contract (workflow-filename binding, environment binding, runner restriction) in a way that the checklist no longer satisfies.
- The owner finds the `production` approval click unacceptable in practice: drop the reviewer, keep the tag ruleset and the deployment policy, and record the trade in this ADR's status line.
- A second maintainer joins: the `main` ruleset should then require one approval, and the tag ruleset's bypass list should name people rather than a role.
- A build on the same SHA produces different bytes: switch the publish job to downloading `verify`'s artifact.
