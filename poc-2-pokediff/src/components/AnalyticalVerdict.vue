<script setup lang="ts">
import { Bot, Lightbulb, Scale, ShieldCheck, AlertCircle } from 'lucide-vue-next'

defineProps<{
  verdict: {
    summary: string
    strategicRecommendation: string
    confidenceScore: number
    keyTradeOff: string
    archetypeFocus: string
  }
  isValid: boolean
}>()
</script>

<template>
  <div class="relative rounded-2xl p-6 bg-gradient-to-br from-slate-900 via-indigo-950/30 to-slate-900 border border-indigo-500/40 shadow-2xl overflow-hidden backdrop-blur-md">
    <!-- Ambient decorative light -->
    <div class="absolute top-0 right-0 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>

    <div class="relative z-10 space-y-4">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-900/50 pb-3">
        <div class="flex items-center space-x-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/60 flex items-center justify-center text-indigo-400">
            <Bot class="w-4 h-4" />
          </div>
          <div>
            <h2 class="text-sm font-extrabold uppercase tracking-wider text-slate-100">
              Verdict Analytique Automatisé (Synthèse d'Aide à la Décision)
            </h2>
            <p class="text-[11px] text-slate-400">
              Moteur d'arbitrage basé sur la comparaison couplée de 10 000 tirages
            </p>
          </div>
        </div>

        <!-- Confidence Badge -->
        <div v-if="isValid" class="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono">
          <ShieldCheck class="w-3.5 h-3.5 text-emerald-400" />
          <span>Confiance Statistique : {{ verdict.confidenceScore }}%</span>
        </div>
      </div>

      <!-- Main Narrative Quotation -->
      <div class="p-4 rounded-xl bg-slate-950/80 border border-indigo-500/30 relative">
        <p class="text-sm sm:text-base text-slate-100 font-medium leading-relaxed">
          {{ verdict.summary }}
        </p>
      </div>

      <!-- Strategic Boxes (Recommendation & Trade-Off) -->
      <div v-if="isValid" class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <!-- Strategic Recommendation -->
        <div class="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-800/50 flex items-start space-x-3">
          <Lightbulb class="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 class="text-xs font-bold text-amber-300 uppercase tracking-wide">
              Conseil Stratégique de Ronde Suisse
            </h4>
            <p class="text-xs text-slate-300 mt-1 leading-normal">
              {{ verdict.strategicRecommendation }}
            </p>
          </div>
        </div>

        <!-- Math Trade-Off -->
        <div class="p-3.5 rounded-xl bg-violet-950/30 border border-violet-800/50 flex items-start space-x-3">
          <Scale class="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
          <div>
            <h4 class="text-xs font-bold text-violet-300 uppercase tracking-wide">
              Compromis de Micro-Ajustement
            </h4>
            <p class="text-xs text-slate-300 mt-1 leading-normal">
              {{ verdict.keyTradeOff }}
            </p>
          </div>
        </div>
      </div>

      <!-- Invalid deck warning -->
      <div
        v-else
        class="p-4 rounded-xl bg-rose-950/50 border border-rose-500/60 flex items-center space-x-3 text-rose-200 text-xs"
      >
        <AlertCircle class="w-5 h-5 text-rose-400 shrink-0" />
        <p>
          Le comparateur ne peut formuler de recommandation tant que le total de cartes de la Variante B n'est pas égal à 60/60.
        </p>
      </div>
    </div>
  </div>
</template>
