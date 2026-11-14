<template>
  <div class="min-h-screen flex flex-col" style="background-color: var(--bg-canvas); color: var(--text-primary)">
    <BetaTesterBanner :lang="lang" />
    <AppNavbar
      active-app="web"
      :web-url="config.public.webUrl"
      :sim-url="config.public.simUrl"
      :arena-url="config.public.arenaUrl"
      :api-base-url="config.public.apiUrl"
      :lang="lang"
      @update:lang="lang = $event"
    />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter
      :web-url="config.public.webUrl"
      :sim-url="config.public.simUrl"
      :arena-url="config.public.arenaUrl"
      :lang="lang"
    />
  </div>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue'
import { AppFooter, AppNavbar, BetaTesterBanner } from '@meta-oracle/ui'

const config = useRuntimeConfig()
const lang = ref<'fr' | 'en'>('fr')
provide('metaOracleLang', lang)
</script>
