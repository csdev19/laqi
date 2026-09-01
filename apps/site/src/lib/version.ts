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
