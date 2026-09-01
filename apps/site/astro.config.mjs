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
//
// A single root locale on purpose: public surfaces are English-only, and
// one locale means Starlight renders no language selector — a selector
// with one entry would promise i18n the product does not offer.
//
// The sidebar follows the reader's journey — see a response change first,
// then learn the workflow, then bring a real contract — not the product's
// internal architecture. Resolution layers sits after the panel because
// the concept matters once you have already watched a response change.
export default defineConfig({
  site: 'https://laqi.dev',
  integrations: [
    starlight({
      title: 'laqi',
      description: 'Your backend isn’t ready. Your frontend can be.',
      logo: {
        dark: './src/assets/icon.svg',
        light: './src/assets/icon-light.svg',
      },
      // Starlight emits og:title/og:description per page; the shared
      // card image, mobile icons, and manifest are ours to declare.
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://laqi.dev/og-image.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://laqi.dev/og-image.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/site.webmanifest' } },
      ],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/csdev19/laqi' }],
      customCss: ['./src/styles/global.css'],
      sidebar: [
        {
          label: 'Getting started',
          items: [{ slug: 'docs/quick-start' }, { slug: 'docs/installation' }],
        },
        {
          label: 'Core workflow',
          items: [{ slug: 'docs/panel' }, { slug: 'docs/concepts/resolution-layers' }],
        },
        {
          label: 'Bring your own contract',
          items: [{ slug: 'docs/mock-files' }, { slug: 'docs/data-generators' }],
        },
        {
          label: 'AI agents',
          items: [{ slug: 'docs/ai-agents' }],
        },
      ],
    }),
  ],
})
