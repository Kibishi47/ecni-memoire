const isProd = process.env.NODE_ENV === 'production'

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
      webUrl:
        process.env.NUXT_PUBLIC_WEB_URL ||
        (isProd ? 'https://olydor.app' : 'http://localhost:3001'),
      insightUrl:
        process.env.NUXT_PUBLIC_INSIGHT_URL ||
        process.env.NUXT_PUBLIC_SIM_URL ||
        (isProd ? 'https://insight.olydor.app' : 'http://localhost:3002'),
      arenaUrl:
        process.env.NUXT_PUBLIC_ARENA_URL ||
        (isProd ? 'https://arena.olydor.app' : 'http://localhost:3003'),
      apiUrl:
        process.env.NUXT_PUBLIC_API_URL ||
        process.env.NUXT_PUBLIC_API_BASE_URL ||
        (isProd ? 'https://api.olydor.app' : 'http://localhost:3000'),
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
      script: [
        {
          innerHTML:
            "try{if(localStorage.getItem('olydor-theme')==='light'){var r=document.documentElement;r.classList.remove('dark');r.classList.add('light');r.setAttribute('data-theme','light');}}catch(e){}",
        },
      ],
    },
  },
})
