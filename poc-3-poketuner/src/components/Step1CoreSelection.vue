<script setup lang="ts">
import { ref, computed } from 'vue'
import { Archetype, CardCategory } from '../types/deck'
import {
  Lock,
  ArrowRight,
  Search,
  CheckCircle,
  SlidersHorizontal
} from 'lucide-vue-next'

const props = defineProps<{
  archetypes: Archetype[]
  selectedArchetypeId: string
}>()

const emit = defineEmits<{
  (e: 'selectArchetype', id: string): void
  (e: 'nextStep'): void
}>()

const activeCategoryFilter = ref<string>('all')
const searchQuery = ref<string>('')

const activeArchetype = computed(() => {
  return props.archetypes.find(a => a.id === props.selectedArchetypeId) || props.archetypes[0]
})

// Group core cards by category
const categoryLabels: Record<CardCategory, { label: string; color: string }> = {
  pokemon: { label: 'Pokémon', color: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' },
  supporter: { label: 'Supporters', color: 'border-amber-500/40 text-amber-400 bg-amber-500/10' },
  item: { label: 'Objets', color: 'border-cyan-500/40 text-cyan-400 bg-cyan-500/10' },
  ace_spec: { label: 'ACE SPEC', color: 'border-pink-500/60 text-pink-300 bg-pink-500/20' },
  tool: { label: 'Outils Pokémon', color: 'border-purple-500/40 text-purple-400 bg-purple-500/10' },
  stadium: { label: 'Stades', color: 'border-indigo-500/40 text-indigo-400 bg-indigo-500/10' },
  energy: { label: 'Énergies de base', color: 'border-yellow-500/40 text-yellow-300 bg-yellow-500/10' },
}

const filteredCoreCards = computed(() => {
  let list = activeArchetype.value.coreCards
  if (activeCategoryFilter.value !== 'all') {
    list = list.filter(card => card.category === activeCategoryFilter.value)
  }
  if (searchQuery.value.trim() !== '') {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(
      c => c.name.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q) || (c.roleDescription && c.roleDescription.toLowerCase().includes(q))
    )
  }
  return list
})

const totalCoreCardsCount = computed(() => {
  return activeArchetype.value.coreCards.reduce((acc, c) => acc + c.count, 0)
})

const pokemonCount = computed(() => {
  return activeArchetype.value.coreCards.filter(c => c.category === 'pokemon').reduce((a, b) => a + b.count, 0)
})

const trainersCount = computed(() => {
  return activeArchetype.value.coreCards.filter(c => ['supporter', 'item', 'tool', 'stadium', 'ace_spec'].includes(c.category)).reduce((a, b) => a + b.count, 0)
})

const energyCount = computed(() => {
  return activeArchetype.value.coreCards.filter(c => c.category === 'energy').reduce((a, b) => a + b.count, 0)
})
</script>

