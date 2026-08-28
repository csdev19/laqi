import { createRequire } from 'node:module'
import { detectLevel, type Level } from '@laqi/tui'

declare const __LAQI_VERSION__: string | undefined

/**
 * tsdown replaces `__LAQI_VERSION__` at build time. Running from source it is
 * undefined, so fall back to package.json — which sits one level above this
 * module from source and one level above the bundle in the published tarball,
 * so the same relative path works in both.
 */
export function laqiVersion(): string {
  if (typeof __LAQI_VERSION__ === 'string') return __LAQI_VERSION__
  const require = createRequire(import.meta.url)
  return (require('../package.json') as { version: string }).version
}

/** Decided once. stdout, because that is where the screens go. */
export function outputLevel(): Level {
  return detectLevel(process.env, process.stdout.isTTY === true)
}
