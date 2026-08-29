// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// The landing page lives at `/`, hand-built in src/pages/index.astro,
// entirely outside Starlight's own routing. Docs need to land at
// `/docs/*` without moving the landing page too — Astro's global `base`
// option would move everything, so instead every docs file sits one
// folder deeper than Starlight's default (src/content/docs/docs/... —
// Starlight routes a file at the path relative to src/content/docs/,
// so a file at docs/installation.md gets the slug "docs/installation"
// and therefore the route /docs/installation/).
export default defineConfig({
  // Astro's built-in <Code> component (used on the landing page's Quick
  // Start snippets) only bundles the theme(s) named here — anything else
  // fails at build time with "Theme X is not included in this bundle".
  markdown: {
    shikiConfig: { theme: 'vitesse-dark' },
  },
  integrations: [
    starlight({
      title: 'laqi',
      description: 'Mock any API, flip any response, in one click.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        es: { label: 'Español', lang: 'es' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/csdev19/laqi' }],
      customCss: ['./src/styles/global.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ slug: 'docs' }, { slug: 'docs/installation' }],
        },
        {
          label: 'Concepts',
          items: [{ slug: 'docs/concepts/resolution-layers' }],
        },
      ],
    }),
  ],
})
