<script setup lang="ts">
import { ref } from 'vue'
import type { ActionableAlert } from '../types/pokemon-tcg'
import { 
  AlertTriangle, 
  ShieldAlert, 
  CheckCircle2, 
  Info, 
  Lightbulb,
  Copy,
  Check
} from 'lucide-vue-next'

const props = defineProps<{
  alert: ActionableAlert
  deckName: string
  opponentName: string
}>()

const isCopied = ref(false)

const copyFeedback = () => {
  const text = `[PokéPulse Arena] Diagnostic ${props.deckName} VS ${props.opponentName}:\n${props.alert.headline}\n${props.alert.detail}\nRecommandation : ${props.alert.recommendation}`
  navigator.clipboard.writeText(text)
  isCopied.value = true
  setTimeout(() => {
    isCopied.value = false
  }, 2000)
}
</script>

<template>
  <div 
    :class="[
      'rounded-2xl p-5 md:p-6 border transition-all duration-300 shadow-xl relative overflow-hidden',
      alert.type === 'danger' ? 'bg-rose-950/20 border-rose-500/40 glow-border-rose' :
      alert.type === 'warning' ? 'bg-amber-950/20 border-amber-500/40 glow-border-amber' :
      alert.type === 'success' ? 'bg-emerald-950/20 border-emerald-500/40 glow-border-emerald' :
      'bg-indigo-950/20 border-indigo-500/40 glow-border'
    ]"
  >
    <!-- Background glow orb -->
    <div 
      :class="[
        'absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-20',
        alert.type === 'danger' ? 'bg-rose-500' :
        alert.type === 'warning' ? 'bg-amber-500' :
        alert.type === 'success' ? 'bg-emerald-500' : 'bg-indigo-500'
      ]"
    />

    <div class="relative z-10 space-y-4">
      <!-- Top header line with icon, stat highlight and copy button -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <div 
            :class="[
              'p-2 rounded-xl border',
              alert.type === 'danger' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' :
              alert.type === 'warning' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
              alert.type === 'success' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
              'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
            ]"
          >
            <ShieldAlert v-if="alert.type === 'danger'" class="w-5 h-5" />
            <AlertTriangle v-else-if="alert.type === 'warning'" class="w-5 h-5" />
            <CheckCircle2 v-else-if="alert.type === 'success'" class="w-5 h-5" />
            <Info v-else class="w-5 h-5" />
          </div>

          <div>
            <span 
              :class="[
                'text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border',
                alert.type === 'danger' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                alert.type === 'warning' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                alert.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
              ]"
            >
              {{ alert.type === 'danger' ? 'Alerte Critique Matchup' : alert.type === 'warning' ? 'Point d\'Attention Tactique' : 'Constat Positif' }}
            </span>
            <span class="ml-2 font-mono text-xs font-bold text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-700">
              {{ alert.statHighlight }}
            </span>
          </div>
        </div>

        <!-- Copy feedback button for user testing -->
        <button
          type="button"
          @click="copyFeedback"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors shadow-sm"
        >
          <component :is="isCopied ? Check : Copy" class="w-3.5 h-3.5" :class="{ 'text-emerald-400': isCopied }" />
          <span>{{ isCopied ? 'Copié dans le presse-papier !' : 'Copier ce diagnostic' }}</span>
        </button>
      </div>

      <!-- Headline & Detail -->
      <div>
        <h4 class="text-base font-extrabold text-white leading-snug">
          {{ alert.headline }}
        </h4>
        <p class="text-xs sm:text-sm text-slate-300 mt-1.5 leading-relaxed">
          {{ alert.detail }}
        </p>
      </div>

      <!-- Tactical Recommendation Box -->
      <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-3">
        <div class="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0 mt-0.5">
          <Lightbulb class="w-4 h-4" />
        </div>
        <div class="text-xs space-y-0.5">
          <span class="font-bold text-amber-300 uppercase tracking-wider text-[10px]">
            Recommandation de jeu compétitif :
          </span>
          <p class="text-slate-300 leading-relaxed">
            {{ alert.recommendation }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
