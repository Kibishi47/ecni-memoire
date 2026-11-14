import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AppFooter,
  AppNavbar,
  BETA_FEEDBACK_FORM_URL,
  BetaTesterBanner,
  LegalMentionsContent,
  META_ORACLE_SVG,
  MetaOracleLogo,
  metaOracleTailwindPreset,
  PrivacyPolicyContent,
  TermsContent,
  TPCI_NON_AFFILIATION_DISCLAIMER_FR,
} from '../src/index'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('@meta-oracle/ui Design System & Shared Components', () => {
  it('contains exact official SVG in public/favicon.svg, logo.ts, and MetaOracleLogo', () => {
    const faviconPath = path.resolve(__dirname, '../public/favicon.svg')
    const faviconContent = fs.readFileSync(faviconPath, 'utf8').trim()
    expect(faviconContent).toBe(META_ORACLE_SVG.trim())

    const wrapper = mount(MetaOracleLogo, {
      props: { size: 'lg', showText: true },
    })
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.text()).toContain('META ORACLE')
    expect(wrapper.find('svg path').attributes('stroke')).toBe('url(#a)')
  })

  it('defines exact Dark Obsidian & Solar Flare CSS tokens in theme.css and Tailwind preset', () => {
    const themeCss = fs.readFileSync(path.resolve(__dirname, '../src/theme.css'), 'utf8')
    expect(themeCss).toContain('color-scheme: dark;')
    expect(themeCss).toContain('--bg-canvas: #0c0f16;')
    expect(themeCss).toContain('--brand-primary: #ff6b00;')
    expect(themeCss).toContain('--ai-accent: #38bdf8;')

    const colors = metaOracleTailwindPreset.theme?.extend?.colors as Record<string, unknown>
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
    expect(window.sessionStorage.getItem('meta_oracle_beta_banner_dismissed')).toBe('1')
  })

  it('renders AppNavbar with cross-subdomain links, SOON badge, and bug report trigger', async () => {
    const wrapper = mount(AppNavbar, {
      props: { activeApp: 'sim', lang: 'fr', interceptBugClick: true },
    })
    expect(wrapper.text()).toContain('Simulateur')
    expect(wrapper.text()).toContain('Arène IA')
    expect(wrapper.text()).toContain('SOON')

    const bugBtn = wrapper.findAll('button').find((b) => b.text().includes('Signaler un bug'))
    expect(bugBtn).toBeDefined()
    await bugBtn!.trigger('click')
    expect(wrapper.emitted('open-bug-modal')).toBeTruthy()
  })

  it('renders AppFooter with legal routes and exact TPCI non-affiliation disclaimer', () => {
    const wrapper = mount(AppFooter, { props: { lang: 'fr' } })
    expect(wrapper.text()).toContain(TPCI_NON_AFFILIATION_DISCLAIMER_FR)
    expect(wrapper.find('a[href="/mentions-legales"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/confidentialite"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/cgu"]').exists()).toBe(true)
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
