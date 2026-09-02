import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// Every failure that blocked the 2.0.0 launch lived in this layer, not in
// the product: a deploy job that could not see its own secrets, a formatter
// gating a generated file, tag globs that had to stay disjoint for the site
// and the package to ship independently. None of it was covered, because
// "the workflow is right" was only ever checked by pushing and watching.
// These are the invariants; a red test here is cheaper than a red release.

const DIR = '.github/workflows'

interface Job {
  environment?: unknown
  steps?: { run?: string; with?: Record<string, unknown>; env?: Record<string, unknown> }[]
  [key: string]: unknown
}
interface Workflow {
  on?: Record<string, unknown>
  jobs?: Record<string, Job>
}

const workflows = new Map<string, Workflow>(
  readdirSync(DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => [f, parse(readFileSync(join(DIR, f), 'utf-8')) as Workflow]),
)

/** Every `secrets.NAME` a job mentions, wherever it mentions it. */
function secretsUsedBy(job: Job): string[] {
  return [...JSON.stringify(job).matchAll(/secrets\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1] ?? '')
}

/** GitHub's tag globs only need `*` here. */
function globMatches(glob: string, ref: string): boolean {
  const source = `^${glob.split('*').map(escapeRegExp).join('.*')}$`
  return new RegExp(source).test(ref)
}
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tagTriggersOf(workflow: Workflow): string[] {
  const push = workflow.on?.push as { tags?: string[] } | undefined
  return push?.tags ?? []
}

describe('workflow secrets', () => {
  it('found workflows to check', () => {
    expect(workflows.size).toBeGreaterThan(3)
  })

  // The first deploy from main failed with wrangler's missing-token error
  // while the secret existed the whole time: it lives in the `production`
  // environment, and a job sees an environment's secrets only when it
  // declares that environment. Nothing surfaces that but a failed run.
  it('declares an environment in every job that reads one', () => {
    const offenders: string[] = []
    for (const [file, workflow] of workflows) {
      for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
        const secrets = secretsUsedBy(job).filter((s) => s !== 'GITHUB_TOKEN')
        if (secrets.length > 0 && job.environment === undefined) {
          offenders.push(`${file} → job "${name}" reads ${secrets.join(', ')} with no environment`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('release topology', () => {
  const deploySite = workflows.get('deploy-site.yml')
  const releaseNpm = workflows.get('release-npm.yml')

  it('has both release workflows', () => {
    expect(deploySite).toBeDefined()
    expect(releaseNpm).toBeDefined()
  })

  // Shipping the site must never publish the package, and vice versa. The
  // two globs are the whole of that guarantee.
  it('keeps the site and package tag triggers disjoint', () => {
    const siteTags = tagTriggersOf(deploySite as Workflow)
    const npmTags = tagTriggersOf(releaseNpm as Workflow)
    expect(siteTags.length).toBeGreaterThan(0)
    expect(npmTags.length).toBeGreaterThan(0)

    const siteRelease = 'site-v1.2.3'
    const packageRelease = 'v1.2.3'
    expect(siteTags.some((g) => globMatches(g, siteRelease))).toBe(true)
    expect(npmTags.some((g) => globMatches(g, packageRelease))).toBe(true)
    // The one that actually bites: `v*` must not swallow `site-v*`.
    expect(npmTags.some((g) => globMatches(g, siteRelease))).toBe(false)
    expect(siteTags.some((g) => globMatches(g, packageRelease))).toBe(false)
  })

  // Ruled during the launch: an ordinary merge to main deploys nothing.
  // The site ships when its release PR is merged, like the package does.
  it('never deploys the site on a push to a branch', () => {
    const push = (deploySite as Workflow).on?.push as { branches?: string[] } | undefined
    expect(push?.branches).toBeUndefined()
  })
})

describe('local verification mirrors CI', () => {
  // The pipeline tests themselves were pushed red because `check-types` was
  // run locally and `check-types:scripts` — a separate, stricter config —
  // was not. Anything CI runs has to be reachable from one local command,
  // or the next person discovers the gap the same way: from a red run.
  it('runs every root script that validate.yml runs', () => {
    const validate = readFileSync(join(DIR, 'validate.yml'), 'utf-8')
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      scripts: Record<string, string>
    }
    const verify = pkg.scripts.verify
    expect(verify, 'package.json needs a "verify" script').toBeDefined()

    const inCi = new Set([...validate.matchAll(/bun run ([\w:-]+)/g)].map((m) => m[1] ?? ''))
    const missing = [...inCi].filter((script) => !(verify ?? '').includes(script))
    expect(
      missing,
      `validate.yml runs these but \`bun run verify\` does not: ${missing.join(', ')}`,
    ).toEqual([])
  })
})

describe('generated files', () => {
  // release-please rewrites the changelogs wholesale on every release and
  // never consults our formatter. Format-gating them turned each release
  // into a red build across the whole repo.
  it('keeps changelogs out of the formatter', () => {
    const ignored = readFileSync('.prettierignore', 'utf-8')
    expect(ignored).toMatch(/CHANGELOG\.md/)
  })
})
