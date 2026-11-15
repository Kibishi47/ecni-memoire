export default defineNuxtConfig({
  compatibilityDate: '2025-03-01',
  devtools: { enabled: false },
  ssr: true,
  modules: ['@nuxtjs/tailwindcss'],
  css: ['@olydor/ui/theme.css'],
  build: {
    transpile: ['@olydor/ui'],
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
      apiUrl: process.env.NUXT_PUBLIC_API_URL || 'https://api.olydor.app',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fr', class: 'dark' },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      meta: [
        { name: 'theme-color', content: '#0c0f16' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },
})
