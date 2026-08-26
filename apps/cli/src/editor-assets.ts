import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono, type Context } from 'hono'

/**
 * Dónde quedó el build del panel. Dos casos, en este orden:
 *
 * 1. **Empaquetado** (`npx laqi`): el panel viaja como `panel/` al lado del
 *    bundle. `@laqi/editor` no se publica, así que resolverlo por módulo
 *    fallaría — se busca primero acá.
 * 2. **Monorepo** (corriendo desde el fuente): se resuelve
 *    `@laqi/editor/package.json` por el resolver de módulos, que no depende
 *    de dónde esté este archivo.
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
 * Sirve el panel construido. Se monta ANTES del control plane, porque el
 * control plane termina en un catch-all que se comería estas rutas.
 *
 * Si no hay build (nadie corrió `bun run build`), devuelve una página que lo
 * dice en vez de un 404 mudo — es el error más probable de un contribuidor.
 */
export function createEditorApp(distDir: string | null = editorDistDir()): Hono {
  const app = new Hono()

  const serveFile = (c: Context, relativePath: string) => {
    if (!distDir || !existsSync(join(distDir, 'index.html'))) {
      return c.html(missingBuildPage(), 503)
    }

    // El path llega de la URL: sin esto, /__laqi/assets/../../../etc/passwd
    // saldría de dist/. `normalize` colapsa los `..` y después se verifica
    // que el resultado siga adentro de la raíz.
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
      // `%` suelto o `%zz`: los bots y los escáneres de links los producen
      // todo el tiempo. Es un 404, no un 500 con stack.
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
