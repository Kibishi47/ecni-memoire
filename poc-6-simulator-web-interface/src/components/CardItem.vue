<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { InPlayPokemon } from '../core/engine'
import { getPokemonMaxHp, getRemainingHp } from '../core/engine'
import { getCardImageUrl, getCategoryBadge, getTypeVisual } from '../utils/cardUiHelpers'
import { Info, Zap } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    card?: EngineCardModel | null
    inPlayPokemon?: InPlayPokemon | null
    isFaceDown?: boolean
    isPlayable?: boolean
    playableActionCount?: number
    isSelected?: boolean
    size?: 'sm' | 'md' | 'lg'
    clickable?: boolean
    showSlotLabel?: string
    isOpponent?: boolean
  }>(),
  {
    card: null,
    inPlayPokemon: null,
    isFaceDown: false,
    isPlayable: false,
    playableActionCount: 0,
    isSelected: false,
    size: 'md',
    clickable: true,
    showSlotLabel: '',
    isOpponent: false,
  },
)

const emit = defineEmits<{
  (e: 'click'): void
  (e: 'inspect'): void
}>()

const imageError = ref(false)

const effectiveCard = computed<EngineCardModel | null>(() => {
  if (props.inPlayPokemon) return props.inPlayPokemon.card
  return props.card
})

const imageUrl = computed<string | null>(() => {
  if (!effectiveCard.value) return null
  return getCardImageUrl(effectiveCard.value.identity.imageUrl)
})

const maxHp = computed<number>(() => {
  if (props.inPlayPokemon) return getPokemonMaxHp(props.inPlayPokemon)
  return effectiveCard.value?.pokemonStats?.hp ?? 0
})

const currentHp = computed<number>(() => {
  if (props.inPlayPokemon) return getRemainingHp(props.inPlayPokemon)
  return maxHp.value
})

const damageTaken = computed<number>(() => {
  if (props.inPlayPokemon) return props.inPlayPokemon.damage
  return 0
})

const hpPercentage = computed<number>(() => {
  if (maxHp.value <= 0) return 100
  return Math.max(0, Math.min(100, (currentHp.value / maxHp.value) * 100))
})

const hpColorClass = computed<string>(() => {
  if (hpPercentage.value > 50) return 'bg-emerald-500'
  if (hpPercentage.value > 20) return 'bg-amber-500'
  return 'bg-red-500'
})

const mainType = computed<string>(() => {
  if (effectiveCard.value?.category === 'POKEMON' && effectiveCard.value.pokemonStats?.types?.[0]) {
    return effectiveCard.value.pokemonStats.types[0]
  }
  if (effectiveCard.value?.category === 'ENERGY') {
    return effectiveCard.value.identity.nameFr
  }
  return 'incolore'
})

const typeVisual = computed(() => getTypeVisual(mainType.value))

const categoryBadge = computed(() => {
  if (!effectiveCard.value) return { label: 'Carte', bg: 'bg-slate-500', text: 'text-white' }
  return getCategoryBadge(effectiveCard.value)
})

// Regroupement des énergies attachées par type
const attachedEnergySummary = computed(() => {
  if (!props.inPlayPokemon || props.inPlayPokemon.attachedEnergies.length === 0) return []
  const counts: Record<string, number> = {}
  for (const en of props.inPlayPokemon.attachedEnergies) {
    const t = en.identity.nameFr
    counts[t] = (counts[t] || 0) + 1
  }
  return Object.entries(counts).map(([name, count]) => ({
    name,
    count,
    visual: getTypeVisual(name),
  }))
})

function handleClick() {
  if (props.clickable) {
    emit('click')
  }
}

function handleInspect(e: Event) {
  e.stopPropagation()
  emit('inspect')
}
</script>

