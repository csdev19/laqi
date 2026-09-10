/**
 * One import in a process that has loaded nothing yet, so the cost of
 * loading the TypeScript compiler is counted where a developer pays it.
 *
 * Prints one number — milliseconds — and nothing else, because its caller
 * parses stdout.
 */
import { EXAMPLE_MODELS } from '@laqi/generate/examples'

const [, , id, allowLoss] = process.argv
const model = EXAMPLE_MODELS.find((candidate) => candidate.id === id)
if (model === undefined) {
  process.stderr.write(`no example model ${JSON.stringify(id)}\n`)
  process.exit(1)
}

const started = performance.now()
const { importSchema } = await import('@laqi/generate')
await importSchema(
  { kind: 'typescript-paste', source: model.source, typeName: model.typeName },
  { allowLoss: allowLoss === 'true' },
)
process.stdout.write(String(Math.round(performance.now() - started)))
