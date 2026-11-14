export default defineNuxtConfig({
  compatibilityDate: '2025-03-01',
  devtools: { enabled: false },
  ssr: false,
  modules: ['@nuxtjs/tailwindcss'],
  css: ['@meta-oracle/ui/theme.css'],
  build: {
    transpile: ['@meta-oracle/ui', '@meta-oracle/engine', 'lucide-vue-next'],
  },
  vite: {
    worker: {
      format: 'es',
    },
  },
  runtimeConfig: {
    public: {
      webUrl: process.env.NUXT_PUBLIC_WEB_URL || 'https://meta-oracle.com',
      simUrl: process.env.NUXT_PUBLIC_SIM_URL || 'https://sim.meta-oracle.com',
      arenaUrl: process.env.NUXT_PUBLIC_ARENA_URL || 'https://arena.meta-oracle.com',
      apiUrl: process.env.NUXT_PUBLIC_API_URL || 'https://api.meta-oracle.com',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr', class: 'dark' },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      title: 'Meta Oracle Simulator — Simulateur Monte-Carlo 3-Ply Pokémon TCG',
      meta: [
        { name: 'theme-color', content: '#0c0f16' },
        {
          name: 'description',
          content:
            'Simulateur Monte-Carlo multi-threads 3-ply pour Pokémon TCG : audit de cohérence, 8 KPIs compétitifs, 6 analyses tactiques et atelier comparatif A/B.',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'canonical', href: 'https://sim.meta-oracle.com/' },
      ],
    },
  },
})
