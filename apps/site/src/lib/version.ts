// UNUSED since 2026-10-02. Superseded by the nine-chapter home in
// src/components/home/; nothing under src/pages/ imports it, directly or
// transitively. Kept rather than deleted in the same change that replaced it,
// so the old page can still be read while the new one settles.
//
// Delete on or after 2026-11-02 if it is still unreferenced. Verify first —
// `grep -rl <name> src/` from apps/site — rather than trusting this header.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The version badge in the nav and the install command both need this.
// Reading it from apps/cli/package.json at build time — rather than
// hardcoding it here — means a release never requires touching the site.
const cliPackageJsonUrl = new URL('../../../cli/package.json', import.meta.url)

export function getLaqiVersion(): string {
  const raw = readFileSync(fileURLToPath(cliPackageJsonUrl), 'utf-8')
  const pkg = JSON.parse(raw) as { version: string }
  return pkg.version
}
