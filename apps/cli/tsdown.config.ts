import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const here = dirname(fileURLToPath(import.meta.url))
const editorDist = join(here, '..', '..', 'packages', 'editor', 'dist')

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: false,
  // Los paquetes del workspace se meten en el bundle: se publica UN paquete,
  // no seis. Las dependencias reales de npm quedan afuera y se instalan.
  //
  // El SDK de MCP también entra al bundle, y no por gusto: como dependencia
  // instalada arrastra express, jose, ajv y compañía — 91 paquetes y 24 MB
  // en TODA instalación, aunque nunca corras `laqi mcp`. Nosotros sólo
  // usamos el transport de stdio; bundleándolo, el tree-shaking deja fuera
  // el transport HTTP y todo lo que cuelga de él.
  noExternal: [/^@laqi\//, '@modelcontextprotocol/sdk'],
  shims: true,
  hooks: {
    'build:done': () => {
      // El panel viaja adentro del paquete publicado. Sin esto, `npx laqi`
      // serviría la página de "no está construido" para siempre, porque
      // packages/editor no se publica por separado.
      if (!existsSync(join(editorDist, 'index.html'))) {
        throw new Error(
          'packages/editor/dist is missing — run `bun run build --filter=@laqi/editor` first.\n' +
            'The published CLI carries the panel inside it; shipping without it would serve the "not built yet" page forever.',
        )
      }
      const target = join(here, 'dist', 'panel')
      mkdirSync(target, { recursive: true })
      cpSync(editorDist, target, { recursive: true })
      // README y LICENSE viajan DENTRO del paquete publicado. La licencia
      // no es opcional: MIT exige que el aviso de copyright esté en toda
      // copia del software, y sin esto el tarball no llevaba ninguno.
      copyFileSync(join(here, '..', '..', 'README.md'), join(here, 'README.md'))
      copyFileSync(join(here, '..', '..', 'LICENSE.md'), join(here, 'LICENSE.md'))
    },
  },
})
