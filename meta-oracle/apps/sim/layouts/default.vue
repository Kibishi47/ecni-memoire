<template>
  <div class="min-h-screen flex flex-col" style="background-color: var(--bg-canvas); color: var(--text-primary)">
    <BetaTesterBanner :lang="currentLang" />
    <AppNavbar
      active-app="sim"
      :web-url="config.public.webUrl"
      :sim-url="config.public.simUrl"
      :arena-url="config.public.arenaUrl"
      :api-base-url="config.public.apiUrl"
      :lang="currentLang"
      @update:lang="setLanguage($event)"
    />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter
      :web-url="config.public.webUrl"
      :sim-url="config.public.simUrl"
      :arena-url="config.public.arenaUrl"
      :lang="currentLang"
    />
  </div>
</template>

<script setup lang="ts">
import { AppFooter, AppNavbar, BetaTesterBanner } from '@meta-oracle/ui'
import { setApiBaseUrl } from '../services/apiClient'
import { useI18n } from '../utils/i18n'

const config = useRuntimeConfig()
setApiBaseUrl(config.public.apiUrl)
const { currentLang, setLanguage } = useI18n()
</script>
