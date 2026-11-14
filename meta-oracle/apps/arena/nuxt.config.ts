export default defineNuxtConfig({
  compatibilityDate: '2025-03-01',
  devtools: { enabled: false },
  ssr: true,
  modules: ['@nuxtjs/tailwindcss'],
  css: ['@meta-oracle/ui/theme.css'],
  build: {
    transpile: ['@meta-oracle/ui', '@meta-oracle/engine', 'lucide-vue-next'],
  },
  runtimeConfig: {
    public: {
      webUrl: process.env.NUXT_PUBLIC_WEB_URL || 'https://meta-oracle.com',
      simUrl: process.env.NUXT_PUBLIC_SIM_URL || 'https://sim.meta-oracle.com',
      arenaUrl: process.env.NUXT_PUBLIC_ARENA_URL || 'https://arena.meta-oracle.com',
      apiUrl:
        process.env.NUXT_PUBLIC_API_URL ||
        process.env.NUXT_PUBLIC_API_BASE_URL ||
        'https://api.meta-oracle.com',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr', class: 'dark' },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      title: 'Meta Oracle Arena — Duel 1v1 vs Pythia IA 3-Ply (Coming Soon)',
      meta: [
        { name: 'theme-color', content: '#0c0f16' },
        {
          name: 'description',
          content:
            'Arène tactique 1v1 Meta Oracle (Coming Soon) : affrontez Pythia, notre IA 3-Ply Lookahead Pokémon TCG avec Win Probability en direct et Blunder Analysis.',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'canonical', href: 'https://arena.meta-oracle.com/' },
      ],
    },
  },
})
