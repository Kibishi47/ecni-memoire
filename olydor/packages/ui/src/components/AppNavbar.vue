<template>
  <header
    class="sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-200"
    style="background-color: var(--bg-navbar); border-color: var(--border-subtle)"
  >
    <div class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <!-- Brand Logo -->
      <a
        :href="urls.webUrl"
        class="inline-flex items-center transition hover:opacity-90"
        aria-label="Olydor Hub"
      >
        <OlydorLogo size="md" :subtitle="subtitleText" />
      </a>

      <!-- Desktop Navigation -->
      <nav class="hidden md:flex items-center gap-1.5" :aria-label="t('navMainAria')">
        <a
          :href="urls.webUrl"
          class="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition"
          :style="activeApp === 'web'
            ? 'background-color: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle)'
            : 'color: var(--text-secondary); border: 1px solid transparent'"
        >
          <Compass class="h-4 w-4" />
          <span>{{ t('navHub') }}</span>
        </a>

        <a
          :href="urls.insightUrl"
          class="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition"
          :style="activeApp === 'insight'
            ? 'background-color: rgba(255, 107, 0, 0.14); color: var(--brand-primary); border: 1px solid rgba(255, 107, 0, 0.45)'
            : 'color: var(--text-secondary); border: 1px solid transparent'"
        >
          <FlaskConical class="h-4 w-4" />
          <span>{{ t('navInsight') }}</span>
        </a>

        <!-- Non-clickable Arena button (Coming Soon) -->
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-testid="nav-arena-disabled"
          :data-arena-preview-url="urls.arenaUrl"
          :title="t('navArenaDisabledTitle')"
          class="inline-flex cursor-not-allowed items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold opacity-75 select-none transition"
          :style="activeApp === 'arena'
            ? 'background-color: rgba(56, 189, 248, 0.12); color: var(--ai-accent); border: 1px solid rgba(56, 189, 248, 0.4)'
            : 'color: var(--text-secondary); border: 1px solid transparent'"
        >
          <Swords class="h-4 w-4" />
          <span>{{ t('navArena') }}</span>
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style="background-color: rgba(255, 194, 26, 0.16); color: var(--brand-primary); border: 1px solid rgba(255, 107, 0, 0.35)"
          >
            {{ t('navSoonBadge') }}
          </span>
        </button>
      </nav>

      <!-- Right Actions -->
      <div class="flex items-center gap-2">
        <button
          type="button"
          data-testid="theme-toggle"
          class="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition hover:brightness-110"
          style="border-color: var(--border-subtle); background-color: var(--bg-surface); color: var(--text-secondary)"
          :aria-label="isLight ? t('navSwitchThemeToDark') : t('navSwitchThemeToLight')"
          :title="isLight ? t('navSwitchThemeToDark') : t('navSwitchThemeToLight')"
          @click="toggleTheme()"
        >
          <Moon v-if="isLight" class="h-4 w-4" />
          <Sun v-else class="h-4 w-4" />
        </button>

        <button
          v-if="showLangToggle"
          type="button"
          data-testid="lang-toggle"
          class="rounded-lg border px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider transition hover:brightness-110"
          style="border-color: var(--border-subtle); background-color: var(--bg-surface); color: var(--text-secondary)"
          :title="t('navSwitchLangLabel')"
          @click="handleToggleLang"
        >
          {{ t('navLangCode') }}
        </button>

        <button
          type="button"
          data-testid="report-bug-btn"
          class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:brightness-110"
          style="
            border-color: rgba(255, 107, 0, 0.4);
            background-color: rgba(255, 107, 0, 0.12);
            color: var(--brand-primary);
          "
          @click="openBugReport"
        >
          <Bug class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{{ t('navReportBug') }}</span>
        </button>

        <button
          type="button"
          class="inline-flex md:hidden rounded-lg border p-2"
          style="border-color: var(--border-subtle); background-color: var(--bg-surface); color: var(--text-primary)"
          :aria-label="t('navOpenMenu')"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <X v-if="mobileMenuOpen" class="h-4 w-4" />
          <Menu v-else class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Mobile Navigation -->
    <div
      v-if="mobileMenuOpen"
      class="border-t px-4 py-3 md:hidden space-y-1.5"
      style="background-color: var(--bg-surface); border-color: var(--border-subtle)"
    >
      <a
        :href="urls.webUrl"
        class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
        :style="activeApp === 'web' ? 'background-color: var(--bg-elevated); color: var(--text-primary)' : 'color: var(--text-secondary)'"
      >
        <Compass class="h-4 w-4" />
        <span>{{ t('navHub') }}</span>
      </a>
      <a
        :href="urls.insightUrl"
        class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold"
        :style="activeApp === 'insight' ? 'background-color: rgba(255,107,0,0.14); color: var(--brand-primary)' : 'color: var(--text-secondary)'"
      >
        <FlaskConical class="h-4 w-4" />
        <span>{{ t('navInsight') }}</span>
      </a>
      <button
        type="button"
        disabled
        aria-disabled="true"
        :data-arena-preview-url="urls.arenaUrl"
        class="flex w-full cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold opacity-75 select-none"
        :style="activeApp === 'arena' ? 'background-color: rgba(56,189,248,0.12); color: var(--ai-accent)' : 'color: var(--text-secondary)'"
      >
        <span class="inline-flex items-center gap-2">
          <Swords class="h-4 w-4" />
          <span>{{ t('navArena') }}</span>
        </span>
        <span
          class="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style="background-color: rgba(255, 194, 26, 0.16); color: var(--brand-primary); border: 1px solid rgba(255, 107, 0, 0.35)"
        >
          {{ t('navSoonBadge') }}
        </span>
      </button>
    </div>
  </header>

  <BugReportModal
    v-model="isBugModalOpen"
    :api-base-url="urls.apiUrl"
    :default-type="bugCardId ? 'CARD_MODEL_ERROR' : 'WEBSITE_ERROR'"
    :default-card-id="bugCardId"
    :context-logs="bugContextLogs"
    :lang="activeLang"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bug, Compass, FlaskConical, Menu, Moon, Sun, Swords, X } from 'lucide-vue-next'
