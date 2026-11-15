<template>
  <article class="mx-auto max-w-4xl px-4 py-12 sm:px-6">
    <div class="mb-8">
      <a
        href="/"
        class="inline-flex items-center gap-1.5 text-xs font-semibold transition hover:brightness-125"
        style="color: var(--brand-primary)"
      >
        <span>←</span>
        <span>{{ t('legalBackHome') }}</span>
      </a>
      <h1 class="mt-4 text-3xl font-black tracking-tight sm:text-4xl mo-gradient-text">
        {{ t('mentionsTitle') }}
      </h1>
      <p class="mt-2 text-sm" style="color: var(--text-secondary)">
        {{ t('mentionsSubtitle', { date: effectiveDate }) }}
      </p>
    </div>

    <div class="space-y-6 text-sm leading-relaxed" style="color: var(--text-secondary)">
      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">{{ t('mentionsS1Title') }}</h2>
        <p>
          {{ t('mentionsS1Body1Prefix') }}
          <strong style="color: var(--text-primary)">{{ t('mentionsS1Body1Strong') }}</strong>
          {{ t('mentionsS1Body1Suffix') }}
        </p>
        <p>
          {{ t('mentionsS1Body2') }}
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">{{ t('mentionsS2Title') }}</h2>
        <p>
          {{ t('mentionsS2BodyPrefix') }}
          <strong style="color: var(--text-primary)">{{ t('mentionsS2BodyStrong') }}</strong>
          {{ t('mentionsS2BodySuffix') }}
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">{{ t('mentionsS3Title') }}</h2>
        <p>
          {{ t('mentionsS3Body1') }}
        </p>
        <p class="rounded-lg border p-3.5 text-xs font-medium" style="background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-primary)">
          {{ disclaimer }}
        </p>
        <p>
          {{ t('mentionsS3Body2') }}
        </p>
      </section>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  TPCI_NON_AFFILIATION_DISCLAIMER_EN,
  TPCI_NON_AFFILIATION_DISCLAIMER_FR,
} from '../logo'
import { useUiI18n, type OlydorLang } from '../i18n'

const props = defineProps<{
  lastUpdated?: string
  lang?: OlydorLang
}>()

const { t, activeLang } = useUiI18n(() => props.lang)
const effectiveDate = computed(() => props.lastUpdated || t('legalDefaultDate'))
const disclaimer = computed(() =>
  activeLang.value === 'en'
    ? TPCI_NON_AFFILIATION_DISCLAIMER_EN
    : TPCI_NON_AFFILIATION_DISCLAIMER_FR,
)
</script>
