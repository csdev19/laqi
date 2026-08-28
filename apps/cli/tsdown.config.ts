import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const here = dirname(fileURLToPath(import.meta.url))
const editorDist = join(here, '..', '..', 'packages', 'editor', 'dist')

const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: false,
  // The banner reports how fast startup was; reading package.json from disk to
  // print the version would be measuring the measurement.
  define: { __LAQI_VERSION__: JSON.stringify(pkg.version) },
  // The workspace packages get folded into the bundle: what gets published
  // is ONE package, not six. The real npm dependencies stay out and get
  // installed normally.
  //
  // The MCP SDK is bundled too, and not for free: as an installed dependency
  // it drags in express, jose, ajv and friends — 91 packages and 24 MB on
  // EVERY install, even if you never run `laqi mcp`. We only use the stdio
  // transport; bundling it lets tree-shaking drop the HTTP transport and
  // everything hanging off it.
  //
  // `@clack/prompts` (the `laqi init` wizard) is bundled for the same
  // reason, except here there is nothing for tree-shaking to drop — the
  // whole prompt engine runs whenever someone runs `init` on a TTY.
  // `@clack/core` is listed separately because `prompt.ts` imports its
  // classes directly (`TextPrompt`, `SelectPrompt`, `ConfirmPrompt`) so it
  // can draw its own `render()`; `@clack/prompts` doesn't expose that, only
  // helpers with a fixed view. `sisteransi`, `fast-string-width` and
  // `fast-wrap-ansi` are that engine's own dependencies — without bundling
  // them too, they'd sit as unresolved `import`s in the published bundle,
  // since neither one appears in the package's `dependencies`.
  noExternal: [
    /^@laqi\//,
    '@modelcontextprotocol/sdk',
    /^@clack\//,
    'sisteransi',
    'fast-string-width',
    'fast-wrap-ansi',
  ],
  shims: true,
  hooks: {
    'build:done': () => {
      // The panel ships inside the published package. Without this, `npx laqi`
      // would serve the "not built yet" page forever, because packages/editor
      // isn't published on its own.
      if (!existsSync(join(editorDist, 'index.html'))) {
        throw new Error(
          'packages/editor/dist is missing — run `bun run build --filter=@laqi/editor` first.\n' +
            'The published CLI carries the panel inside it; shipping without it would serve the "not built yet" page forever.',
        )
      }
      const target = join(here, 'dist', 'panel')
      mkdirSync(target, { recursive: true })
      cpSync(editorDist, target, { recursive: true })
      // README and LICENSE ship INSIDE the published package. The licence
      // isn't optional: MIT requires the copyright notice in every copy of
      // the software, and without this the tarball carried none.
      copyFileSync(join(here, '..', '..', 'README.md'), join(here, 'README.md'))
      copyFileSync(join(here, '..', '..', 'LICENSE.md'), join(here, 'LICENSE.md'))
    },
  },
})