import OlydorLogo from './OlydorLogo.vue'
import BugReportModal from './BugReportModal.vue'
import { resolvePlatformUrls } from '../urls'
import { useTheme } from '../theme'
import { setOlydorLanguage, useUiI18n, type OlydorLang } from '../i18n'

export interface AppNavbarProps {
  activeApp: 'web' | 'insight' | 'arena'
  webUrl?: string
  insightUrl?: string
  arenaUrl?: string
  apiBaseUrl?: string
  lang?: OlydorLang
  showLangToggle?: boolean
  bugContextLogs?: Record<string, unknown> | null
  bugCardId?: string
  interceptBugClick?: boolean
}

const props = withDefaults(defineProps<AppNavbarProps>(), {
  webUrl: undefined,
  insightUrl: undefined,
  arenaUrl: undefined,
  apiBaseUrl: undefined,
  lang: undefined,
  showLangToggle: true,
  bugContextLogs: null,
  bugCardId: '',
  interceptBugClick: false,
})

const emit = defineEmits<{
  'update:lang': [lang: OlydorLang]
  'open-bug-modal': []
}>()

const { isLight, toggleTheme } = useTheme()
const { t, activeLang } = useUiI18n(() => props.lang)

const urls = computed(() =>
  resolvePlatformUrls({
    webUrl: props.webUrl,
    insightUrl: props.insightUrl,
    arenaUrl: props.arenaUrl,
    apiUrl: props.apiBaseUrl,
  }),
)

const mobileMenuOpen = ref(false)
const isBugModalOpen = ref(false)

const subtitleText = computed(() => {
  if (props.activeApp === 'insight') return t('subtitleInsight')
  if (props.activeApp === 'arena') return t('subtitleArena')
  return t('subtitleWeb')
})

function handleToggleLang() {
  const next: OlydorLang = activeLang.value === 'fr' ? 'en' : 'fr'
  setOlydorLanguage(next)
  emit('update:lang', next)
}

function openBugReport() {
  emit('open-bug-modal')
  if (!props.interceptBugClick) {
    isBugModalOpen.value = true
  }
}
</script>
