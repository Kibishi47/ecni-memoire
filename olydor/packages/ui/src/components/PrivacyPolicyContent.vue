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
        {{ t('privacyTitle') }}
      </h1>
      <p class="mt-2 text-sm" style="color: var(--text-secondary)">
        {{ t('privacySubtitle', { date: effectiveDate }) }}
      </p>
    </div>

    <div class="space-y-6 text-sm leading-relaxed" style="color: var(--text-secondary)">
      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">{{ t('privacyS1Title') }}</h2>
        <p>
          {{ t('privacyS1Body') }}
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">{{ t('privacyS2Title') }}</h2>
        <p>
          {{ t('privacyS2BodyPrefix') }}
          <strong style="color: var(--text-primary)">{{ t('privacyS2BodyStrong') }}</strong>
          {{ t('privacyS2BodySuffix') }}
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">{{ t('privacyS3Title') }}</h2>
        <p>
          {{ t('privacyS3Body1') }}
        </p>
        <p>
          {{ t('privacyS3Body2') }}
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">{{ t('privacyS4Title') }}</h2>
        <p>
          {{ t('privacyS4Body') }}
        </p>
      </section>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUiI18n, type OlydorLang } from '../i18n'

const props = defineProps<{
  lastUpdated?: string
  lang?: OlydorLang
}>()

const { t } = useUiI18n(() => props.lang)
const effectiveDate = computed(() => props.lastUpdated || t('legalDefaultDate'))
</script>
