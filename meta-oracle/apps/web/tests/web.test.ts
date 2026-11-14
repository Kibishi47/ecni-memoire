import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BETA_FEEDBACK_FORM_URL, META_ORACLE_SVG } from '@meta-oracle/ui'

const WEB_ROOT = resolve(__dirname, '..')

describe('@meta-oracle/web hub & SEO configuration', () => {
  it('uses the exact official SVG for public/favicon.svg', () => {
    const favicon = readFileSync(resolve(WEB_ROOT, 'public/favicon.svg'), 'utf8').trim()
    expect(favicon).toBe(META_ORACLE_SVG)
  })

  it('provides valid robots.txt and sitemap.xml covering all hub & legal routes', () => {
    const robots = readFileSync(resolve(WEB_ROOT, 'public/robots.txt'), 'utf8')
    const sitemap = readFileSync(resolve(WEB_ROOT, 'public/sitemap.xml'), 'utf8')

    expect(robots).toContain('Allow: /')
    expect(robots).toContain('Sitemap: https://meta-oracle.com/sitemap.xml')
    expect(sitemap).toContain('<loc>https://meta-oracle.com/</loc>')
    expect(sitemap).toContain('<loc>https://meta-oracle.com/mentions-legales</loc>')
    expect(sitemap).toContain('<loc>https://meta-oracle.com/confidentialite</loc>')
    expect(sitemap).toContain('<loc>https://meta-oracle.com/cgu</loc>')
  })

  it('enables SSR, French html lang, Obsidian dark theme color, and SVG favicon in nuxt.config.ts', () => {
    const nuxtConfig = readFileSync(resolve(WEB_ROOT, 'nuxt.config.ts'), 'utf8')
    expect(nuxtConfig).toContain('ssr: true')
    expect(nuxtConfig).toContain("css: ['@meta-oracle/ui/theme.css']")
    expect(nuxtConfig).toContain("href: '/favicon.svg'")
    expect(nuxtConfig).toContain("content: '#0c0f16'")
  })

  it('includes SEO metadata, JSON-LD SoftwareApplication schema, and beta CTA in pages/index.vue', () => {
    const indexPage = readFileSync(resolve(WEB_ROOT, 'pages/index.vue'), 'utf8')
    expect(indexPage).toContain('useSeoMeta(')
    expect(indexPage).toContain('Simulateur Stratégique & IA Prédictive Pokémon TCG')
    expect(indexPage).toContain('Ne devinez plus la méta. Simulez chaque branche.')
    expect(indexPage).toContain("'@type': 'SoftwareApplication'")
    expect(indexPage).toContain('BETA_FEEDBACK_FORM_URL')
    expect(indexPage).toContain('config.public.simUrl')
    expect(indexPage).toContain('config.public.arenaUrl')
    expect(BETA_FEEDBACK_FORM_URL).toBe('https://forms.gle/6FC4YYmw7nMkj3wT9')
  })

  it('wires BetaTesterBanner, AppNavbar, and AppFooter in layouts/default.vue', () => {
    const layout = readFileSync(resolve(WEB_ROOT, 'layouts/default.vue'), 'utf8')
    expect(layout).toContain('<BetaTesterBanner')
    expect(layout).toContain('<AppNavbar')
    expect(layout).toContain('<AppFooter')
    expect(layout).toContain('active-app="web"')
  })

  it('exposes the three legal pages delegating to @meta-oracle/ui components', () => {
    const mentions = readFileSync(resolve(WEB_ROOT, 'pages/mentions-legales.vue'), 'utf8')
    const privacy = readFileSync(resolve(WEB_ROOT, 'pages/confidentialite.vue'), 'utf8')
    const cgu = readFileSync(resolve(WEB_ROOT, 'pages/cgu.vue'), 'utf8')

    expect(mentions).toContain('LegalMentionsContent')
    expect(privacy).toContain('PrivacyPolicyContent')
    expect(cgu).toContain('TermsContent')
  })
})
