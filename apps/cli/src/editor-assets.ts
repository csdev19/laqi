import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono, type Context } from 'hono'

/**
 * Where the panel build ended up. Two cases, in this order:
 *
 * 1. **Packaged** (`npx laqi`): the panel travels as `panel/` next to the
 *    bundle. `@laqi/editor` isn't published, so resolving it through the
 *    module system would fail — it's looked for here first.
 * 2. **Monorepo** (running from source): resolved via
 *    `@laqi/editor/package.json` through the module resolver, which
 *    doesn't depend on where this file lives.
 */
export function editorDistDir(baseDir = dirname(fileURLToPath(import.meta.url))): string | null {
  const packaged = join(baseDir, 'panel')
  if (existsSync(join(packaged, 'index.html'))) return packaged

  try {
    const require = createRequire(import.meta.url)
    return join(dirname(require.resolve('@laqi/editor/package.json')), 'dist')
  } catch {
    return null
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function contentType(path: string): string {
  const dot = path.lastIndexOf('.')
  return (dot === -1 ? undefined : CONTENT_TYPES[path.slice(dot)]) ?? 'application/octet-stream'
}

/**
 * Serves the built panel. Mounted BEFORE the control plane, because the
 * control plane ends in a catch-all that would swallow these routes.
 *
 * If there's no build (nobody ran `bun run build`), returns a page that
 * says so instead of a silent 404 — it's the most likely error for a
 * contributor to hit.
 */
export function createEditorApp(distDir: string | null = editorDistDir()): Hono {
  const app = new Hono()

  const serveFile = (c: Context, relativePath: string) => {
    if (!distDir || !existsSync(join(distDir, 'index.html'))) {
      return c.html(missingBuildPage(), 503)
    }

    // The path comes from the URL: without this, /__laqi/assets/../../../etc/passwd
    // would escape dist/. `normalize` collapses the `..`s, and then we verify
    // the result still lands inside the root.
    const root = resolve(distDir)
    const target = resolve(root, normalize(relativePath).replace(/^(\.\.[/\\])+/, ''))
    if (target !== root && !target.startsWith(root + sep)) {
      return c.text('not found', 404)
    }

    if (!existsSync(target) || !statSync(target).isFile()) {
      return c.text('not found', 404)
    }

    return c.body(readFileSync(target), 200, { 'Content-Type': contentType(target) })
  }

  const index = (c: Context) => serveFile(c, 'index.html')

  app.get('/__laqi', index)
  app.get('/__laqi/', index)
  app.get('/__laqi/assets/*', (c) => {
    const path = new URL(c.req.url).pathname.slice('/__laqi/'.length)

    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      // A stray `%` or `%zz`: bots and link scanners produce these all
      // the time. It's a 404, not a 500 with a stack trace.
      return c.text('not found', 404)
    }

    return serveFile(c, decoded)
  })
  app.get('/__laqi/favicon.svg', (c) => serveFile(c, 'favicon.svg'))

  return app
}

function missingBuildPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>laqi</title>
<style>body{background:#0B0A0F;color:#EAE7F2;font:14px/1.6 Georgia,serif;padding:40px;max-width:640px}
code{font-family:ui-monospace,Menlo,monospace;color:#00FFC2}</style></head><body>
<h1>The laqi panel is not built yet</h1>
<p>The control plane API is running, but <code>packages/editor/dist</code> does not exist.
Build it once with:</p>
<p><code>bun run build --filter=@laqi/editor</code></p>
<p>The mock server itself is unaffected and is serving your mocks normally.</p>
</body></html>`
}
