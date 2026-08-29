// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'laqi',
      lastUpdated: true,
      defaultLocale: 'en',
      locales: {
        root: { label: 'English', lang: 'en' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/csdev19/laqi' }],
      sidebar: [
        {
          label: 'Start',
          items: [{ slug: 'index' }, { slug: 'trying-v2' }, { slug: 'the-name' }],
        },
        {
          label: 'Context',
          items: [{ slug: 'v1-analysis' }, { slug: 'web-editor-prompt' }],
        },
        {
          label: 'Concepts',
          autogenerate: { directory: 'concepts' },
        },
        {
          label: 'Decisions',
          autogenerate: { directory: 'decisions' },
        },
        {
          label: 'Design',
          autogenerate: { directory: 'design' },
        },
        {
          label: 'Plans',
          autogenerate: { directory: 'plans' },
        },
      ],
    }),
  ],
})
