<template>
  <div>
    <!-- Hero Section -->
    <section class="relative overflow-hidden border-b mo-obsidian-grid" style="border-color: var(--border-subtle)">
      <div class="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <div class="mx-auto max-w-4xl text-center">
          <div class="mb-7 flex justify-center">
            <div
              data-testid="hub-hero-emblem"
              class="inline-flex items-center justify-center rounded-3xl border-2 p-5 sm:p-6 transition-transform duration-300 hover:scale-[1.02]"
              style="
                background-color: var(--bg-surface);
                border-color: var(--brand-primary);
                box-shadow: 0 0 48px rgba(255, 107, 0, 0.38), 0 0 0 6px rgba(255, 107, 0, 0.12);
              "
            >
              <OlydorLogo :size="136" :show-text="false" />
            </div>
          </div>

          <h1 class="text-4xl font-black tracking-tight sm:text-6xl leading-[1.08]">
            <span class="mo-gradient-text">OLYDOR</span>
            <span class="block mt-2 text-2xl sm:text-4xl font-extrabold" style="color: var(--text-primary)">
              {{ t('heroSubtitle') }}
            </span>
          </h1>

          <p class="mx-auto mt-6 max-w-2xl text-base sm:text-lg leading-relaxed" style="color: var(--text-secondary)">
            {{ t('heroDescription') }}
          </p>

          <div class="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a
              :href="urls.insightUrl"
              data-testid="hero-insight-cta"
              class="mo-btn-solar inline-flex items-center gap-2.5 rounded-xl px-7 py-3.5 text-sm sm:text-base"
            >
              <FlaskConical class="h-5 w-5" />
              <span>{{ t('heroLaunchSim') }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>

            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="hero-arena-disabled"
              :data-arena-preview-url="urls.arenaUrl"
              class="inline-flex cursor-not-allowed items-center gap-2.5 rounded-xl border px-6 py-3.5 text-sm sm:text-base font-bold opacity-75 select-none"
              style="border-color: rgba(56, 189, 248, 0.4); background-color: rgba(56, 189, 248, 0.08); color: var(--ai-accent)"
            >
              <Swords class="h-5 w-5" />
              <span>{{ t('heroArenaDisabled') }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                style="background-color: rgba(255, 194, 26, 0.16); color: var(--brand-primary)"
              >
                {{ t('soonBadge') }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Bento Showcase: 2 Platforms -->
    <section id="platforms" class="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <div class="mb-10 max-w-2xl">
        <h2 class="text-2xl font-black tracking-tight sm:text-3xl" style="color: var(--text-primary)">
          {{ t('platformsTitle') }}
        </h2>
        <p class="mt-2 text-sm sm:text-base" style="color: var(--text-secondary)">
          {{ t('platformsSubtitle') }}
        </p>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Card 1: Simulator (LIVE) -->
        <article
          class="mo-card flex flex-col justify-between p-7 transition hover:border-orange-500/50"
          style="box-shadow: 0 10px 30px -15px rgba(255, 107, 0, 0.2)"
        >
          <div>
            <div class="flex items-center justify-between gap-3">
              <span class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style="color: var(--brand-primary)">
                <FlaskConical class="h-4 w-4" />
                {{ t('simDomain') }}
              </span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                style="background-color: rgba(16, 185, 129, 0.14); color: var(--status-positive); border: 1px solid rgba(16, 185, 129, 0.35)"
              >
                <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {{ t('simStatusBadge') }}
              </span>
            </div>

            <h3 class="mt-4 text-2xl font-black" style="color: var(--text-primary)">
              {{ t('simCardTitle') }}
            </h3>
            <p class="mt-3 text-sm leading-relaxed" style="color: var(--text-secondary)">
              {{ t('simCardDesc') }}
            </p>

            <ul class="mt-5 space-y-2 text-xs sm:text-sm" style="color: var(--text-secondary)">
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 shrink-0" style="color: var(--status-positive)" />
                <span>{{ t('simFeature1') }}</span>
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 shrink-0" style="color: var(--status-positive)" />
                <span>{{ t('simFeature2') }}</span>
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 shrink-0" style="color: var(--status-positive)" />
                <span>{{ t('simFeature3') }}</span>
              </li>
            </ul>
          </div>

          <div class="mt-7 pt-5 border-t flex flex-wrap items-center justify-between gap-3" style="border-color: var(--border-subtle)">
            <a
              :href="`${urls.insightUrl}?preset=charizard`"
              data-testid="bento-insight-preset"
              class="text-xs font-semibold underline decoration-orange-500/40 underline-offset-4 transition hover:opacity-80"
              style="color: var(--brand-primary)"
            >
              {{ t('simPresetCta') }}
            </a>
            <a
              :href="urls.insightUrl"
              data-testid="bento-insight-cta"
              class="mo-btn-solar inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm"
            >
              <span>{{ t('simOpenCta') }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>
          </div>
        </article>

        <!-- Card 2: AI Arena (COMING SOON — NON-CLICKABLE) -->
        <article
          class="mo-card flex flex-col justify-between p-7"
          style="box-shadow: 0 10px 30px -15px rgba(56, 189, 248, 0.14)"
        >
          <div>
            <div class="flex items-center justify-between gap-3">
              <span class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style="color: var(--ai-accent)">
                <Swords class="h-4 w-4" />
                {{ t('arenaDomain') }}
              </span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                style="background-color: rgba(255, 194, 26, 0.16); color: var(--brand-primary); border: 1px solid rgba(255, 107, 0, 0.35)"
              >
                {{ t('arenaStatusBadge') }}
              </span>
            </div>

            <h3 class="mt-4 text-2xl font-black" style="color: var(--text-primary)">
              {{ t('arenaCardTitle') }}
            </h3>
            <p class="mt-3 text-sm leading-relaxed" style="color: var(--text-secondary)">
              {{ t('arenaCardDesc') }}
            </p>

            <ul class="mt-5 space-y-2 text-xs sm:text-sm" style="color: var(--text-secondary)">
              <li class="flex items-center gap-2">
                <Sparkles class="h-4 w-4 shrink-0" style="color: var(--ai-accent)" />
                <span>{{ t('arenaFeature1') }}</span>
              </li>
              <li class="flex items-center gap-2">
                <Sparkles class="h-4 w-4 shrink-0" style="color: var(--ai-accent)" />
                <span>{{ t('arenaFeature2') }}</span>
              </li>
              <li class="flex items-center gap-2">
                <Sparkles class="h-4 w-4 shrink-0" style="color: var(--ai-accent)" />
                <span>{{ t('arenaFeature3') }}</span>
              </li>
            </ul>
          </div>

          <div class="mt-7 pt-5 border-t flex items-center justify-between gap-3" style="border-color: var(--border-subtle)">
            <span class="text-xs font-medium" style="color: var(--text-muted)">
              {{ t('arenaStatusNote') }}
            </span>
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="bento-arena-disabled"
              :data-arena-preview-url="urls.arenaUrl"
              class="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-bold opacity-70 select-none"
              style="border-color: rgba(56, 189, 248, 0.4); color: var(--ai-accent)"
            >
              <Lock class="h-4 w-4" />
              <span>{{ t('arenaDisabledAction') }}</span>
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- Architecture & Performance -->
    <section class="border-t border-b py-16" style="background-color: var(--bg-surface); border-color: var(--border-subtle)">
      <div class="mx-auto max-w-7xl px-4 sm:px-6">
        <div class="mb-10 max-w-2xl">
          <h2 class="text-2xl font-black tracking-tight sm:text-3xl" style="color: var(--text-primary)">
            {{ t('archTitle') }}
          </h2>
          <p class="mt-2 text-sm sm:text-base" style="color: var(--text-secondary)">
            {{ t('archSubtitle') }}
          </p>
        </div>

        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(255, 107, 0, 0.14); color: var(--brand-primary)">
              <Database class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">{{ t('archCompilerTitle') }}</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ t('archCompilerDesc') }}
            </p>
          </div>

          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(16, 185, 129, 0.14); color: var(--status-positive)">
              <Zap class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">{{ t('archMetaBenchTitle') }}</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ t('archMetaBenchDesc') }}
            </p>
          </div>

          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(56, 189, 248, 0.14); color: var(--ai-accent)">
              <GitBranch class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">{{ t('archLookaheadTitle') }}</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ t('archLookaheadDesc') }}
            </p>
          </div>

          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(255, 194, 26, 0.14); color: var(--brand-primary)">
              <Server class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">{{ t('archHybridTitle') }}</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ t('archHybridDesc') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Beta Tester CTA -->
    <section class="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div
        class="rounded-2xl border p-8 sm:p-10 text-center"
        style="
          background-color: var(--bg-surface);
          border-color: var(--border-subtle);
          box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.35);
        "
      >
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-white"
          style="background: var(--brand-gradient)"
        >
          <Sparkles class="h-3.5 w-3.5" />
          {{ t('betaBadge') }}
        </span>

        <h2 class="mt-4 text-2xl font-black sm:text-3xl" style="color: var(--text-primary)">
          {{ t('betaTitle') }}
        </h2>
        <p class="mx-auto mt-3 max-w-2xl text-sm sm:text-base" style="color: var(--text-secondary)">
          {{ t('betaDesc') }}
        </p>

        <div class="mt-7 flex flex-wrap items-center justify-center gap-4">
          <a
            :href="BETA_FEEDBACK_FORM_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="mo-btn-solar inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold"
          >
            <span>{{ t('betaCta') }}</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'
import {
  ArrowRight,
  CheckCircle2,
  Database,
  FlaskConical,
  GitBranch,
  Lock,
  Server,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-vue-next'
import { BETA_FEEDBACK_FORM_URL, OlydorLogo, resolvePlatformUrls, type OlydorLang } from '@olydor/ui'
import { useWebI18n } from '../utils/i18n'

const config = useRuntimeConfig()
const injectedLang = inject<Ref<OlydorLang> | undefined>('olydorLang', undefined)
const { t } = useWebI18n(() => injectedLang?.value)

const urls = computed(() =>
  resolvePlatformUrls({
    webUrl: config.public.webUrl,
    insightUrl: config.public.insightUrl,
    arenaUrl: config.public.arenaUrl,
    apiUrl: config.public.apiUrl,
  }),
)

useSeoMeta({
  title: () => t('seoTitle'),
  description: () => t('seoDescription'),
  ogTitle: () => t('ogTitle'),
  ogDescription: () => t('ogDescription'),
  ogType: 'website',
  ogUrl: 'https://olydor.app',
  twitterCard: 'summary_large_image',
  twitterTitle: () => t('twitterTitle'),
  twitterDescription: () => t('twitterDescription'),
})

useHead({
  link: [{ rel: 'canonical', href: 'https://olydor.app/' }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Olydor',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Web',
        url: 'https://olydor.app',
        description:
          'Simulateur Monte-Carlo haute vélocité et future arène 1v1 contre le bot Pythia pour Pokémon TCG Standard.',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'EUR',
        },
      }),
    },
  ],
})
</script>
