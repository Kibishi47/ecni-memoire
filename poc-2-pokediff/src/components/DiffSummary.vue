<script setup lang="ts">
import { GitCompare, Plus, Minus, CheckCircle, AlertTriangle } from 'lucide-vue-next'
import type { DeckDiff } from '../types/deck'

defineProps<{
  diffs: DeckDiff[]
  deckACount: number
  deckBCount: number
  isValid: boolean
}>()

const emit = defineEmits<{
  (e: 'sync-b-to-a'): void
}>()
</script>

<template>
  <div class="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg backdrop-blur-sm">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      <div class="flex items-center space-x-2">
        <GitCompare class="w-5 h-5 text-indigo-400" />
        <h3 class="text-sm font-bold text-slate-100 uppercase tracking-wider">
          Diff Résumé (Variante A → Variante B)
        </h3>
        <span class="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
          {{ diffs.length }} modification{{ diffs.length > 1 ? 's' : '' }}
        </span>
      </div>

      <!-- Legal 60/60 Format Validator -->
      <div class="flex items-center space-x-2">
        <div
          v-if="isValid"
          class="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-medium shadow-sm"
        >
          <CheckCircle class="w-3.5 h-3.5 text-emerald-400" />
          <span>Format Légal 60/60 cartes</span>
        </div>
        <div
          v-else
          class="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-rose-950/90 border border-rose-500/50 text-rose-300 text-xs font-medium animate-pulse shadow-sm"
        >
          <AlertTriangle class="w-3.5 h-3.5 text-rose-400" />
          <span>
            {{ deckBCount < 60 ? `Il manque ${60 - deckBCount} carte(s)` : `${deckBCount - 60} carte(s) en trop` }}
            (Total B : {{ deckBCount }}/60)
          </span>
        </div>
      </div>
    </div>

    <!-- Diffs Visual Feed -->
    <div v-if="diffs.length > 0" class="space-y-2">
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        <div
          v-for="diff in diffs"
          :key="diff.cardId"
          class="flex items-center justify-between p-2.5 rounded-xl border font-mono text-xs transition"
          :class="
            diff.delta > 0
              ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-300'
              : 'bg-rose-950/30 border-rose-700/50 text-rose-300'
          "
        >
          <div class="flex items-center space-x-2 truncate">
            <span
              class="w-5 h-5 rounded flex items-center justify-center font-bold text-xs"
              :class="diff.delta > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'"
            >
              <Plus v-if="diff.delta > 0" class="w-3.5 h-3.5" />
              <Minus v-else class="w-3.5 h-3.5" />
            </span>
            <div class="truncate">
              <span class="font-semibold block truncate">{{ diff.cardName }}</span>
              <span class="text-[10px] text-slate-400 font-sans block truncate">
                {{ diff.from }} → {{ diff.to }} ex. ({{ diff.delta > 0 ? `+${diff.delta}` : diff.delta }})
              </span>
            </div>
          </div>
          <span
            class="ml-2 px-1.5 py-0.5 rounded text-[11px] font-bold"
            :class="diff.delta > 0 ? 'bg-emerald-500/30 text-emerald-300' : 'bg-rose-500/30 text-rose-300'"
          >
            {{ diff.delta > 0 ? `+${diff.delta}` : diff.delta }}
          </span>
        </div>
      </div>

      <!-- Quick Summary Footer -->
      <div class="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div class="flex items-center space-x-4 font-mono">
          <span>
            Retirées :
            <strong class="text-rose-400">
              {{ diffs.filter(d => d.delta < 0).reduce((acc, d) => acc + Math.abs(d.delta), 0) }}
            </strong>
          </span>
          <span>
            Ajoutées :
            <strong class="text-emerald-400">
              {{ diffs.filter(d => d.delta > 0).reduce((acc, d) => acc + d.delta, 0) }}
            </strong>
          </span>
          <span>
            Balance Nette :
            <strong
              :class="
                diffs.reduce((acc, d) => acc + d.delta, 0) === 0 ? 'text-emerald-400' : 'text-rose-400'
              "
            >
              {{ diffs.reduce((acc, d) => acc + d.delta, 0) > 0 ? '+' : '' }}{{ diffs.reduce((acc, d) => acc + d.delta, 0) }} cartes
            </strong>
          </span>
        </div>

        <button
          @click="emit('sync-b-to-a')"
          type="button"
          class="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-4 transition"
        >
          Annuler tous les changements
        </button>
      </div>
    </div>

    <!-- Empty state (A = B) -->
    <div
      v-else
      class="text-center py-5 border border-dashed border-slate-800 rounded-xl bg-slate-900/40 text-slate-400 text-xs"
    >
      <p class="font-medium text-slate-300">Variante B identique à la référence A (Aucun changement actif)</p>
      <p class="text-[11px] text-slate-500 mt-0.5">
        Choisissez l'un des 3 Scénarios ci-dessus ou ajustez les quantités avec [+] / [-] dans la liste des cartes.
      </p>
    </div>
  </div>
</template>
