import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BETA_FEEDBACK_FORM_URL, OLYDOR_SVG, setOlydorLanguage } from '@olydor/ui'
import { useWebI18n } from '../utils/i18n'

const WEB_ROOT = resolve(__dirname, '..')

afterEach(() => {
  setOlydorLanguage('fr')
})

describe('@olydor/web hub & SEO configuration', () => {
  it('uses the exact official SVG for public/favicon.svg', () => {
    const favicon = readFileSync(resolve(WEB_ROOT, 'public/favicon.svg'), 'utf8').trim()
    expect(favicon).toBe(OLYDOR_SVG)
  })

  it('provides valid robots.txt and sitemap.xml covering all hub & legal routes', () => {
    const robots = readFileSync(resolve(WEB_ROOT, 'public/robots.txt'), 'utf8')
    const sitemap = readFileSync(resolve(WEB_ROOT, 'public/sitemap.xml'), 'utf8')

    expect(robots).toContain('Allow: /')
    expect(robots).toContain('Sitemap: https://olydor.app/sitemap.xml')
    expect(sitemap).toContain('<loc>https://olydor.app/</loc>')
    expect(sitemap).toContain('<loc>https://olydor.app/mentions-legales</loc>')
    expect(sitemap).toContain('<loc>https://olydor.app/confidentialite</loc>')
    expect(sitemap).toContain('<loc>https://olydor.app/cgu</loc>')
  })

  it('enables SSR, French html lang, local dev URL fallbacks, theme script, and SVG favicon in nuxt.config.ts', () => {
    const nuxtConfig = readFileSync(resolve(WEB_ROOT, 'nuxt.config.ts'), 'utf8')
    expect(nuxtConfig).toContain('ssr: true')
    expect(nuxtConfig).toContain("css: ['@olydor/ui/theme.css']")
    expect(nuxtConfig).toContain("transpile: ['@olydor/ui']")
    expect(nuxtConfig).toContain("include: ['lucide-vue-next']")
    expect(nuxtConfig).toContain('http://localhost:3002')
    expect(nuxtConfig).toContain("href: '/favicon.svg'")
    expect(nuxtConfig).toContain("content: '#0c0f16'")
  })

  it('uses i18n cleanly (no isEn, no 854 badge), disables Arena links, and exposes SEO metadata', () => {
    const indexPage = readFileSync(resolve(WEB_ROOT, 'pages/index.vue'), 'utf8')
    const i18nSrc = readFileSync(resolve(WEB_ROOT, 'utils/i18n.ts'), 'utf8')

    expect(indexPage).not.toContain('isEn')
    expect(indexPage).not.toContain('854')
    expect(i18nSrc).not.toContain('854')
    expect(indexPage).toContain('useSeoMeta(')
    expect(indexPage).toContain("'@type': 'SoftwareApplication'")
    expect(indexPage).toContain('BETA_FEEDBACK_FORM_URL')
    expect(indexPage).toContain('resolvePlatformUrls(')
    expect(indexPage).toContain('data-testid="hero-arena-disabled"')
    expect(indexPage).toContain('data-testid="bento-arena-disabled"')
    expect(indexPage).toContain('aria-disabled="true"')
    expect(BETA_FEEDBACK_FORM_URL).toBe('https://forms.gle/6FC4YYmw7nMkj3wT9')

    const { t, setLanguage } = useWebI18n()
    setLanguage('fr')
    expect(t('seoTitle')).toBe('Olydor — Simulateur Stratégique & IA Prédictive Pokémon TCG')
    expect(t('heroSubtitle')).toBe('Ne devinez plus la méta. Simulez chaque branche.')
    setLanguage('en')
    expect(t('heroSubtitle')).toBe('Stop guessing the meta. Simulate every branch.')
  })

  it('wires BetaTesterBanner, AppNavbar, and AppFooter in layouts/default.vue', () => {
    const layout = readFileSync(resolve(WEB_ROOT, 'layouts/default.vue'), 'utf8')
    expect(layout).toContain('<BetaTesterBanner')
    expect(layout).toContain('<AppNavbar')
    expect(layout).toContain('<AppFooter')
    expect(layout).toContain('active-app="web"')
  })

  it('exposes the three legal pages delegating to @olydor/ui components', () => {
    const mentions = readFileSync(resolve(WEB_ROOT, 'pages/mentions-legales.vue'), 'utf8')
    const privacy = readFileSync(resolve(WEB_ROOT, 'pages/confidentialite.vue'), 'utf8')
    const cgu = readFileSync(resolve(WEB_ROOT, 'pages/cgu.vue'), 'utf8')

    expect(mentions).toContain('LegalMentionsContent')
    expect(privacy).toContain('PrivacyPolicyContent')
    expect(cgu).toContain('TermsContent')
  })
})
