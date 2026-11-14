<template>
  <footer
    class="mt-auto border-t"
    style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-secondary)"
  >
    <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div class="grid gap-8 md:grid-cols-3">
        <div class="space-y-3">
          <MetaOracleLogo size="sm" />
          <p class="text-xs leading-relaxed max-w-sm" style="color: var(--text-secondary)">
            <template v-if="lang === 'en'">
              High-throughput Monte Carlo simulator and 3-ply lookahead tactical oracle built for competitive Pokémon TCG Standard analysis.
            </template>
            <template v-else>
              Écosystème d’analyse compétitive Pokémon TCG : simulation Monte-Carlo 3-ply haute vélocité et laboratoire d’optimisation de decklists.
            </template>
          </p>
        </div>

        <div class="space-y-2.5 text-xs">
          <h3 class="font-bold uppercase tracking-wider" style="color: var(--text-primary)">
            {{ lang === 'en' ? 'Ecosystem' : 'Plateforme' }}
          </h3>
          <ul class="space-y-1.5">
            <li>
              <a :href="webUrl" class="transition hover:text-white">
                Hub — meta-oracle.com
              </a>
            </li>
            <li>
              <a :href="simUrl" class="transition hover:text-white">
                {{ lang === 'en' ? 'Simulator — sim.meta-oracle.com' : 'Simulateur — sim.meta-oracle.com' }}
              </a>
            </li>
            <li>
              <a :href="arenaUrl" class="transition hover:text-white">
                {{ lang === 'en' ? 'AI Arena — arena.meta-oracle.com' : 'Arène IA Pythia — arena.meta-oracle.com' }}
              </a>
            </li>
            <li>
              <a
                :href="betaFormUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 font-semibold transition hover:brightness-110"
                style="color: var(--brand-amber)"
              >
                <span>{{ lang === 'en' ? 'Beta Feedback Form' : 'Rejoindre le programme Bêta' }}</span>
                <span aria-hidden="true">↗</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="space-y-2.5 text-xs">
          <h3 class="font-bold uppercase tracking-wider" style="color: var(--text-primary)">
            {{ lang === 'en' ? 'Legal & Compliance' : 'Informations Légales' }}
          </h3>
          <ul class="space-y-1.5">
            <li>
              <a :href="legalBaseUrl + '/mentions-legales'" class="transition hover:text-white">
                {{ lang === 'en' ? 'Legal Notice' : 'Mentions Légales' }}
              </a>
            </li>
            <li>
              <a :href="legalBaseUrl + '/confidentialite'" class="transition hover:text-white">
                {{ lang === 'en' ? 'Privacy Policy (GDPR)' : 'Politique de Confidentialité (RGPD)' }}
              </a>
            </li>
            <li>
              <a :href="legalBaseUrl + '/cgu'" class="transition hover:text-white">
                {{ lang === 'en' ? 'Terms of Service' : 'Conditions Générales d’Utilisation (CGU)' }}
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
        <p class="shrink-0">© {{ currentYear }} Meta Oracle</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MetaOracleLogo from './MetaOracleLogo.vue'
import {
  BETA_FEEDBACK_FORM_URL,
  TPCI_NON_AFFILIATION_DISCLAIMER_EN,
  TPCI_NON_AFFILIATION_DISCLAIMER_FR,
} from '../logo'

export interface AppFooterProps {
  webUrl?: string
  simUrl?: string
  arenaUrl?: string
  legalBaseUrl?: string
  betaFormUrl?: string
  lang?: 'fr' | 'en'
}

const props = withDefaults(defineProps<AppFooterProps>(), {
  webUrl: 'https://meta-oracle.com',
  simUrl: 'https://sim.meta-oracle.com',
  arenaUrl: 'https://arena.meta-oracle.com',
  legalBaseUrl: '',
  betaFormUrl: BETA_FEEDBACK_FORM_URL,
  lang: 'fr',
})

const currentYear = new Date().getFullYear()

const disclaimerText = computed(() =>
  props.lang === 'en' ? TPCI_NON_AFFILIATION_DISCLAIMER_EN : TPCI_NON_AFFILIATION_DISCLAIMER_FR,
)
</script>
