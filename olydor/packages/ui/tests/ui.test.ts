import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AppFooter,
  AppNavbar,
  BETA_FEEDBACK_FORM_URL,
  BetaTesterBanner,
  createI18n,
  currentTheme,
  LegalMentionsContent,
  OLYDOR_SVG,
  OlydorLogo,
  olydorTailwindPreset,
  PrivacyPolicyContent,
  resolvePlatformUrls,
  setOlydorLanguage,
  setTheme,
  TermsContent,
  TPCI_NON_AFFILIATION_DISCLAIMER_FR,
} from '../src/index'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

afterEach(() => {
  setTheme('dark')
  setOlydorLanguage('fr')
})

describe('@olydor/ui Design System & Shared Components', () => {
  it('contains exact official SVG in public/favicon.svg, logo.ts, and OlydorLogo', () => {
    const faviconPath = path.resolve(__dirname, '../public/favicon.svg')
    const faviconContent = fs.readFileSync(faviconPath, 'utf8').trim()
    expect(faviconContent).toBe(OLYDOR_SVG.trim())

    const wrapper = mount(OlydorLogo, {
      props: { size: 'lg', showText: true },
    })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.text()).toContain('OLYDOR')
    expect(wrapper.find('svg path').attributes('stroke')).toBe('url(#a)')
  })

  it('defines Dark Obsidian default tokens and Solar Flare Light Theme overrides in theme.css', () => {
    const themeCss = fs.readFileSync(path.resolve(__dirname, '../src/theme.css'), 'utf8')
    expect(themeCss).toContain('color-scheme: dark;')
    expect(themeCss).toContain('--bg-canvas: #0c0f16;')
    expect(themeCss).toContain('--brand-primary: #ff6b00;')
    expect(themeCss).toContain('--ai-accent: #38bdf8;')
    expect(themeCss).toContain('html.light')
    expect(themeCss).toContain('color-scheme: light;')
    expect(themeCss).toContain('--bg-canvas: #f8fafc;')

    const colors = olydorTailwindPreset.theme?.extend?.colors as Record<string, unknown>
    expect(colors).toBeDefined()
    expect(colors.obsidian).toEqual({
      canvas: '#0c0f16',
      surface: '#131823',
      elevated: '#1b2232',
      border: '#263044',
    })
  })

  it('renders BetaTesterBanner with Google Form CTA and supports session dismissal', async () => {
    window.sessionStorage.clear()
    const wrapper = mount(BetaTesterBanner, { props: { lang: 'fr' } })
    const link = wrapper.find('a')
    expect(link.attributes('href')).toBe(BETA_FEEDBACK_FORM_URL)
    expect(link.attributes('href')).toBe('https://forms.gle/6FC4YYmw7nMkj3wT9')
    expect(link.attributes('target')).toBe('_blank')

    await wrapper.find('button').trigger('click')
    expect(wrapper.find('[role="region"]').exists()).toBe(false)
    expect(window.sessionStorage.getItem('olydor_beta_banner_dismissed')).toBe('1')
  })

  it('renders AppNavbar with localhost/prod routing, non-clickable Arena button, theme toggle, lang toggle, and bug report trigger', async () => {
    const wrapper = mount(AppNavbar, {
      props: { activeApp: 'insight', interceptBugClick: true },
    })
    expect(wrapper.text()).toContain('Simulateur')
    expect(wrapper.text()).toContain('Insight')
    expect(wrapper.text()).toContain('Arène IA')
    expect(wrapper.text()).toContain('SOON')

    const arenaBtn = wrapper.find('[data-testid="nav-arena-disabled"]')
    expect(arenaBtn.exists()).toBe(true)
    expect(arenaBtn.element.tagName).toBe('BUTTON')
    expect(arenaBtn.attributes('disabled')).toBeDefined()
    expect(arenaBtn.attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('a[href*="arena"]').exists()).toBe(false)

    // Theme switch dark -> light -> dark
    expect(currentTheme.value).toBe('dark')
    await wrapper.find('[data-testid="theme-toggle"]').trigger('click')
    expect(currentTheme.value).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    await wrapper.find('[data-testid="theme-toggle"]').trigger('click')
    expect(currentTheme.value).toBe('dark')

    // Language switch FR -> EN
    await wrapper.find('[data-testid="lang-toggle"]').trigger('click')
    expect(wrapper.emitted('update:lang')?.[0]).toEqual(['en'])
    expect(wrapper.text()).toContain('AI Arena')

    const bugBtn = wrapper.find('[data-testid="report-bug-btn"]')
    expect(bugBtn.exists()).toBe(true)
    await bugBtn.trigger('click')
    expect(wrapper.emitted('open-bug-modal')).toBeTruthy()
  })

  it('renders AppFooter with disabled Arena label, legal routes, and TPCI non-affiliation disclaimer', () => {
    const wrapper = mount(AppFooter, { props: { lang: 'fr' } })
    expect(wrapper.text()).toContain(TPCI_NON_AFFILIATION_DISCLAIMER_FR)
    expect(wrapper.find('[data-testid="footer-arena-disabled"]').attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('a[href*="arena"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/mentions-legales"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/confidentialite"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/cgu"]').exists()).toBe(true)
  })

  it('resolves localhost ports in local dev and olydor.app domains in production via resolvePlatformUrls & createI18n', () => {
    const localUrls = resolvePlatformUrls(
      {
        webUrl: 'https://olydor.app',
        insightUrl: 'https://insight.olydor.app',
        arenaUrl: 'https://arena.olydor.app',
        apiUrl: 'https://api.olydor.app',
      },
      { hostname: 'localhost' },
    )
    expect(localUrls).toEqual({
      webUrl: 'http://localhost:3001',
      insightUrl: 'http://localhost:3002',
      arenaUrl: 'http://localhost:3003',
      apiUrl: 'http://localhost:3000',
    })

    const loopbackUrls = resolvePlatformUrls({}, { hostname: '127.0.0.1' })
    expect(loopbackUrls.insightUrl).toBe('http://127.0.0.1:3002')
    expect(loopbackUrls.apiUrl).toBe('http://127.0.0.1:3000')

    const prodUrls = resolvePlatformUrls(
      { webUrl: 'http://localhost:3001' },
      { hostname: 'olydor.app', isDev: false },
    )
    expect(prodUrls).toEqual({
      webUrl: 'https://olydor.app',
      insightUrl: 'https://insight.olydor.app',
      arenaUrl: 'https://arena.olydor.app',
      apiUrl: 'https://api.olydor.app',
    })

    const dict = createI18n({
      fr: { greeting: 'Bonjour {name}' },
      en: { greeting: 'Hello {name}' },
    })
    setOlydorLanguage('fr')
    expect(dict.t('greeting', { name: 'Olydor' })).toBe('Bonjour Olydor')
    setOlydorLanguage('en')
    expect(dict.t('greeting', { name: 'Olydor' })).toBe('Hello Olydor')
  })

  it('renders complete legal content pages in French', () => {
    const mentions = mount(LegalMentionsContent)
    expect(mentions.text()).toContain('Mentions Légales')
    expect(mentions.text()).toContain(TPCI_NON_AFFILIATION_DISCLAIMER_FR)

    const privacy = mount(PrivacyPolicyContent)
    expect(privacy.text()).toContain('RGPD')

    const terms = mount(TermsContent)
    expect(terms.text()).toContain('Conditions Générales')
  })
})
