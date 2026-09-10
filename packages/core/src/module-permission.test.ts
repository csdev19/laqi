import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@laqi/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { ModuleApprovals, MODULE_TOKEN_TTL_MS } from './module-permission'

let root: string
let clock: number

const config = (overrides: Record<string, unknown> = {}) =>
  ConfigSchema.parse({ schemaSources: { root: '.' }, ...overrides })

function approvals(overrides: Record<string, unknown> = {}): ModuleApprovals {
  return new ModuleApprovals(root, config(overrides), () => clock)
}

const request = { file: 'types.ts', exportName: 'Invoice', side: 'output' as const }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'laqi-approvals-'))
  clock = 1_000_000
  writeFileSync(join(root, 'types.ts'), 'export const Invoice = {}\n', 'utf8')
})

describe('preparing a load', () => {
  it('resolves the path and digests the file, without running anything', () => {
    const prepared = approvals().prepare(request)

    expect(prepared).toMatchObject({ ok: true })
    if (!prepared.ok) return
    expect(prepared.value.resolvedPath).toBe(join(root, 'types.ts'))
    expect(prepared.value.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.value.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a path outside the source root', () => {
    const store = new ModuleApprovals(root, config({ schemaSources: { root: 'src' } }), () => clock)

    const prepared = store.prepare({ ...request, file: '../types.ts' })

    expect(prepared).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('refuses a symlink that escapes the source root', () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    symlinkSync(join(root, 'types.ts'), join(root, 'src', 'linked.ts'))
    const store = new ModuleApprovals(root, config({ schemaSources: { root: 'src' } }), () => clock)

    expect(store.prepare({ ...request, file: 'linked.ts' })).toMatchObject({ ok: false })
  })

  it('says so when the file does not exist', () => {
    expect(approvals().prepare({ ...request, file: 'nope.ts' })).toMatchObject({
      ok: false,
      code: 'not-found',
    })
  })
})

describe('confirming a load', () => {
  it('redeems a fresh token once', () => {
    const store = approvals()
    const prepared = store.prepare(request)
    if (!prepared.ok) throw new Error(prepared.error)

    const confirmed = store.confirm(prepared.value.token)

    expect(confirmed).toMatchObject({ ok: true })
    if (!confirmed.ok) return
    expect(confirmed.value.resolvedPath).toBe(join(root, 'types.ts'))
  })

  it('refuses the same token a second time', () => {
    const store = approvals()
    const prepared = store.prepare(request)
    if (!prepared.ok) throw new Error(prepared.error)
    store.confirm(prepared.value.token)

    expect(store.confirm(prepared.value.token)).toMatchObject({ ok: false })
  })

  it('refuses a token nobody issued', () => {
    expect(approvals().confirm('a'.repeat(64))).toMatchObject({ ok: false })
  })

  it('refuses a token past its two minutes', () => {
    const store = approvals()
    const prepared = store.prepare(request)
    if (!prepared.ok) throw new Error(prepared.error)

    clock += MODULE_TOKEN_TTL_MS + 1
    const confirmed = store.confirm(prepared.value.token)

    expect(confirmed).toMatchObject({ ok: false })
    if (confirmed.ok) return
    expect(confirmed.error).toContain('expired')
  })

  it('refuses a token whose file changed after it was shown', () => {
    const store = approvals()
    const prepared = store.prepare(request)
    if (!prepared.ok) throw new Error(prepared.error)

    writeFileSync(join(root, 'types.ts'), 'export const Invoice = { changed: true }\n', 'utf8')
    const confirmed = store.confirm(prepared.value.token)

    expect(confirmed).toMatchObject({ ok: false })
    if (confirmed.ok) return
    expect(confirmed.error).toContain('changed')
  })

  // A caller that retried until the file happened to match again would have
  // approval for something nobody looked at.
  it('spends a token even when it refuses it, so a refusal cannot be retried', () => {
    const store = approvals()
    const prepared = store.prepare(request)
    if (!prepared.ok) throw new Error(prepared.error)
    writeFileSync(join(root, 'types.ts'), 'export const Invoice = { changed: true }\n', 'utf8')
    store.confirm(prepared.value.token)

    writeFileSync(join(root, 'types.ts'), 'export const Invoice = {}\n', 'utf8')
    expect(store.confirm(prepared.value.token)).toMatchObject({ ok: false })
  })
})

describe('what an agent may execute', () => {
  it('allows nothing when nothing is listed', () => {
    expect(approvals().allowedForAgents(request)).toBe(false)
  })

  it('allows exactly what is listed, matched on all three fields', () => {
    const store = approvals({
      mcp: { modules: [{ file: 'types.ts', exportName: 'Invoice', side: 'output' }] },
    })

    expect(store.allowedForAgents(request)).toBe(true)
    expect(store.allowedForAgents({ ...request, exportName: 'Other' })).toBe(false)
    expect(store.allowedForAgents({ ...request, side: 'input' })).toBe(false)
    expect(store.allowedForAgents({ ...request, file: 'other.ts' })).toBe(false)
  })

  it('names the config key and the exact entry to add', () => {
    const refusal = approvals().refusalForAgents(request)

    expect(refusal).toContain('mcp.modules')
    expect(refusal).toContain('laqi.config.json')
    expect(refusal).toContain('"exportName": "Invoice"')
  })

  // The panel's approval is a person looking at a file. Handing an agent a
  // way to redeem one would make that approval mean something else.
  it('has no path from the agent list to a panel token', () => {
    const store = approvals({
      mcp: { modules: [{ file: 'types.ts', exportName: 'Invoice', side: 'output' }] },
    })
    const prepared = store.prepare(request)
    if (!prepared.ok) throw new Error(prepared.error)

    // Being listed does not make a token guessable, and confirm accepts
    // nothing else: there is no "confirmed: true" that this store honours.
    expect(store.confirm('confirmed')).toMatchObject({ ok: false })
    expect(store.confirm('true')).toMatchObject({ ok: false })
  })
})

describe('where a source path is resolved from', () => {
  // laqi is routinely pointed at mocks outside the directory it was launched
  // from — this repo's own `bun dev` does it. Resolving against the working
  // directory would make a source path mean something different depending on
  // where the terminal happened to be.
  it('resolves against the project root, not the working directory', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'laqi-elsewhere-'))
    writeFileSync(join(elsewhere, 'types.ts'), 'export const Invoice = {}\n', 'utf8')
    const store = new ModuleApprovals(elsewhere, config(), () => clock)

    const prepared = store.prepare(request)

    expect(prepared).toMatchObject({ ok: true })
    if (!prepared.ok) return
    expect(prepared.value.resolvedPath).toBe(join(elsewhere, 'types.ts'))
    expect(prepared.value.resolvedPath).not.toContain(process.cwd())
  })

  // The mocks area bounds WRITES. A source lives wherever the project puts
  // it, and src/types is the ordinary place.
  it('reaches a source outside the mocks directory, in folder mode', () => {
    mkdirSync(join(root, 'src', 'types'), { recursive: true })
    writeFileSync(join(root, 'src', 'types', 'api.ts'), 'export const Invoice = {}\n', 'utf8')
    const store = new ModuleApprovals(root, config({ dir: 'laqi' }), () => clock)

    expect(store.prepare({ ...request, file: 'src/types/api.ts' })).toMatchObject({ ok: true })
  })

  it('reaches the same source in file mode, where there is no mocks directory at all', () => {
    mkdirSync(join(root, 'src', 'types'), { recursive: true })
    writeFileSync(join(root, 'src', 'types', 'api.ts'), 'export const Invoice = {}\n', 'utf8')
    const store = new ModuleApprovals(root, config({ file: 'laqi.json' }), () => clock)

    expect(store.prepare({ ...request, file: 'src/types/api.ts' })).toMatchObject({ ok: true })
  })

  // An external --dir moves where laqi writes. It must not move where laqi
  // reads: the two boundaries are separate, and confusing them would let a
  // --dir outside the project widen what a source path can reach.
  it('is unaffected by a --dir pointing outside the project', () => {
    const external = mkdtempSync(join(tmpdir(), 'laqi-external-'))
    const store = new ModuleApprovals(root, config({ dir: external }), () => clock)

    expect(store.prepare(request)).toMatchObject({ ok: true })
    expect(store.prepare({ ...request, file: join(external, 'types.ts') })).toMatchObject({
      ok: false,
    })
  })
})
