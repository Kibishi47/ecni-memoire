<script setup lang="ts">
import { ref } from 'vue'
import { X, Dna, ShieldCheck, CheckCircle2, XCircle } from 'lucide-vue-next'
import type { PairedSeedSample } from '../types/deck'

defineProps<{
  samples: PairedSeedSample[]
  isOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const activeTab = ref(0)
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md transition-opacity"
  >
    <div
      class="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
    >
      <!-- Modal Header -->
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div class="flex items-center space-x-3">
          <div class="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400">
            <Dna class="w-4 h-4" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-white uppercase tracking-wider">
              Inspecteur de Graines ("Same-Seed Proof Viewer")
            </h3>
            <p class="text-xs text-slate-400">
              Vérification concrète des distributions 1-à-1 sur la même séquence RNG.
            </p>
          </div>
        </div>

        <button
          @click="emit('close')"
          type="button"
          class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Seed Selector Tabs -->
      <div class="px-6 py-3 border-b border-slate-800 bg-slate-950/30 flex items-center space-x-2 overflow-x-auto">
        <button
          v-for="(sample, idx) in samples"
          :key="sample.seedHash"
          @click="activeTab = idx"
          type="button"
          class="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition border"
          :class="
            activeTab === idx
              ? 'bg-indigo-600 border-indigo-500 text-white shadow'
              : 'bg-slate-800/70 border-slate-700 text-slate-400 hover:text-slate-200'
          "
        >
          Partie #{{ sample.seedIndex }} ({{ sample.seedHash }})
        </button>
      </div>

      <!-- Active Seed Content Body -->
      <div v-if="samples[activeTab]" class="p-6 overflow-y-auto space-y-5">
        <!-- Impact Explanation Callout -->
        <div class="p-4 rounded-xl bg-indigo-950/40 border border-indigo-700/50 flex items-center justify-between">
          <div>
            <span class="text-xs font-mono text-indigo-300 font-bold block mb-1">
              Analyse Couplée sur cette Graine Aléatoire :
            </span>
            <p class="text-sm text-slate-200 font-medium">
              {{ samples[activeTab].outcomeDiff }}
            </p>
          </div>
          <span class="text-xs font-mono px-3 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
            {{ samples[activeTab].seedHash }}
          </span>
        </div>

        <!-- Side-by-Side Hand & Prizes Comparison -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Deck A (Reference) -->
          <div class="p-4 rounded-xl bg-slate-950/70 border border-sky-500/30 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-sky-400 font-mono uppercase">
                Variante A (Référence)
              </span>
              <span
                class="text-[11px] font-mono px-2 py-0.5 rounded flex items-center space-x-1"
                :class="
                  samples[activeTab].deckAT1BenchCount >= 2
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-rose-950 text-rose-300 border border-rose-700'
                "
              >
                <CheckCircle2 v-if="samples[activeTab].deckAT1BenchCount >= 2" class="w-3 h-3 mr-1" />
                <XCircle v-else class="w-3 h-3 mr-1" />
                <span>{{ samples[activeTab].deckAT1BenchCount >= 2 ? 'Sortie T1 Réussie' : 'Échec Setup T1' }}</span>
              </span>
            </div>

            <!-- Hand Cards -->
            <div>
              <span class="text-[11px] font-mono text-slate-400 block mb-1">
                Main de départ (7 cartes + Pioche T1) :
              </span>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(card, i) in samples[activeTab].deckAHand"
                  :key="i"
                  class="px-2 py-1 rounded bg-slate-800/90 border border-slate-700 text-[11px] font-sans text-slate-200 font-medium"
                >
                  {{ card }}
                </span>
              </div>
            </div>

            <!-- Prizes -->
            <div>
              <span class="text-[11px] font-mono text-slate-500 block mb-1">
                6 Cartes Récompenses (Identiques) :
              </span>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(card, i) in samples[activeTab].deckAPrizes"
                  :key="i"
                  class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400"
                >
                  {{ card }}
                </span>
              </div>
            </div>
          </div>

          <!-- Deck B (Variant) -->
          <div class="p-4 rounded-xl bg-slate-950/70 border border-violet-500/40 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-violet-400 font-mono uppercase">
                Variante B (Micro-ajustée)
              </span>
              <span
                class="text-[11px] font-mono px-2 py-0.5 rounded flex items-center space-x-1"
                :class="
                  samples[activeTab].deckBT1BenchCount >= 2
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-rose-950 text-rose-300 border border-rose-700'
                "
              >
                <CheckCircle2 v-if="samples[activeTab].deckBT1BenchCount >= 2" class="w-3 h-3 mr-1" />
                <XCircle v-else class="w-3 h-3 mr-1" />
                <span>{{ samples[activeTab].deckBT1BenchCount >= 2 ? 'Sortie T1 Réussie' : 'Échec Setup T1' }}</span>
              </span>
            </div>

            <!-- Hand Cards -->
            <div>
              <span class="text-[11px] font-mono text-slate-400 block mb-1">
                Main de départ (7 cartes + Pioche T1) :
              </span>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(card, i) in samples[activeTab].deckBHand"
                  :key="i"
                  class="px-2 py-1 rounded text-[11px] font-sans font-medium border"
                  :class="
                    !samples[activeTab].deckAHand.includes(card)
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 font-bold'
                      : 'bg-slate-800/90 border-slate-700 text-slate-200'
                  "
                >
                  {{ card }}
                </span>
              </div>
            </div>

            <!-- Prizes -->
            <div>
              <span class="text-[11px] font-mono text-slate-500 block mb-1">
                6 Cartes Récompenses (Identiques) :
              </span>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="(card, i) in samples[activeTab].deckBPrizes"
                  :key="i"
                  class="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-400"
                >
                  {{ card }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Educational note -->
        <div class="text-xs text-slate-400 border-t border-slate-800 pt-3 flex items-center space-x-2">
          <ShieldCheck class="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            Le Same-Seed testing élimine le biais de chance : les deux joueurs affrontent la même séquence de tirage, isolant ainsi la valeur mathématique pure du micro-ajustement.
          </span>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
        <button
          @click="emit('close')"
          type="button"
          class="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition"
        >
          Fermer l'Inspecteur
        </button>
      </div>
    </div>
  </div>
</template>
