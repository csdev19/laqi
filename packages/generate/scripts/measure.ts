/**
 * The phase-6 measurement for the JSON Schema adapters.
 *
 * Numbers, not opinions: the plan set starting budgets, and this is what
 * decides whether they were the right ones. Run it, paste the table into the
 * plan, and say which machine produced it — an absolute millisecond count
 * means nothing without that, and the useful comparison is between rows.
 *
 *   bun scripts/measure/schema-adapters.ts
 *   bun scripts/measure/schema-adapters.ts --json     (for a diff between runs)
 *
 * Cold and warm are measured separately on purpose. Cold pays for loading
 * the TypeScript compiler, which is 23 MB and the single biggest cost in the
 * whole feature; warm is what a developer actually feels on the second
 * regenerate. Reporting only the average would hide both.
 */
import { fileURLToPath } from 'node:url'
import { EXAMPLE_MODELS } from '@laqi/generate/examples'
import { formatJson } from '@laqi/core'
import {
  capabilities,
  exportTypes,
  importSchema,
  previewBody,
  type SchemaSnapshot,
} from '@laqi/generate'

type Row = {
  fixture: string
  coldImportMs: number
  warmImportMs: number
  generateMs: number
  exportMs: number
  /** The same document re-imported without the TypeScript compiler in the way. */
  jsonSchemaMs: number
  documentBytes: number
  prettyBytes: number
  bodyBytes: number
  /** Whether the strict default refused this fixture, and it had to be acknowledged. */
  neededAllowLoss: boolean
}

/** Wall time for one call, in whole milliseconds. */
async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now()
  const value = await work()
  return { value, ms: Math.round(performance.now() - started) }
}

/**
 * The median of several runs, not the mean: one scheduling hiccup moves a
 * mean and does not move a median, and a benchmark that reports the hiccup
 * is a benchmark nobody can act on.
 */
async function medianMs(runs: number, work: () => Promise<unknown>): Promise<number> {
  const samples: number[] = []
  for (let index = 0; index < runs; index++) {
    samples.push((await timed(work)).ms)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] ?? 0
}

const WARM_RUNS = 5

async function measure(model: (typeof EXAMPLE_MODELS)[number]): Promise<Row> {
  const request = {
    kind: 'typescript-paste' as const,
    source: model.source,
    typeName: model.typeName,
  }

  // Measuring cost, not policing loss: a fixture the strict default refuses
  // still has to be timed, and whether it needed acknowledging is itself
  // worth reporting — it says how often a real model trips the policy.
  const neededAllowLoss = await refusesStrictly(request)
  const options = neededAllowLoss ? { allowLoss: true } : {}

  // Cold is measured in a FRESH PROCESS, not as the first call in this one.
  // Measured in-process it came out the same as warm — because by then the
  // TypeScript compiler was already loaded, so "cold" was measuring nothing.
  const coldImportMs = await coldInChildProcess(model.id, neededAllowLoss)

  const { value: first } = await timed(() => importSchema(request, options))
  const snapshot: SchemaSnapshot = first.snapshot

  const warmImportMs = await medianMs(WARM_RUNS, () => importSchema(request, options))
  const generateMs = await medianMs(WARM_RUNS, () => previewBody(snapshot, { seed: 7 }))
  const exportMs = await medianMs(WARM_RUNS, () => exportTypes(snapshot))

  // The same schema, re-imported as a JSON Schema document. It skips the
  // TypeScript compiler entirely, which is the point of the comparison: what
  // is left is laqi's own normalize-and-compile cost.
  const jsonSchemaMs = await medianMs(WARM_RUNS, () =>
    importSchema({ kind: 'json-schema', document: snapshot.document, name: snapshot.name }),
  )

  const preview = await previewBody(snapshot, { seed: 7 })
  const minified = JSON.stringify(snapshot.document)
  const pretty = formatJson(snapshot.document)

  return {
    fixture: model.id,
    coldImportMs,
    warmImportMs,
    generateMs,
    exportMs,
    jsonSchemaMs,
    documentBytes: Buffer.byteLength(minified, 'utf8'),
    prettyBytes: Buffer.byteLength(pretty, 'utf8'),
    bodyBytes: Buffer.byteLength(JSON.stringify(preview.body), 'utf8'),
    neededAllowLoss,
  }
}

/**
 * One import, in a process that has loaded nothing yet.
 *
 * This is the number a developer feels the first time they paste a model:
 * it pays for `typescript`, which is 23 MB and the single biggest cost in
 * the feature. Measuring it as "the first call in a long-running benchmark"
 * measures a compiler that is already in memory.
 */
async function coldInChildProcess(id: string, allowLoss: boolean): Promise<number> {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL('./measure-cold.ts', import.meta.url)),
      id,
      String(allowLoss),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const out = await new Response(child.stdout).text()
  await child.exited
  const ms = Number(out.trim())
  return Number.isFinite(ms) ? ms : -1
}

/** Whether the strict default turns this source away. */
async function refusesStrictly(request: Parameters<typeof importSchema>[0]): Promise<boolean> {
  try {
    await importSchema(request)
    return false
  } catch {
    return true
  }
}

function table(rows: Row[]): string {
  const header =
    '| fixture | strict | cold import | warm import (TS) | warm import (JSON Schema) | generate | export | document (min) | document (pretty) | body |'
  const rule = '| --- | :-: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  const lines = rows.map(
    (row) =>
      `| ${row.fixture} | ${row.neededAllowLoss ? 'refused' : 'clean'} | ${row.coldImportMs} ms | ` +
      `${row.warmImportMs} ms | ${row.jsonSchemaMs} ms | ${row.generateMs} ms | ${row.exportMs} ms | ` +
      `${row.documentBytes} B | ${row.prettyBytes} B | ${row.bodyBytes} B |`,
  )
  return [header, rule, ...lines].join('\n')
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json')
  const rows: Row[] = []
  for (const model of EXAMPLE_MODELS) {
    rows.push(await measure(model))
  }

  const listed = await capabilities()
  // After the work, so it counts what the run actually retained rather than
  // a floor nothing has touched yet.
  const peakMb = Math.round(process.memoryUsage().rss / (1024 * 1024))

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ rows, peakMb, capabilities: listed }, null, 2)}\n`)
    return
  }

  process.stdout.write(`${table(rows)}\n\n`)
  process.stdout.write(`peak RSS: ${peakMb} MB\n`)
  process.stdout.write(`runtime: ${process.version} on ${process.platform}/${process.arch}\n`)
  process.stdout.write(`inputs: ${listed.inputs.join(', ')}\n`)
  process.stdout.write(`export targets: ${listed.exports.targets.length}\n`)
}

await main()
