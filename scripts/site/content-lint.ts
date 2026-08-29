// scripts/site/content-lint.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

export type Violation = { file: string; line: number; match: string }

// A plain \b boundary treats a hyphen as a word edge, so \bLaqi\b would
// match the middle segment of X-Laqi-Response — a real, already-shipped
// HTTP header (packages/server/src/control-plane-app.ts), not a casing
// mistake. Requiring the character on either side to be neither a word
// character NOR a hyphen means "Laqi" only matches when it stands alone
// (space/punctuation/line-boundary on both sides), never as one segment
// of a hyphenated identifier.
const BRAND_MISCASING = /(?<![\w-])(Laqi|LAQI)(?![\w-])/g
const FENCE = /^```/

function stripInlineCode(line: string): string {
  // Inline code spans (`...`) are the one place brand casing can be a
  // real identifier (Laqi.Client, a class name) rather than a typo of
  // the product name in prose.
  return line.replace(/`[^`]*`/g, '')
}

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...walk(full))
    } else if (['.md', '.mdx', '.astro'].includes(extname(full))) {
      files.push(full)
    }
  }
  return files
}

export function findBrandCasingViolations(rootDir: string): Violation[] {
  const violations: Violation[] = []
  for (const file of walk(rootDir)) {
    const lines = readFileSync(file, 'utf-8').split('\n')
    let inFence = false
    lines.forEach((rawLine, i) => {
      if (FENCE.test(rawLine)) {
        inFence = !inFence
        return
      }
      if (inFence) return
      const line = stripInlineCode(rawLine)
      const matches = line.match(BRAND_MISCASING)
      if (matches) {
        for (const match of matches) {
          violations.push({ file, line: i + 1, match })
        }
      }
    })
  }
  return violations
}

if (import.meta.main) {
  const target = process.argv[2] ?? 'apps/site/src'
  const violations = findBrandCasingViolations(target)
  if (violations.length > 0) {
    console.error(`Found ${violations.length} brand-casing violation(s):`)
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  "${v.match}" — should be "laqi"`)
    }
    process.exit(1)
  }
  console.log('Content lint: clean.')
}
