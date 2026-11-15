<template>
  <div class="min-h-screen flex flex-col" style="background-color: var(--bg-canvas); color: var(--text-primary)">
    <AlphaTesterBanner :lang="currentLang" />
    <AlphaOnboardingModal :lang="currentLang" @update:lang="setLanguage($event)" />
    <AppNavbar
      active-app="insight"
      :web-url="urls.webUrl"
      :insight-url="urls.insightUrl"
      :arena-url="urls.arenaUrl"
      :api-base-url="urls.apiUrl"
      :lang="currentLang"
      @update:lang="setLanguage($event)"
    />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter
      :web-url="urls.webUrl"
      :insight-url="urls.insightUrl"
      :arena-url="urls.arenaUrl"
      :lang="currentLang"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import {
  AlphaOnboardingModal,
  AlphaTesterBanner,
  AppFooter,
  AppNavbar,
  resolvePlatformUrls,
} from '@olydor/ui'
import { setApiBaseUrl } from '../services/apiClient'
import { useI18n } from '../utils/i18n'

const config = useRuntimeConfig()
const { currentLang, setLanguage } = useI18n()

const urls = computed(() =>
  resolvePlatformUrls({
    webUrl: config.public.webUrl,
    insightUrl: config.public.insightUrl,
    arenaUrl: config.public.arenaUrl,
    apiUrl: config.public.apiUrl,
  }),
)

watchEffect(() => {
  setApiBaseUrl(urls.value.apiUrl)
})
</script>
