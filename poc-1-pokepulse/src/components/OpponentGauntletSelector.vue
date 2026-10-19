<script setup lang="ts">
import type { OpponentId } from '../types/pokemon-tcg'
import { OPPONENT_GAUNTLETS } from '../data/opponents'
import { 
  Crosshair, 
  Flame, 
  Swords, 
  Skull, 
  Compass, 
  CheckCircle2, 
  Clock, 
  Play,
  RotateCcw
} from 'lucide-vue-next'

defineProps<{
  activeOpponentId: OpponentId
  goingFirst: boolean
}>()

const emit = defineEmits<{
  (e: 'select-opponent', opponentId: OpponentId): void
  (e: 'update:goingFirst', val: boolean): void
}>()

const getOpponentIcon = (iconName: string) => {
  switch (iconName) {
    case 'Compass': return Compass
    case 'Flame': return Flame
    case 'Swords': return Swords
    case 'Skull': return Skull
    default: return Crosshair
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header with title & Turn Order Switch -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center justify-center p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Crosshair class="w-4 h-4" />
          </span>
          <h2 class="text-lg font-bold text-slate-100 tracking-tight">
            2. Sélecteur de Gauntlet Adverse (Pression de Matchup)
          </h2>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Mesurez la régularité de votre plan de jeu face à l'horloge et à la pression spécifique de l'adversaire.
        </p>
      </div>

      <!-- Turn Order Toggle (Commencer vs Jouer Second) -->
      <div class="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs self-stretch sm:self-auto">
        <span class="text-slate-500 text-[11px] font-medium px-2">Ordre de jeu :</span>
        <button
          type="button"
          @click="emit('update:goingFirst', true)"
          :class="[
            'px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5',
            goingFirst
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <Play class="w-3 h-3 fill-current" />
          <span>Commencer (T1)</span>
        </button>
        <button
          type="button"
          @click="emit('update:goingFirst', false)"
          :class="[
            'px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5',
            !goingFirst
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          ]"
        >
          <RotateCcw class="w-3 h-3" />
          <span>Jouer Second (T2)</span>
        </button>
      </div>
    </div>

    <!-- Turn order contextual note -->
    <div class="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/80 text-[11px] flex items-center justify-between text-slate-400">
      <div class="flex items-center gap-2">
        <span class="font-bold text-slate-300">Règle officielle :</span>
        <span v-if="goingFirst">
          Vous commencez au Tour 1. Pas d'attaque ni de Supporter au T1, mais vous évoluez au Tour 2 en premier.
        </span>
        <span v-else>
          Vous jouez en second. Vous piochez au T1, pouvez jouer un Supporter (Arven/Sada) et attaquer dès votre premier tour.
        </span>
      </div>
      <span class="text-[10px] text-indigo-400 font-mono hidden md:inline">
        Impact direct sur la variance T1/T2
      </span>
    </div>

    <!-- 4 Opponent Gauntlets Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <div
        v-for="opp in OPPONENT_GAUNTLETS"
        :key="opp.id"
        @click="emit('select-opponent', opp.id)"
        :class="[
          'relative group cursor-pointer rounded-2xl p-4 border transition-all duration-300 flex flex-col justify-between overflow-hidden',
          activeOpponentId === opp.id
            ? 'bg-slate-900/90 border-rose-500 shadow-glow-rose ring-1 ring-rose-500/50'
            : 'bg-slate-900/50 hover:bg-slate-800/70 border-slate-800 hover:border-slate-700 text-slate-300'
        ]"
      >
        <!-- Top accent line -->
        <div 
          v-if="activeOpponentId === opp.id"
          class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-amber-400 to-rose-500"
        />

        <div>
          <!-- Header with icon and badge -->
          <div class="flex items-center justify-between gap-2 mb-2.5">
            <div class="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 group-hover:text-white transition-colors">
              <component :is="getOpponentIcon(opp.iconName)" class="w-4 h-4 text-rose-400" />
            </div>

            <div class="flex items-center gap-1.5">
              <span 
                :class="[
                  'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                  opp.id === 'aggro_turbo' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                  opp.id === 'disruption' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
                  opp.id === 'mirror_setup' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                  'bg-slate-500/10 text-slate-400 border-slate-500/30'
                ]"
              >
                {{ opp.pressureLevel }}
              </span>

              <span 
                v-if="activeOpponentId === opp.id"
                class="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded-full"
              >
                <CheckCircle2 class="w-3 h-3" />
                Cible
              </span>
            </div>
          </div>

          <!-- Name & Subtitle -->
          <h3 class="text-sm font-bold text-slate-100 group-hover:text-white transition-colors leading-snug">
            {{ opp.name }}
          </h3>
          <p class="text-[11px] font-medium text-rose-400/90 mt-0.5">
            {{ opp.archetype }}
          </p>

          <!-- Description -->
          <p class="text-[11px] text-slate-400 mt-2 line-clamp-3 leading-relaxed">
            {{ opp.subtitle }}
          </p>
        </div>

        <!-- Clock info & threat level bar -->
        <div class="mt-4 pt-2.5 border-t border-slate-800/80 space-y-2">
          <div class="flex items-center gap-1.5 text-[10px] text-slate-400">
            <Clock class="w-3 h-3 text-slate-500 shrink-0" />
            <span class="truncate">{{ opp.clockDescription }}</span>
          </div>

          <!-- Threat level meter -->
          <div class="space-y-1">
            <div class="flex items-center justify-between text-[10px]">
              <span class="text-slate-500 font-medium">Horloge adverse</span>
              <span class="font-mono font-bold text-slate-300">{{ opp.pressureRating }}/10</span>
            </div>
            <div class="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div 
                class="h-full rounded-full transition-all duration-500"
                :style="{ width: `${opp.pressureRating * 10}%` }"
                :class="[
                  opp.pressureRating > 8 ? 'bg-rose-500' :
                  opp.pressureRating > 6 ? 'bg-amber-500' :
                  opp.pressureRating > 3 ? 'bg-indigo-500' : 'bg-slate-600'
                ]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