<template>
  <div class="space-y-6">
    <!-- Top introduction banner -->
    <div class="bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
      <div class="absolute -right-16 -top-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>
      
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
        <div>
          <div class="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold mb-2">
            <Lock class="w-3.5 h-3.5" />
            <span>Étape 1 sur 3 • Invariant de deck (Wizard of Oz)</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight">
            Sélectionnez votre Squelette Tactique ("Core Deck")
          </h2>
          <p class="text-slate-400 text-sm mt-1 max-w-3xl leading-relaxed">
            Verrouillez les <span class="text-slate-200 font-semibold">{{ activeArchetype.coreCount }} cartes indispensables</span> de votre moteur.
            Les <span class="text-amber-400 font-semibold font-mono">{{ activeArchetype.flexSlotsCount }} slots restants</span> (Flex Slots)
            seront calculés par notre algorithme heuristique pour maximiser vos chances face à la salle.
          </p>
        </div>

        <button
          type="button"
          @click="emit('nextStep')"
          class="shrink-0 inline-flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all shadow-lg shadow-amber-500/20 hover:scale-[1.02] active:scale-[0.98]"
        >
          <span>Valider et configurer le méta</span>
          <ArrowRight class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Archetype Selector Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="archetype in archetypes"
        :key="archetype.id"
        @click="emit('selectArchetype', archetype.id)"
        :class="[
          'cursor-pointer relative p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between group',
          selectedArchetypeId === archetype.id
            ? 'bg-slate-900/90 border-amber-500 shadow-xl shadow-amber-500/10 ring-1 ring-amber-500/30'
            : 'bg-slate-900/40 border-slate-800 hover:border-slate-700 hover:bg-slate-900/70'
        ]"
      >
        <!-- Top bar with Badge and Selection Radio -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <span
              :class="[
                'text-[11px] font-mono uppercase tracking-wider font-semibold px-2.5 py-1 rounded-md border',
                archetype.id === 'dragapult-xatu'
                  ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                  : 'bg-orange-500/10 text-orange-300 border-orange-500/30'
              ]"
            >
              {{ archetype.tier }}
            </span>

            <div class="flex items-center space-x-2">
              <span
                :class="[
                  'w-5 h-5 rounded-full border flex items-center justify-center transition-colors',
                  selectedArchetypeId === archetype.id
                    ? 'border-amber-500 bg-amber-500 text-slate-950'
                    : 'border-slate-700 bg-slate-800 group-hover:border-slate-600'
                ]"
              >
                <CheckCircle v-if="selectedArchetypeId === archetype.id" class="w-3.5 h-3.5 stroke-[3]" />
              </span>
            </div>
          </div>

          <h3 class="text-xl font-bold text-white group-hover:text-amber-400 transition-colors">
            {{ archetype.name }}
          </h3>
          <p class="text-xs font-mono text-slate-400 mt-0.5">
            {{ archetype.nameEn }} • {{ archetype.subname }}
          </p>

          <p class="text-xs text-slate-300 mt-3 leading-relaxed">
            {{ archetype.description }}
          </p>
        </div>

        <!-- Metric Badges & Slots Breakdown -->
        <div class="mt-5 pt-4 border-t border-slate-800/80">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-slate-950/60 rounded-lg p-2 border border-slate-800/60">
              <span class="block text-[10px] text-slate-400 uppercase font-mono">Squelette fixe</span>
              <span class="text-base font-bold font-mono text-slate-200">{{ archetype.coreCount }} <span class="text-xs font-normal text-slate-500">cartes</span></span>
            </div>
            <div class="bg-slate-950/60 rounded-lg p-2 border border-amber-500/30 bg-amber-500/5">
              <span class="block text-[10px] text-amber-400 uppercase font-mono font-semibold">Flex Slots</span>
              <span class="text-base font-bold font-mono text-amber-400">{{ archetype.flexSlotsCount }} <span class="text-xs font-normal text-amber-400/70">à régler</span></span>
            </div>
            <div class="bg-slate-950/60 rounded-lg p-2 border border-slate-800/60">
              <span class="block text-[10px] text-slate-400 uppercase font-mono">Setup T2 Base</span>
              <span class="text-base font-bold font-mono text-emerald-400">{{ archetype.baseStats.turn2SetupRate }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Detailed Deck Explorer: Core Cards vs Candidate Pool -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      <!-- Left Column (7 cols): The 46/47 Locked Cards (Untouchable Skeleton) -->
      <div class="lg:col-span-7 bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div class="flex items-center space-x-2">
            <div class="p-2 rounded-lg bg-slate-800 text-slate-300">
              <Lock class="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 class="text-base font-bold text-white flex items-center space-x-2">
                <span>Squelette Verrouillé (Intouchable)</span>
                <span class="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-slate-800 text-amber-400 border border-slate-700">
                  {{ totalCoreCardsCount }} cartes
                </span>
              </h3>
              <p class="text-xs text-slate-400">
                Structure fixe garantie de {{ activeArchetype.name }}
              </p>
            </div>
          </div>

          <!-- Mini stats pills -->
          <div class="flex items-center space-x-2 text-xs font-mono">
            <span class="px-2 py-1 rounded bg-slate-800/80 text-emerald-300 border border-emerald-500/20">
              {{ pokemonCount }} Poké
            </span>
            <span class="px-2 py-1 rounded bg-slate-800/80 text-cyan-300 border border-cyan-500/20">
              {{ trainersCount }} Dresseurs
            </span>
            <span class="px-2 py-1 rounded bg-slate-800/80 text-yellow-300 border border-yellow-500/20">
              {{ energyCount }} Énergies
            </span>
          </div>
        </div>

        <!-- Filter bar -->
        <div class="flex flex-col sm:flex-row gap-2 mb-3">
          <div class="relative flex-1">
            <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Filtrer une carte ou un rôle..."
              class="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60"
            />
          </div>
          <select
            v-model="activeCategoryFilter"
            class="bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500/60"
          >
            <option value="all">Toutes catégories</option>
            <option value="pokemon">Pokémon ({{ activeArchetype.coreCards.filter(c => c.category === 'pokemon').reduce((a,b)=>a+b.count,0) }})</option>
            <option value="supporter">Supporters</option>
            <option value="item">Objets</option>
            <option value="ace_spec">ACE SPEC</option>
            <option value="tool">Outils & Stades</option>
            <option value="energy">Énergies de base</option>
          </select>
        </div>

        <!-- Card List Table / Cards -->
        <div class="space-y-1.5 overflow-y-auto max-h-[460px] pr-1">
          <div
            v-for="card in filteredCoreCards"
            :key="card.id"
            class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 transition-colors"
          >
            <div class="flex items-center space-x-3 min-w-0">
              <!-- Count badge -->
              <span class="w-7 h-7 rounded-lg bg-slate-900 border border-slate-700/80 text-amber-400 font-mono font-bold text-xs flex items-center justify-center shrink-0 shadow-inner">
                {{ card.count }}×
              </span>

              <div class="min-w-0">
                <div class="flex items-center space-x-2">
                  <span class="text-xs font-semibold text-slate-200 truncate">{{ card.name }}</span>
                  <span class="text-[10px] text-slate-500 font-mono hidden sm:inline">({{ card.nameEn }})</span>
                  <span
                    :class="[
                      'text-[9px] font-mono px-1.5 py-0.2 rounded border uppercase font-medium',
                      categoryLabels[card.category]?.color || 'border-slate-700 text-slate-400'
                    ]"
                  >
                    {{ categoryLabels[card.category]?.label || card.category }}
                  </span>
                </div>
                <p v-if="card.roleDescription" class="text-[11px] text-slate-400 truncate mt-0.5">
                  {{ card.roleDescription }}
                </p>
              </div>
            </div>

            <!-- Set & number -->
            <div class="text-[11px] font-mono text-slate-500 shrink-0 ml-2">
              {{ card.set }} #{{ card.number }}
            </div>
          </div>

          <div v-if="filteredCoreCards.length === 0" class="text-center py-8 text-slate-500 text-xs">
            Aucune carte ne correspond à votre filtre.
          </div>
        </div>

        <div class="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
          <span class="flex items-center space-x-1.5">
            <Lock class="w-3.5 h-3.5 text-slate-500" />
            <span>Ces cartes sont non modifiables afin de préserver l'identité de l'archétype.</span>
          </span>
          <span class="font-mono text-slate-400">Total: {{ totalCoreCardsCount }}/60</span>
        </div>
      </div>

      <!-- Right Column (5 cols): Pool of Candidate Cards for the Flex Slots -->
      <div class="lg:col-span-5 bg-slate-900/60 border border-amber-500/20 rounded-2xl p-5 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center space-x-2">
              <div class="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <SlidersHorizontal class="w-4 h-4" />
              </div>
              <div>
                <h3 class="text-base font-bold text-white flex items-center space-x-2">
                  <span>Pool de Cartes Candidates</span>
                </h3>
                <p class="text-xs text-amber-400/90 font-mono">
                  {{ activeArchetype.flexSlotsCount }} slots libres à distribuer
                </p>
              </div>
            </div>

            <span class="text-xs font-mono px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold">
              {{ activeArchetype.candidates.length }} cartes candidates
            </span>
          </div>

          <p class="text-xs text-slate-300 mb-4 leading-relaxed bg-slate-950/60 border border-slate-800 p-3 rounded-xl">
            💡 <strong class="text-white">Principe du POC :</strong> 85,4 % des joueurs règlent ces cartes "au feeling".
            L'algorithme va explorer toutes les combinaisons respectant les bornes [Min - Max] pour trouver la formule mathématiquement optimale face à votre salle.
          </p>

          <!-- Candidate cards list with min-max and standard reference -->
          <div class="space-y-2.5 overflow-y-auto max-h-[380px] pr-1">
            <div
              v-for="candidate in activeArchetype.candidates"
              :key="candidate.id"
              class="p-3 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition-colors"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                  <span class="font-bold text-xs text-slate-100">{{ candidate.name }}</span>
                  <span class="text-[10px] text-slate-500 font-mono hidden sm:inline">({{ candidate.nameEn }})</span>
                </div>

                <!-- Bounds badge -->
                <div class="flex items-center space-x-1.5 font-mono text-xs">
                  <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300" title="Fourchette autorisée">
                    [{{ candidate.minCount }} - {{ candidate.maxCount }}]
                  </span>
                  <span class="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 font-semibold text-[11px]" title="Ratio standard sur Limitless">
                    Std : {{ candidate.standardCount }}
                  </span>
                </div>
              </div>

              <p class="text-[11px] text-slate-400 mt-1">
                {{ candidate.role }}
              </p>

              <div class="mt-2 text-[10px] text-amber-400/90 font-mono flex items-center space-x-1">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span>
                <span>{{ candidate.impactText }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Call to action button to step 2 -->
        <div class="mt-6 pt-4 border-t border-slate-800/80">
          <button
            type="button"
            @click="emit('nextStep')"
            class="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold transition-all shadow-lg shadow-amber-500/10"
          >
            <span>Passer à l'Étape 2 : Configurer les Curseurs Tournoi</span>
            <ArrowRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
