import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The architecture page drew a package graph by hand and then claimed things
// about it that the manifests disprove: "generate depends on no workspace
// package at all" while it depends on core and schema, and "nothing below the
// CLI reaches sideways" while editor and mcp both import generate. Nothing
// compared the page with the code, so the drawing aged on its own.
//
// The page keeps its edge list in one machine-readable block, introduced by
// the marker below. This test derives the real list from every workspace
// package.json and fails when the two differ, in either direction.

const ROOT = join(import.meta.dirname, '..', '..')
const PAGE = join(ROOT, 'apps/documentation/src/content/docs/architecture/index.md')
const MARKER = '<!-- graph:edges -->'
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

interface Manifest {
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/** `apps/cli` is `cli`, `packages/core` is `core`: the directory names the node. */
function workspaceManifests(): Map<string, Manifest> {
  const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    workspaces: { packages: string[] }
  }
  const manifests = new Map<string, Manifest>()
  for (const pattern of rootManifest.workspaces.packages) {
    const parent = pattern.replace(/\/\*$/, '')
    for (const entry of readdirSync(join(ROOT, parent), { withFileTypes: true })) {
      const manifestPath = join(ROOT, parent, entry.name, 'package.json')
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue
      manifests.set(entry.name, JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
    }
  }
  return manifests
}

function realEdges(manifests: Map<string, Manifest>): string[] {
  const nodeOf = new Map([...manifests].map(([node, manifest]) => [manifest.name, node]))
  const edges = new Set<string>()
  for (const [from, manifest] of manifests) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        const to = nodeOf.get(dependency)
        if (to) edges.add(`${from} -> ${to}`)
      }
    }
  }
  return [...edges].sort()
}

function documentedEdges(): string[] {
  const page = readFileSync(PAGE, 'utf8')
  const start = page.indexOf(MARKER)
  if (start === -1) return []
  const block = /```[^\n]*\n([\s\S]*?)```/.exec(page.slice(start + MARKER.length))
  if (!block) return []
  return (block[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
}

describe('architecture page package graph', () => {
  const manifests = workspaceManifests()
  const real = realEdges(manifests)

  it('reads the workspace it claims to describe', () => {
    expect(real).toContain('cli -> core')
    expect(real).toContain('core -> schema')
  })

  it('lists exactly the workspace dependencies the manifests declare', () => {
    expect(documentedEdges()).toEqual(real)
  })

  it('has no dependency cycle, as the page promises', () => {
    const targets = new Map<string, string[]>()
    for (const edge of real) {
      const [from = '', to = ''] = edge.split(' -> ')
      targets.set(from, [...(targets.get(from) ?? []), to])
    }
    const finished = new Set<string>()
    const visit = (node: string, path: string[]): void => {
      expect(path, `cycle: ${[...path, node].join(' -> ')}`).not.toContain(node)
      if (finished.has(node)) return
      for (const next of targets.get(node) ?? []) visit(next, [...path, node])
      finished.add(node)
    }
    for (const node of manifests.keys()) visit(node, [])
  })
})
