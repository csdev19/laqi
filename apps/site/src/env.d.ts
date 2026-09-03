// Astro's own types come from `astro/tsconfigs/*` via tsconfig.json — no
// triple-slash reference here, which oxlint bans.

declare global {
  interface Window {
    /**
     * Set by the blocking inline head script in `src/lib/pm-script.mjs`,
     * before the body paints. Optional: the toggle buttons must not throw
     * on a page that somehow rendered without it.
     */
    __laqiSetPm?: (id: string) => void
  }
}

export {}
