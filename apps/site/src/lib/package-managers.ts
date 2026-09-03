export type PackageManagerId = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type PackageManager = {
  id: PackageManagerId
  /** How the manager writes its own name in its docs. */
  name: string
  /** Install the binary globally. */
  global: string
  /** Run it once without installing. */
  runner: string
  /** Pin it per-project so a team shares one version. */
  dev: string
  /** A caveat that is true for this manager and no other. */
  note?: string
}

/**
 * Every command here was run before it was written down. The matrix with the
 * versions and the output is in the design doc `package-manager-matrix.md`.
 * laqi is a plain npm package, so all four work; the site simply did not
 * say so.
 *
 * The `@2` pin is on every line deliberately: bare `laqi` can still resolve
 * to the 2022 v1.
 */
export const PACKAGE_MANAGERS: readonly PackageManager[] = [
  {
    id: 'npm',
    name: 'npm',
    global: 'npm i -g laqi@2',
    runner: 'npx laqi@2',
    dev: 'npm i -D laqi@2',
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    global: 'pnpm add -g laqi@2',
    runner: 'pnpm dlx laqi@2',
    dev: 'pnpm add -D laqi@2',
  },
  {
    id: 'yarn',
    name: 'yarn',
    global: 'yarn global add laqi@2',
    runner: 'yarn dlx laqi@2',
    dev: 'yarn add -D laqi@2',
    // The only manager that needs an asterisk. Yarn 2 removed `global`;
    // `dlx` is the path on 2+. Verified on 1.22.22 and 4.18.0.
    note: 'yarn global add works on Yarn 1. On Yarn 2 and later, use yarn dlx or add it to a project.',
  },
  {
    id: 'bun',
    name: 'bun',
    global: 'bun add -g laqi@2',
    runner: 'bunx laqi@2',
    // -d, not -D. bun is the one that differs, and copying npm's flag
    // across is the obvious mistake.
    dev: 'bun add -d laqi@2',
  },
]

export const DEFAULT_MANAGER: PackageManagerId = 'npm'

/** The stored preference is user-writable, so it is validated, not trusted. */
export function isPackageManagerId(value: unknown): value is PackageManagerId {
  return PACKAGE_MANAGERS.some((manager) => manager.id === value)
}
