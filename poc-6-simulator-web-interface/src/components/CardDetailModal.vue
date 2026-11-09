<script setup lang="ts">
import { computed } from 'vue'
import type { EngineCardModel } from '../types/cardModel'
import type { InPlayPokemon } from '../core/engine'
import { getPokemonMaxHp, getRemainingHp } from '../core/engine'
import { formatEnergyCost, getCardImageUrl, getCategoryBadge, getTypeVisual } from '../utils/cardUiHelpers'
import { Shield, Swords, Sparkles, X, Zap } from 'lucide-vue-next'

const props = defineProps<{
  card: EngineCardModel | null
  inPlayPokemon?: InPlayPokemon | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const imageUrl = computed(() => {
  if (!props.card) return null
  return getCardImageUrl(props.card.identity.imageUrl)
})

const maxHp = computed(() => {
  if (props.inPlayPokemon) return getPokemonMaxHp(props.inPlayPokemon)
  return props.card?.pokemonStats?.hp ?? 0
})

const currentHp = computed(() => {
  if (props.inPlayPokemon) return getRemainingHp(props.inPlayPokemon)
  return maxHp.value
})

const typeVisual = computed(() => {
  const t = props.card?.pokemonStats?.types?.[0] || 'incolore'
  return getTypeVisual(t)
})

const attacks = computed(() => {
  if (!props.card) return []
  return props.card.playableActions.filter((a) => a.actionType === 'ATTACK' || a.sourceType === 'ATTACK')
})

const abilities = computed(() => {
  if (!props.card) return []
  return props.card.playableActions.filter((a) => a.actionType === 'USE_ABILITY' || a.sourceType === 'ABILITY_ACTIVATED')
})
</script>

<template>
  <div
    v-if="card"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs select-none"
    @click.self="emit('close')"
  >
    <div class="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <!-- En-tête -->
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div class="flex items-center gap-2">
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full text-xs shadow-2xs"
            :class="[typeVisual.bg, typeVisual.text]"
          >
            {{ typeVisual.emoji }}
          </span>
          <h3 class="text-sm font-bold text-slate-900">
            {{ card.identity.nameFr }}
          </h3>
          <span v-if="card.identity.nameEn" class="text-xs text-slate-400">
            ({{ card.identity.nameEn }})
          </span>
        </div>
        <button
          type="button"
          @click="emit('close')"
          class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <!-- Contenu Déroulant -->
      <div class="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <!-- Présentation Haut : Image + Caractéristiques -->
        <div class="flex flex-col gap-4 sm:flex-row">
          <!-- Carte Image -->
          <div class="flex w-36 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-xs">
            <img
              v-if="imageUrl"
              :src="imageUrl"
              :alt="card.identity.nameFr"
              class="h-52 w-full object-cover object-top"
            />
            <div v-else class="flex h-52 w-full flex-col items-center justify-center text-center p-2">
              <span class="text-4xl">{{ typeVisual.emoji }}</span>
              <span class="mt-2 font-bold text-slate-700">{{ card.identity.nameFr }}</span>
            </div>
          </div>

          <!-- Métadonnées & Statistiques -->
          <div class="flex-1 space-y-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <span
                class="rounded px-2 py-0.5 font-bold"
                :class="[getCategoryBadge(card).bg, getCategoryBadge(card).text]"
              >
                {{ getCategoryBadge(card).label }}
              </span>
              <span
                v-if="card.identity.isRuleBox"
                class="rounded bg-indigo-100 px-2 py-0.5 font-bold text-indigo-900"
              >
                Règle Spéciale ({{ card.identity.prizeCardsGiven }} Récompenses)
              </span>
              <span
                v-if="card.identity.regulationMark"
                class="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-bold text-slate-700"
              >
                Format {{ card.identity.regulationMark }}
              </span>
            </div>

            <!-- Si Pokémon : PV, Évolution, Faiblesse, Retraite -->
            <div v-if="card.category === 'POKEMON' && card.pokemonStats" class="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div class="flex items-center justify-between font-mono">
                <span class="text-slate-600">Points de Vie (PV) :</span>
                <span class="font-bold text-slate-900">
                  {{ currentHp }} / {{ maxHp }} PV
                </span>
              </div>
              <div v-if="card.pokemonStats.evolvesFrom" class="flex items-center justify-between">
                <span class="text-slate-600">Évolue de :</span>
                <span class="font-bold text-slate-900">{{ card.pokemonStats.evolvesFrom }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-slate-600">Coût de retraite :</span>
                <span class="font-mono font-bold text-slate-900">
                  {{ card.pokemonStats.retreatCost }} Énergie(s)
                </span>
              </div>
              <div v-if="card.pokemonStats.weaknesses.length > 0" class="flex items-center justify-between">
                <span class="text-slate-600">Faiblesse :</span>
                <span class="font-bold text-red-600">
                  {{ card.pokemonStats.weaknesses.map(w => `${w.type} ${w.value}`).join(', ') }}
                </span>
              </div>
            </div>

            <!-- Si en jeu : Statut d'équipement -->
            <div v-if="inPlayPokemon" class="rounded-xl border border-blue-200 bg-blue-50/70 p-2.5">
              <div class="font-bold text-blue-900">État en jeu :</div>
              <div class="mt-1 flex flex-wrap items-center gap-1">
                <span class="text-slate-600">Énergies attachées ({{ inPlayPokemon.attachedEnergies.length }}) :</span>
                <span
                  v-for="(en, eIdx) in inPlayPokemon.attachedEnergies"
                  :key="eIdx"
                  class="rounded bg-white px-1.5 py-0.2 font-mono text-[10px] font-bold text-slate-800 shadow-2xs"
                >
                  {{ en.identity.nameFr }}
                </span>
                <span v-if="inPlayPokemon.attachedEnergies.length === 0" class="italic text-slate-400">Aucune</span>
              </div>
              <div v-if="inPlayPokemon.attachedTools.length > 0" class="mt-1 flex items-center gap-1">
                <span class="text-slate-600">Outil attaché :</span>
                <span class="font-semibold text-violet-800">
                  {{ inPlayPokemon.attachedTools.map(t => t.identity.nameFr).join(', ') }}
                </span>
              </div>
              <div v-if="inPlayPokemon.specialConditions.length > 0" class="mt-1 flex items-center gap-1">
                <span class="text-slate-600">États spéciaux :</span>
                <span
                  v-for="cond in inPlayPokemon.specialConditions"
                  :key="cond"
                  class="rounded bg-red-100 px-1.5 py-0.2 font-bold text-red-800 uppercase"
                >
                  {{ cond === 'POISONED' ? '☠️ Poison' : cond === 'BURNED' ? '🔥 Brûlure' : cond === 'ASLEEP' ? '💤 Sommeil' : cond === 'PARALYZED' ? '⚡ Paralysie' : cond === 'CONFUSED' ? '🌀 Confusion' : cond }}
                </span>
              </div>
              <div v-if="inPlayPokemon.cantAttackNextTurn" class="mt-1 flex items-center gap-1">
                <span class="rounded bg-rose-100 px-1.5 py-0.2 font-bold text-rose-800">
                  🚫 Ce Pokémon ne peut pas attaquer ce tour
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Section Talents -->
        <div v-if="abilities.length > 0" class="space-y-2">
          <h4 class="font-bold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
            <Sparkles class="h-3.5 w-3.5 text-purple-600" />
            <span>Talent(s)</span>
          </h4>
          <div
            v-for="ab in abilities"
            :key="ab.actionId"
            class="rounded-xl border border-purple-200 bg-purple-50/60 p-2.5"
          >
            <div class="font-bold text-purple-950">{{ ab.label }}</div>
          </div>
        </div>

        <!-- Section Attaques -->
        <div v-if="attacks.length > 0" class="space-y-2">
          <h4 class="font-bold uppercase tracking-wider text-red-900 flex items-center gap-1.5">
            <Swords class="h-3.5 w-3.5 text-red-600" />
            <span>Attaque(s)</span>
          </h4>
          <div
            v-for="atk in attacks"
            :key="atk.actionId"
            class="space-y-1 rounded-xl border border-red-200 bg-red-50/60 p-2.5"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <!-- Coût Énergie -->
                <div class="flex items-center gap-0.5">
                  <span
                    v-for="(c, cIdx) in formatEnergyCost(atk.cost)"
                    :key="cIdx"
                    class="flex items-center gap-0.5 rounded px-1 py-0.2 text-[9px] font-bold"
                    :class="[c.visual.bg, c.visual.text]"
                  >
                    <span>{{ c.visual.emoji }}</span>
                    <span v-if="c.count > 1">×{{ c.count }}</span>
                  </span>
                </div>
                <span class="font-bold text-slate-900">{{ atk.label }}</span>
              </div>
              <span
                v-if="atk.effects.find(e => e.baseDamage || e.value)"
                class="font-mono font-bold text-red-600 text-sm"
              >
                {{ atk.effects.find(e => e.baseDamage || e.value)?.baseDamage || atk.effects.find(e => e.baseDamage || e.value)?.value }} dégâts
              </span>
            </div>
          </div>
        </div>

        <!-- Règles Brutes Textuelles de la carte -->
        <div v-if="card.identity.rawRulesText && card.identity.rawRulesText.length > 0" class="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          <div class="font-semibold text-slate-700">Texte officiel de la carte :</div>
          <div
            v-for="(rule, rIdx) in card.identity.rawRulesText"
            :key="rIdx"
            class="text-[11px] leading-relaxed text-slate-600"
          >
            {{ rule }}
          </div>
        </div>
      </div>

      <!-- Pied de modal -->
      <div class="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-right">
        <button
          type="button"
          @click="emit('close')"
          class="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
        >
          Fermer
        </button>
      </div>
    </div>
  </div>
</template>
