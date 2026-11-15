<template>
  <Teleport to="body">
    <div
      v-if="visible"
      data-testid="alpha-onboarding-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="olydor-alpha-onboarding-title"
      class="fixed inset-0 z-[120] flex items-center justify-center p-4 backdrop-blur-sm"
      style="background-color: var(--bg-overlay)"
      @click.self="dismiss"
    >
      <div
        class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border p-6 shadow-2xl space-y-5"
        style="
          background-color: var(--bg-surface);
          border-color: var(--border-subtle);
          color: var(--text-primary);
        "
      >
        <!-- Top Bar: Alpha Badge + Immediate Language Switcher -->
        <div
          class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b"
          style="border-color: var(--border-subtle)"
        >
          <div class="flex items-center gap-2.5">
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
              style="background: var(--brand-gradient)"
            >
              <Sparkles class="h-3.5 w-3.5" />
              {{ t('alphaBadge') }}
            </span>
            <OlydorLogo size="sm" :show-text="false" />
          </div>

          <!-- Immediate Bilingual Language Switcher -->
          <div
            class="flex items-center gap-2 rounded-xl border px-2.5 py-1.5"
            style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
          >
            <span class="text-[11px] font-semibold" style="color: var(--text-secondary)">
              Lang / Langue
            </span>
            <div class="inline-flex rounded-lg p-0.5 gap-1" style="background-color: var(--bg-surface)">
              <button
                type="button"
                data-testid="onboarding-lang-fr"
                class="rounded-md px-2.5 py-1 text-xs font-bold transition"
                :style="activeLang === 'fr'
                  ? 'background: var(--brand-gradient); color: #ffffff'
                  : 'color: var(--text-secondary)'"
                @click="chooseLang('fr')"
              >
                FR · Français
              </button>
              <button
                type="button"
                data-testid="onboarding-lang-en"
                class="rounded-md px-2.5 py-1 text-xs font-bold transition"
                :style="activeLang === 'en'
                  ? 'background: var(--brand-gradient); color: #ffffff'
                  : 'color: var(--text-secondary)'"
                @click="chooseLang('en')"
              >
                EN · English
              </button>
            </div>
          </div>
        </div>

        <!-- Title & Intro -->
        <div class="space-y-2">
          <h2 id="olydor-alpha-onboarding-title" class="text-xl sm:text-2xl font-black tracking-tight">
            {{ t('onboardingTitle') }}
          </h2>
          <p class="text-sm leading-relaxed" style="color: var(--text-secondary)">
            {{ t('onboardingIntro') }}
          </p>
        </div>

        <!-- 3 Structured Cards (Surface/Elevated contrast, never orange card bg) -->
        <div class="grid gap-3.5">
          <section
            class="rounded-xl border p-4 space-y-1.5"
            style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
          >
            <h3 class="flex items-center gap-2 text-sm font-bold" style="color: var(--text-primary)">
              <Compass class="h-4 w-4 shrink-0" style="color: var(--brand-primary)" />
              <span>{{ t('onboardingGoalTitle') }}</span>
            </h3>
            <p class="text-xs sm:text-sm leading-relaxed" style="color: var(--text-secondary)">
              {{ t('onboardingGoalBody') }}
            </p>
          </section>

          <section
            class="rounded-xl border p-4 space-y-1.5"
            style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
          >
            <h3 class="flex items-center gap-2 text-sm font-bold" style="color: var(--text-primary)">
              <Cpu class="h-4 w-4 shrink-0" style="color: var(--ai-accent)" />
              <span>{{ t('onboardingWhyAlphaTitle') }}</span>
            </h3>
            <p class="text-xs sm:text-sm leading-relaxed" style="color: var(--text-secondary)">
              {{ t('onboardingWhyAlphaBody') }}
            </p>
          </section>

          <section
            class="rounded-xl border p-4 space-y-1.5"
            style="background-color: var(--bg-elevated); border-color: var(--border-subtle)"
          >
            <h3 class="flex items-center gap-2 text-sm font-bold" style="color: var(--text-primary)">
              <Users class="h-4 w-4 shrink-0" style="color: var(--status-positive)" />
              <span>{{ t('onboardingHelpTitle') }}</span>
            </h3>
            <p class="text-xs sm:text-sm leading-relaxed" style="color: var(--text-secondary)">
              {{ t('onboardingHelpBody') }}
            </p>
          </section>
        </div>

        <!-- Footer Actions -->
        <div
          class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t"
          style="border-color: var(--border-subtle)"
        >
          <a
            :href="formUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-xs sm:text-sm font-semibold transition hover:brightness-110"
            style="
              border-color: var(--border-subtle);
              background-color: var(--bg-elevated);
              color: var(--text-primary);
            "
          >
            <span>{{ t('onboardingFeedbackLink') }}</span>
            <span aria-hidden="true">↗</span>
          </a>

          <button
            type="button"
            data-testid="onboarding-dismiss-btn"
            class="mo-btn-solar px-5 py-2.5 text-sm font-bold"
            @click="dismiss"
          >
            {{ t('onboardingStartBtn') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Compass, Cpu, Sparkles, Users } from 'lucide-vue-next'
import OlydorLogo from './OlydorLogo.vue'
import { ALPHA_FEEDBACK_FORM_URL } from '../logo'
import { setOlydorLanguage, useUiI18n, type OlydorLang } from '../i18n'
import {
  ALPHA_ONBOARDING_STORAGE_KEY,
  closeAlphaOnboarding,
  isAlphaOnboardingOpen,
  openAlphaOnboarding,
} from '../onboarding'

export interface AlphaOnboardingModalProps {
  modelValue?: boolean
  lang?: OlydorLang
  formUrl?: string
  storageKey?: string
}

const props = withDefaults(defineProps<AlphaOnboardingModalProps>(), {
  modelValue: undefined,
  lang: undefined,
  formUrl: ALPHA_FEEDBACK_FORM_URL,
  storageKey: ALPHA_ONBOARDING_STORAGE_KEY,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:lang': [lang: OlydorLang]
}>()

const { t, activeLang } = useUiI18n(() => props.lang)

const visible = computed(() =>
  props.modelValue !== undefined ? props.modelValue : isAlphaOnboardingOpen.value,
)

onMounted(() => {
  if (props.modelValue !== undefined) return
  if (typeof window === 'undefined') return
  try {
    const alreadySeen = window.localStorage.getItem(props.storageKey) === '1'
    if (!alreadySeen) {
      openAlphaOnboarding()
    }
  } catch {
    openAlphaOnboarding()
  }
})

function chooseLang(nextLang: OlydorLang) {
  setOlydorLanguage(nextLang)
  emit('update:lang', nextLang)
}

function dismiss() {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(props.storageKey, '1')
    } catch {
      // ignore storage errors in restricted contexts
    }
  }
  closeAlphaOnboarding()
  emit('update:modelValue', false)
}
</script>
