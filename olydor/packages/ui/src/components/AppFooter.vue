<template>
  <footer
    class="mt-auto border-t transition-colors duration-200"
    style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
  >
    <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div class="grid gap-8 md:grid-cols-3">
        <div class="space-y-3">
          <OlydorLogo size="sm" />
          <p class="text-xs leading-relaxed max-w-sm" style="color: var(--text-secondary)">
            {{ t('footerDesc') }}
          </p>
        </div>

        <div class="space-y-2.5 text-xs">
          <h3 class="font-bold uppercase tracking-wider" style="color: var(--text-primary)">
            {{ t('footerPlatformsHeading') }}
          </h3>
          <ul class="space-y-1.5">
            <li>
              <a :href="urls.webUrl" class="transition hover:opacity-80" style="color: var(--text-secondary)">
                {{ t('footerHubLink') }}
              </a>
            </li>
            <li>
              <a :href="urls.insightUrl" class="transition hover:opacity-80" style="color: var(--text-secondary)">
                {{ t('footerInsightLink') }}
              </a>
            </li>
            <li>
              <span
                aria-disabled="true"
                data-testid="footer-arena-disabled"
                class="inline-flex cursor-not-allowed items-center gap-1.5 opacity-65 select-none"
                style="color: var(--text-muted)"
              >
                {{ t('footerArenaDisabled') }}
              </span>
            </li>
            <li>
              <a
                :href="alphaFormUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 font-semibold transition hover:brightness-110"
                style="color: var(--brand-primary)"
              >
                <span>{{ t('footerAlphaCta') }}</span>
                <span aria-hidden="true">↗</span>
              </a>
            </li>
            <li v-if="showAboutAlpha">
              <button
                type="button"
                data-testid="footer-about-alpha"
                class="inline-flex items-center gap-1 text-left transition hover:opacity-80"
                style="color: var(--text-secondary)"
                @click="openAlphaOnboarding()"
              >
                {{ t('footerAboutAlpha') }}
              </button>
            </li>
          </ul>
        </div>

        <div class="space-y-2.5 text-xs">
          <h3 class="font-bold uppercase tracking-wider" style="color: var(--text-primary)">
            {{ t('footerLegalHeading') }}
          </h3>
          <ul class="space-y-1.5">
            <li>
              <a :href="legalBaseUrl + '/mentions-legales'" class="transition hover:opacity-80" style="color: var(--text-secondary)">
                {{ t('footerLegalNotice') }}
              </a>
            </li>
            <li>
              <a :href="legalBaseUrl + '/confidentialite'" class="transition hover:opacity-80" style="color: var(--text-secondary)">
                {{ t('footerPrivacy') }}
              </a>
            </li>
            <li>
              <a :href="legalBaseUrl + '/cgu'" class="transition hover:opacity-80" style="color: var(--text-secondary)">
                {{ t('footerTerms') }}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div
        class="mt-8 border-t pt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-[11px] leading-relaxed"
        style="border-color: var(--border-subtle); color: var(--text-muted)"
      >
        <p>{{ disclaimerText }}</p>
        <p class="shrink-0">{{ t('footerCopyright', { year: currentYear }) }}</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import OlydorLogo from './OlydorLogo.vue'
import {
  ALPHA_FEEDBACK_FORM_URL,
  TPCI_NON_AFFILIATION_DISCLAIMER_EN,
  TPCI_NON_AFFILIATION_DISCLAIMER_FR,
} from '../logo'
import { resolvePlatformUrls } from '../urls'
import { useUiI18n, type OlydorLang } from '../i18n'
import { openAlphaOnboarding } from '../onboarding'

export interface AppFooterProps {
  webUrl?: string
  insightUrl?: string
  arenaUrl?: string
  legalBaseUrl?: string
  alphaFormUrl?: string
  lang?: OlydorLang
  showAboutAlpha?: boolean
}

const props = withDefaults(defineProps<AppFooterProps>(), {
  webUrl: undefined,
  insightUrl: undefined,
  arenaUrl: undefined,
  legalBaseUrl: '',
  alphaFormUrl: ALPHA_FEEDBACK_FORM_URL,
  lang: undefined,
  showAboutAlpha: false,
})

const { t, activeLang } = useUiI18n(() => props.lang)

const urls = computed(() =>
  resolvePlatformUrls({
    webUrl: props.webUrl,
    insightUrl: props.insightUrl,
    arenaUrl: props.arenaUrl,
  }),
)

const currentYear = new Date().getFullYear()

const disclaimerText = computed(() =>
  activeLang.value === 'en' ? TPCI_NON_AFFILIATION_DISCLAIMER_EN : TPCI_NON_AFFILIATION_DISCLAIMER_FR,
)
</script>
