// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'laqi',
      lastUpdated: true,
      defaultLocale: 'es',
      locales: {
        root: { label: 'Español', lang: 'es' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/csdev19/laqi' }],
      sidebar: [
        {
          label: 'Inicio',
          items: [{ slug: 'index' }, { slug: 'probar-v2' }, { slug: 'nombre' }],
        },
        {
          label: 'Contexto',
          items: [{ slug: 'analisis-v1' }, { slug: 'prompt-editor-web' }],
        },
        {
          label: 'Conceptos',
          autogenerate: { directory: 'conceptos' },
        },
        {
          label: 'Decisiones',
          autogenerate: { directory: 'decisiones' },
        },
        {
          label: 'Diseño',
          autogenerate: { directory: 'diseno' },
        },
        {
          label: 'Planes',
          autogenerate: { directory: 'planes' },
        },
      ],
    }),
  ],
})
