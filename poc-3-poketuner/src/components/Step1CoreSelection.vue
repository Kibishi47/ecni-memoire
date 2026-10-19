<script setup lang="ts">
import { ref } from 'vue'
import { Archetype } from '../types/deck'
import { Check, ArrowRight, Flame, Zap, ChevronDown, ChevronUp } from 'lucide-vue-next'

defineProps<{
  archetypes: Archetype[]
  selectedArchetypeId: string
}>()

const emit = defineEmits<{
  (e: 'selectArchetype', id: string): void
  (e: 'nextStep'): void
}>()

const showFixedCards = ref<boolean>(false)

function getArchetypeIcon(iconName: string) {
  return iconName === 'Flame' ? Flame : Zap
}
</script>

<template>
  <div class="space-y-6">
    <!-- Screen Header -->
    <div class="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
      <h2 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
        1. Choisissez la base de votre deck
      </h2>
      <p class="text-slate-600 text-sm sm:text-base mt-2 leading-relaxed">
        L'outil va calculer le nombre idéal de cartes de recherche et d'énergies pour compléter votre liste.
      </p>

      <!-- The 2 Large Clickable Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        <div
          v-for="archetype in archetypes"
          :key="archetype.id"
          @click="emit('selectArchetype', archetype.id)"
          :class="[
            'cursor-pointer rounded-2xl p-6 border-2 transition-all flex flex-col justify-between group relative text-left',
            selectedArchetypeId === archetype.id
              ? 'border-blue-600 bg-blue-50/40 shadow-md ring-2 ring-blue-600/10'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
          ]"
        >
          <div>
            <!-- Top bar with Icon & Checkmark -->
            <div class="flex items-center justify-between mb-4">
              <div
                :class="[
                  'w-11 h-11 rounded-xl flex items-center justify-center transition-colors',
                  selectedArchetypeId === archetype.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                ]"
              >
                <component :is="getArchetypeIcon(archetype.iconName)" class="w-6 h-6" />
              </div>

              <!-- Radio / checkmark -->
              <div
                :class="[
                  'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
                  selectedArchetypeId === archetype.id
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white'
                ]"
              >
                <Check v-if="selectedArchetypeId === archetype.id" class="w-4 h-4 stroke-[3]" />
              </div>
            </div>

            <!-- Title & Key Metric -->
            <h3 class="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              {{ archetype.name }}
            </h3>
            
            <p class="text-sm text-slate-500 mt-1">
              {{ archetype.subtitle }}
            </p>

            <div class="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div class="text-xs text-slate-500 font-medium">
                {{ archetype.coreCount }} cartes principales fixées
              </div>
              <div class="text-sm font-bold text-blue-700 mt-0.5">
                ➔ {{ archetype.flexSlotsCount }} places à optimiser
              </div>
            </div>

            <p class="text-xs text-slate-600 mt-3 leading-relaxed">
              {{ archetype.description }}
            </p>
          </div>

          <!-- Bottom card count badge -->
          <div class="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Total du deck final : 60 cartes</span>
            <span class="font-semibold text-blue-600 group-hover:underline">Sélectionner</span>
          </div>
        </div>
      </div>

      <!-- Action Button: Continuer -->
      <div class="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
        <!-- Optional detail drawer button -->
        <button
          type="button"
          @click="showFixedCards = !showFixedCards"
          class="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center space-x-1.5 transition-colors"
        >
          <span>{{ showFixedCards ? 'Masquer le détail des cartes fixes' : 'Voir les cartes fixes de base' }}</span>
          <component :is="showFixedCards ? ChevronUp : ChevronDown" class="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          @click="emit('nextStep')"
          class="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-8 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-sm transition-all shadow-sm hover:shadow"
        >
          <span>Continuer</span>
          <ArrowRight class="w-4 h-4" />
        </button>
      </div>

      <!-- Collapsible Fixed Cards View -->
      <div v-if="showFixedCards" class="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
          Cartes fixées dans ce squelette :
        </h4>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-600">
          <div
            v-for="card in archetypes.find(a => a.id === selectedArchetypeId)?.coreCards"
            :key="card.id"
            class="p-1.5 bg-white rounded border border-slate-200 truncate"
          >
            <span class="font-bold text-slate-900">{{ card.count }}×</span> {{ card.name }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
