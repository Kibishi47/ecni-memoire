<template>
  <header
    class="sticky top-0 z-40 border-b backdrop-blur-md"
    style="background-color: rgba(12, 15, 22, 0.88); border-color: var(--border-subtle)"
  >
    <div class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <!-- Brand Logo -->
      <a
        :href="webUrl"
        class="inline-flex items-center transition hover:opacity-90"
        aria-label="Meta Oracle Hub"
      >
        <MetaOracleLogo size="md" :subtitle="subtitleText" />
      </a>

      <!-- Desktop Navigation -->
      <nav class="hidden md:flex items-center gap-1.5" aria-label="Navigation principale">
        <a
          :href="webUrl"
          class="rounded-lg px-3.5 py-2 text-sm font-semibold transition"
          :style="activeApp === 'web'
            ? 'background-color: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle)'
            : 'color: var(--text-secondary); border: 1px solid transparent'"
        >
          {{ lang === 'en' ? 'Hub' : 'Hub' }}
        </a>

        <a
          :href="simUrl"
          class="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition"
          :style="activeApp === 'sim'
            ? 'background-color: rgba(255, 107, 0, 0.14); color: var(--brand-gold); border: 1px solid rgba(255, 107, 0, 0.4)'
            : 'color: var(--text-secondary); border: 1px solid transparent'"
        >
          <FlaskConical class="h-4 w-4" />
          <span>{{ lang === 'en' ? 'Simulator' : 'Simulateur' }}</span>
        </a>

        <a
          :href="arenaUrl"
          class="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition"
          :style="activeApp === 'arena'
            ? 'background-color: rgba(56, 189, 248, 0.12); color: var(--ai-accent); border: 1px solid rgba(56, 189, 248, 0.4)'
            : 'color: var(--text-secondary); border: 1px solid transparent'"
        >
          <Swords class="h-4 w-4" />
          <span>{{ lang === 'en' ? 'AI Arena' : 'Arène IA' }}</span>
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style="background-color: rgba(255, 194, 26, 0.15); color: var(--brand-gold); border: 1px solid rgba(255, 194, 26, 0.35)"
          >
            SOON
          </span>
        </a>
      </nav>

      <!-- Right Actions -->
      <div class="flex items-center gap-2">
        <button
          v-if="showLangToggle"
          type="button"
          class="rounded-lg border px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider transition hover:bg-white/5"
          style="border-color: var(--border-subtle); background-color: var(--bg-surface); color: var(--text-secondary)"
          :title="lang === 'fr' ? 'Switch to English' : 'Passer en Français'"
          @click="toggleLang"
        >
          {{ lang.toUpperCase() }}
        </button>

        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:brightness-110"
          style="
            border-color: rgba(255, 107, 0, 0.45);
            background-color: rgba(255, 107, 0, 0.12);
            color: var(--brand-amber);
          "
          @click="openBugReport"
        >
          <Bug class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{{ lang === 'en' ? 'Report a bug' : 'Signaler un bug' }}</span>
        </button>

        <!-- Mobile Menu Toggle -->
        <button
          type="button"
          class="inline-flex md:hidden rounded-lg border p-2 transition hover:bg-white/5"
          style="border-color: var(--border-subtle); color: var(--text-secondary)"
          :aria-expanded="mobileMenuOpen"
          aria-label="Menu"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <Menu v-if="!mobileMenuOpen" class="h-4 w-4" />
          <X v-else class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Mobile Navigation Drawer -->
    <div
      v-if="mobileMenuOpen"
      class="border-t px-4 py-3 md:hidden space-y-1"
      style="background-color: var(--bg-surface); border-color: var(--border-subtle)"
    >
      <a
        :href="webUrl"
        class="block rounded-lg px-3 py-2 text-sm font-semibold"
        :style="activeApp === 'web' ? 'color: var(--brand-gold); background-color: var(--bg-elevated)' : 'color: var(--text-secondary)'"
      >
        Hub (meta-oracle.com)
      </a>
      <a
        :href="simUrl"
        class="block rounded-lg px-3 py-2 text-sm font-semibold"
        :style="activeApp === 'sim' ? 'color: var(--brand-gold); background-color: var(--bg-elevated)' : 'color: var(--text-secondary)'"
      >
        {{ lang === 'en' ? 'Simulator (sim.meta-oracle.com)' : 'Simulateur (sim.meta-oracle.com)' }}
      </a>
      <a
        :href="arenaUrl"
        class="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold"
        :style="activeApp === 'arena' ? 'color: var(--ai-accent); background-color: var(--bg-elevated)' : 'color: var(--text-secondary)'"
      >
        <span>{{ lang === 'en' ? 'AI Arena vs Pythia' : 'Arène IA vs Pythia' }}</span>
        <span
          class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style="background-color: rgba(255, 194, 26, 0.15); color: var(--brand-gold)"
        >
          COMING SOON
        </span>
      </a>
    </div>

    <BugReportModal
      v-model="isBugModalOpen"
      :api-base-url="apiBaseUrl"
      :default-type="bugCardId ? 'CARD_MODEL_ERROR' : 'ENGINE_RULE_ERROR'"
      :default-card-id="bugCardId"
      :context-logs="bugContextLogs"
      :lang="lang"
    />
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bug, FlaskConical, Menu, Swords, X } from 'lucide-vue-next'
import MetaOracleLogo from './MetaOracleLogo.vue'
import BugReportModal from './BugReportModal.vue'

export interface AppNavbarProps {
  activeApp: 'web' | 'sim' | 'arena'
  webUrl?: string
  simUrl?: string
  arenaUrl?: string
  apiBaseUrl?: string
  lang?: 'fr' | 'en'
  showLangToggle?: boolean
  bugContextLogs?: Record<string, unknown> | null
  bugCardId?: string
  interceptBugClick?: boolean
}

const props = withDefaults(defineProps<AppNavbarProps>(), {
  webUrl: 'https://meta-oracle.com',
  simUrl: 'https://sim.meta-oracle.com',
  arenaUrl: 'https://arena.meta-oracle.com',
  apiBaseUrl: 'https://api.meta-oracle.com',
  lang: 'fr',
  showLangToggle: true,
  bugContextLogs: null,
  bugCardId: '',
  interceptBugClick: false,
})

const emit = defineEmits<{
  'update:lang': [lang: 'fr' | 'en']
  'open-bug-modal': []
}>()

const mobileMenuOpen = ref(false)
const isBugModalOpen = ref(false)

const subtitleText = computed(() => {
  if (props.activeApp === 'sim') return props.lang === 'en' ? 'Monte Carlo 3-Ply' : 'Simulateur 3-Ply'
  if (props.activeApp === 'arena') return 'Pythia AI Arena'
  return 'Pokémon TCG Analytics'
})

function toggleLang() {
  emit('update:lang', props.lang === 'fr' ? 'en' : 'fr')
}

function openBugReport() {
  emit('open-bug-modal')
  if (!props.interceptBugClick) {
    isBugModalOpen.value = true
  }
}
</script>