<template>
  <!-- Carte Face Cachée (Dos de carte Pokémon) -->
  <div
    v-if="isFaceDown"
    @click="handleClick"
    :class="[
      'relative flex flex-col items-center justify-center rounded-xl border border-indigo-900 bg-gradient-to-br from-blue-900 via-indigo-950 to-slate-900 p-2 shadow-xs transition-all select-none',
      size === 'sm' ? 'h-24 w-16' : size === 'lg' ? 'h-44 w-32' : 'h-32 w-24',
      clickable ? 'cursor-pointer hover:scale-102 hover:shadow-md' : '',
    ]"
  >
    <!-- Motif Pokéball stylisé -->
    <div class="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-amber-400/80 bg-red-600/90 shadow-inner">
      <div class="absolute bottom-0 h-4 w-8 rounded-b-full bg-white/90"></div>
      <div class="z-10 h-2.5 w-2.5 rounded-full border border-slate-900 bg-white shadow-xs"></div>
    </div>
    <span class="mt-2 text-[9px] font-bold tracking-wider text-amber-300 uppercase">Poké TCG</span>
  </div>

  <!-- Carte Réelle -->
  <div
    v-else-if="effectiveCard"
    @click="handleClick"
    :class="[
      'group relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-xs transition-all select-none',
      isSelected ? 'ring-2 ring-blue-600 border-blue-600 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
      isPlayable ? 'ring-2 ring-emerald-500 border-emerald-500 shadow-emerald-100 shadow-md' : '',
      size === 'sm' ? 'w-24 min-h-[120px] text-[10px]' : size === 'lg' ? 'w-44 min-h-[220px] text-xs' : 'w-32 min-h-[160px] text-xs',
      clickable ? 'cursor-pointer hover:-translate-y-0.5' : '',
    ]"
  >
    <!-- Slot Label si actif/banc -->
    <div
      v-if="showSlotLabel"
      class="absolute top-1 left-1 z-20 rounded bg-slate-900/85 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase backdrop-blur-xs"
    >
      {{ showSlotLabel }}
    </div>

    <!-- Badge Jouable / Actions disponibles -->
    <div
      v-if="isPlayable"
      class="absolute top-1 right-1 z-20 flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-xs"
      title="Cette carte peut exécuter une action légale ce tour !"
    >
      <Zap class="h-2.5 w-2.5 fill-current" />
      <span>{{ playableActionCount > 1 ? playableActionCount : '' }}</span>
    </div>

    <!-- Bouton Inspecter au survol -->
    <button
      type="button"
      @click="handleInspect"
      class="absolute bottom-1 right-1 z-20 hidden rounded-md bg-white/90 p-1 text-slate-700 shadow-xs hover:bg-slate-900 hover:text-white group-hover:flex"
      title="Voir les détails de la carte"
    >
      <Info class="h-3 w-3" />
    </button>

    <!-- Zone Visuelle / Image -->
    <div
      class="relative flex w-full items-center justify-center overflow-hidden bg-slate-100"
      :class="size === 'sm' ? 'h-14' : size === 'lg' ? 'h-24' : 'h-18'"
    >
      <img
        v-if="imageUrl && !imageError"
        :src="imageUrl"
        :alt="effectiveCard.identity.nameFr"
        loading="lazy"
        class="h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-105"
        @error="imageError = true"
      />
      <!-- Fallback Visuel Stylisé quand pas d'image -->
      <div
        v-else
        class="flex h-full w-full flex-col items-center justify-center p-1 text-center"
        :class="effectiveCard.category === 'POKEMON' ? 'bg-gradient-to-br from-slate-100 to-slate-200' : effectiveCard.category === 'TRAINER' ? 'bg-amber-50' : 'bg-emerald-50'"
      >
        <span class="text-xl">{{ typeVisual.emoji }}</span>
        <span class="mt-0.5 line-clamp-1 font-mono text-[9px] font-semibold text-slate-600">
          {{ effectiveCard.identity.setName || effectiveCard.identity.setId }}
        </span>
      </div>

      <!-- Type Badge Icon pour Pokémon -->
      <div
        v-if="effectiveCard.category === 'POKEMON'"
        class="absolute bottom-1 left-1 flex items-center justify-center rounded-full px-1 py-0.5 text-[9px] font-bold shadow-xs"
        :class="[typeVisual.bg, typeVisual.text]"
      >
        <span>{{ typeVisual.emoji }}</span>
      </div>
    </div>

    <!-- Contenu Texte & Infos -->
    <div class="flex flex-1 flex-col justify-between p-1.5">
      <div>
        <!-- Nom de la carte -->
        <div class="line-clamp-1 font-bold text-slate-900" :title="effectiveCard.identity.nameFr">
          {{ effectiveCard.identity.nameFr }}
        </div>

        <!-- Badges Catégorie / Sous-catégorie -->
        <div class="mt-0.5 flex flex-wrap items-center gap-1">
          <span
            class="rounded px-1 py-0.2 text-[8px] font-semibold"
            :class="[categoryBadge.bg, categoryBadge.text]"
          >
            {{ categoryBadge.label }}
          </span>
          <span
            v-if="effectiveCard.identity.isRuleBox"
            class="rounded bg-indigo-100 px-1 py-0.2 text-[8px] font-bold text-indigo-800"
          >
            2 PRIX
          </span>
        </div>
      </div>

      <!-- Si Pokémon en Jeu : PV, Dégâts, Énergies, Outils -->
      <div v-if="effectiveCard.category === 'POKEMON'" class="mt-1">
        <!-- Barre de PV -->
        <div class="flex items-center justify-between text-[9px] font-mono font-bold">
          <span :class="currentHp === 0 ? 'text-red-600' : 'text-slate-700'">
            {{ currentHp }} / {{ maxHp }} PV
          </span>
          <span v-if="damageTaken > 0" class="text-red-600">
            -{{ damageTaken }}
          </span>
        </div>
        <div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            class="h-full transition-all duration-300"
            :class="hpColorClass"
            :style="{ width: `${hpPercentage}%` }"
          ></div>
        </div>

        <!-- Énergies & Outils attachés (si présents) -->
        <div v-if="inPlayPokemon" class="mt-1 flex flex-wrap items-center gap-1">
          <!-- Énergies -->
          <div
            v-for="(en, idx) in attachedEnergySummary"
            :key="idx"
            class="flex items-center gap-0.5 rounded px-1 py-0.2 text-[8px] font-bold shadow-2xs"
            :class="[en.visual.bg, en.visual.text]"
            :title="`${en.count} ${en.name}`"
          >
            <span>{{ en.visual.emoji }}</span>
            <span v-if="en.count > 1">×{{ en.count }}</span>
          </div>

          <span
            v-if="inPlayPokemon.attachedEnergies.length === 0"
            class="text-[8px] font-medium text-slate-400"
          >
            0 NRJ
          </span>

          <!-- Outils -->
          <span
            v-for="tool in inPlayPokemon.attachedTools"
            :key="tool.cardId"
            class="rounded bg-violet-100 px-1 py-0.2 text-[8px] font-semibold text-violet-800"
            :title="`Outil : ${tool.identity.nameFr}`"
          >
            🔧 {{ tool.identity.nameFr }}
          </span>

          <!-- Altérations d'état (Poison, Brûlure...) -->
          <span
            v-for="cond in inPlayPokemon.specialConditions"
            :key="cond"
            class="rounded bg-red-100 px-1 py-0.2 text-[8px] font-bold text-red-800 uppercase"
          >
            {{ cond === 'POISONED' ? '☠️ Poison' : cond === 'BURNED' ? '🔥 Brûlure' : cond === 'ASLEEP' ? '💤 Dodo' : cond }}
          </span>
        </div>
      </div>

      <!-- Si Dresseur ou Énergie : petit résumé -->
      <div v-else class="mt-1 flex items-center justify-between text-[9px] text-slate-500">
        <span class="truncate">
          {{ effectiveCard.identity.setName || effectiveCard.identity.setId }}
        </span>
        <span v-if="effectiveCard.identity.localId" class="font-mono text-[8px]">
          #{{ effectiveCard.identity.localId }}
        </span>
      </div>
    </div>
  </div>

  <!-- Emplacement Vide (Banc vide) -->
  <div
    v-else
    :class="[
      'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-2 text-slate-300 transition-all select-none',
      size === 'sm' ? 'w-24 h-24' : 'w-32 h-36',
    ]"
  >
    <div class="h-6 w-6 rounded-full border border-dashed border-slate-300"></div>
    <span class="mt-1 text-[9px] font-medium text-slate-400">Vide</span>
  </div>
</template>
