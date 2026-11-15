export default defineNuxtConfig({
  compatibilityDate: '2025-03-01',
  devtools: { enabled: false },
  ssr: true,
  modules: ['@nuxtjs/tailwindcss'],
  css: ['@olydor/ui/theme.css'],
  build: {
    transpile: ['@olydor/ui', '@olydor/engine'],
  },
  vite: {
    optimizeDeps: {
      include: ['lucide-vue-next'],
    },
  },
  runtimeConfig: {
    public: {
      webUrl: process.env.NUXT_PUBLIC_WEB_URL || 'https://olydor.app',
      insightUrl: process.env.NUXT_PUBLIC_INSIGHT_URL || process.env.NUXT_PUBLIC_SIM_URL || 'https://insight.olydor.app',
      arenaUrl: process.env.NUXT_PUBLIC_ARENA_URL || 'https://arena.olydor.app',
      apiUrl:
        process.env.NUXT_PUBLIC_API_URL ||
        process.env.NUXT_PUBLIC_API_BASE_URL ||
        'https://api.olydor.app',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr', class: 'dark' },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      title: 'Olydor Arena — Duel 1v1 vs Pythia IA 3-Ply (Coming Soon)',
      meta: [
        { name: 'theme-color', content: '#0c0f16' },
        {
          name: 'description',
          content:
            'Arène tactique 1v1 Olydor (Coming Soon) : affrontez Pythia, notre IA 3-Ply Lookahead Pokémon TCG avec Win Probability en direct et Blunder Analysis.',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'canonical', href: 'https://arena.olydor.app/' },
      ],
    },
  },
})
