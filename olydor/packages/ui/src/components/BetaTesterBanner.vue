<template>
  <div
    v-if="!isDismissed"
    role="region"
    aria-label="Programme Bêta Ouverte Olydor"
    class="relative z-50 border-b text-xs sm:text-sm"
    style="
      background: linear-gradient(90deg, rgba(225, 29, 72, 0.16) 0%, rgba(255, 107, 0, 0.18) 50%, rgba(255, 194, 26, 0.14) 100%), var(--bg-surface);
      border-color: rgba(255, 107, 0, 0.35);
      color: var(--text-primary);
    "
  >
    <div class="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
      <div class="flex flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center sm:justify-start sm:text-left">
        <span
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
          style="background: var(--brand-gradient)"
        >
          <Sparkles class="h-3 w-3" />
          BÊTA OUVERTE
        </span>
        <p class="font-medium leading-snug" style="color: var(--text-primary)">
          <template v-if="lang === 'en'">
            Olydor is in open Beta testing — help shape the 3-ply Pokémon TCG engine &amp; Pythia AI Arena.
          </template>
          <template v-else>
            Olydor est en phase Bêta ouverte — contribuez à améliorer le moteur 3-ply et la future Arène IA Pythia !
          </template>
        </p>
        <a
          :href="formUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-bold text-white transition hover:brightness-110"
          style="background: var(--brand-gradient); box-shadow: var(--brand-glow)"
        >
          <span>{{ lang === 'en' ? 'Become a Beta Tester' : 'Devenir Bêta-Testeur' }}</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>

      <button
        v-if="dismissible"
        type="button"
        class="shrink-0 rounded-md p-1 transition hover:bg-white/10"
        style="color: var(--text-secondary)"
        :aria-label="lang === 'en' ? 'Dismiss beta banner' : 'Masquer le bandeau bêta pour cette session'"
        @click="dismiss"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'
import { BETA_FEEDBACK_FORM_URL } from '../logo'

export interface BetaTesterBannerProps {
  lang?: 'fr' | 'en'
  formUrl?: string
  dismissible?: boolean
  storageKey?: string
}

const props = withDefaults(defineProps<BetaTesterBannerProps>(), {
  lang: 'fr',
  formUrl: BETA_FEEDBACK_FORM_URL,
  dismissible: true,
  storageKey: 'olydor_beta_banner_dismissed',
})

const isDismissed = ref(false)

onMounted(() => {
  if (typeof window !== 'undefined' && props.dismissible) {
    try {
      isDismissed.value = window.sessionStorage.getItem(props.storageKey) === '1'
    } catch {
      isDismissed.value = false
    }
  }
})

function dismiss() {
  isDismissed.value = true
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(props.storageKey, '1')
    } catch {
      // ignore storage errors in restricted contexts
    }
  }
}
</script>
