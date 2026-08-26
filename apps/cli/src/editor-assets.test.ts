import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEditorApp, editorDistDir } from './editor-assets'

let dist: string

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'laqi-editor-'))
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>')
  writeFileSync(join(dist, 'assets', 'index-abc.js'), 'console.log(1)')
  writeFileSync(join(dist, 'assets', 'index-abc.css'), 'body{}')
})

afterEach(() => {
  rmSync(dist, { recursive: true, force: true })
})

describe('createEditorApp', () => {
  it('serves index.html at the mount point, with and without the trailing slash', async () => {
    const app = createEditorApp(dist)

    for (const path of ['/__laqi', '/__laqi/']) {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/html')
      expect(await res.text()).toContain('id="root"')
    }
  })

  it('serves assets with the right content type', async () => {
    const app = createEditorApp(dist)

    const js = await app.request('/__laqi/assets/index-abc.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('Content-Type')).toContain('text/javascript')

    const css = await app.request('/__laqi/assets/index-abc.css')
    expect(css.headers.get('Content-Type')).toContain('text/css')
  })

  it('404s an asset that does not exist', async () => {
    const app = createEditorApp(dist)
    expect((await app.request('/__laqi/assets/nope.js')).status).toBe(404)
  })

  it('refuses to walk out of the dist directory', async () => {
    // El secreto vive fuera de dist/, que es exactamente lo que un traversal
    // busca alcanzar.
    const secret = join(dist, '..', 'laqi-secret.txt')
    writeFileSync(secret, 'SECRET')

    const app = createEditorApp(dist)
    for (const attempt of [
      '/__laqi/assets/../../laqi-secret.txt',
      '/__laqi/assets/..%2f..%2flaqi-secret.txt',
      '/__laqi/assets/....//....//laqi-secret.txt',
    ]) {
      const res = await app.request(attempt)
      expect(res.status).not.toBe(200)
      expect(await res.text()).not.toContain('SECRET')
    }

    rmSync(secret, { force: true })
  })

  it('explains itself instead of 404ing when the panel was never built', async () => {
    const app = createEditorApp(join(dist, 'does-not-exist'))
    const res = await app.request('/__laqi')

    expect(res.status).toBe(503)
    expect(await res.text()).toContain('not built yet')
  })

  it('does not claim a route outside its own prefix', async () => {
    const app = createEditorApp(dist)
    expect((await app.request('/users')).status).toBe(404)
    expect((await app.request('/__laqi/api/endpoints')).status).toBe(404)
  })
})

describe('editorDistDir', () => {
  it('resolves the built panel through the module resolver', () => {
    const dir = editorDistDir()
    expect(dir).toBeTruthy()
    expect(dir).toContain(join('packages', 'editor', 'dist'))
  })
})

describe('editorDistDir — packaged layout', () => {
  // Antes este test hacía `existsSync(editorDistDir()/index.html)`, lo que
  // exigía que el panel estuviera CONSTRUIDO: en un clone fresco (bun
  // install && bun run test, o sea CI) la suite salía roja con el árbol
  // sano. La regla se verifica inyectando el directorio base.
  it('prefers a panel/ directory next to the bundle when one is there', () => {
    const bundleDir = join(dist, 'fake-bundle')
    mkdirSync(join(bundleDir, 'panel'), { recursive: true })
    writeFileSync(join(bundleDir, 'panel', 'index.html'), '<!doctype html>')

    expect(editorDistDir(bundleDir)).toBe(join(bundleDir, 'panel'))
  })

  it('ignores a panel/ directory that has no index.html', () => {
    const bundleDir = join(dist, 'empty-bundle')
    mkdirSync(join(bundleDir, 'panel'), { recursive: true })

    expect(editorDistDir(bundleDir)).not.toBe(join(bundleDir, 'panel'))
  })

  it('falls back to the monorepo package when there is no bundled panel', () => {
    // Sin comprobar que exista: en un clone fresco todavía no está.
    const dir = editorDistDir(join(dist, 'nothing-here'))
    expect(dir).toContain(join('packages', 'editor', 'dist'))
  })
})

describe('malformed percent escapes', () => {
  it('404s instead of throwing a 500 with a stack', async () => {
    const app = createEditorApp(dist)
    for (const path of ['/__laqi/assets/%', '/__laqi/assets/%zz', '/__laqi/assets/a%2']) {
      expect((await app.request(path)).status, path).toBe(404)
    }
  })
})
