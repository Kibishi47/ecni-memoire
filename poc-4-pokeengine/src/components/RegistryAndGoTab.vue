<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Binary,
  Check,
  Code2,
  Copy,
  Database,
  RotateCcw,
  Sliders,
} from 'lucide-vue-next'
import { DEFAULT_CARD_REGISTRY, packCard } from '@/engine/cardRegistry'
import { GO_ENGINE_FILES, GO_WASM_REFERENCE_SOURCE } from '@/engine/goReference'
import type { DeclarativeCardDefinition } from '@/types/engine'

const props = defineProps<{
  registry: DeclarativeCardDefinition[]
}>()

const emit = defineEmits<{
  (e: 'update-registry', updated: DeclarativeCardDefinition[]): void
  (e: 'reset-registry'): void
}>()

const selectedCardId = ref<number>(10) // Default selected: Poffin Pote-Pote (ID 10)
const selectedGoFile = ref<string>('state.go')
const copiedGo = ref(false)
const liveAppliedBanner = ref(false)

const currentGoFileEntry = computed(() => {
  return GO_ENGINE_FILES.find((f) => f.filename === selectedGoFile.value) ?? null
})

const displayedGoCode = computed(() => {
  if (selectedGoFile.value === 'ALL') return GO_WASM_REFERENCE_SOURCE
  return currentGoFileEntry.value?.content ?? GO_WASM_REFERENCE_SOURCE
})

const selectedCard = computed<DeclarativeCardDefinition>(() => {
  return (
    props.registry.find((c) => c.id === selectedCardId.value) ??
    props.registry[0] ??
    DEFAULT_CARD_REGISTRY[0]
  )
})

// Live Bit-Packing 16-bit preview for the selected card
const previewTurnPlayed = ref(1)
const previewEnergies = ref(2)
const previewSealStone = ref(false)

const packedUint16Value = computed(() => {
  return packCard(
    selectedCard.value.id,
    previewTurnPlayed.value,
    previewEnergies.value,
    previewSealStone.value,
    false,
    false,
  )
})

const packedBinaryString = computed(() => {
  return packedUint16Value.value.toString(2).padStart(16, '0')
})

function updatePrimitiveParam(
  primIndex: number,
  field: 'maxTargets' | 'maxHp' | 'drawCount',
  value: number,
) {
  const cloned: DeclarativeCardDefinition[] = JSON.parse(JSON.stringify(props.registry))
  const targetCard = cloned.find((c) => c.id === selectedCard.value.id)
  if (targetCard && targetCard.primitives[primIndex]) {
    targetCard.primitives[primIndex][field] = value
    emit('update-registry', cloned)
    liveAppliedBanner.value = true
    setTimeout(() => {
      liveAppliedBanner.value = false
    }, 2500)
  }
}

async function copyGoSource() {
  try {
    await navigator.clipboard.writeText(displayedGoCode.value)
    copiedGo.value = true
    setTimeout(() => {
      copiedGo.value = false
    }, 2000)
  } catch {
    // Ignore clipboard error
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 1. Registre Déclaratif des Cartes (Primitives Atomiques JSON) -->
    <section class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div
        class="px-5 py-3 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2"
      >
        <div class="flex items-center gap-2">
          <Database class="w-4 h-4 text-blue-600" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-800">
            1. Registre Déclaratif des 60 Cartes (`cardRegistry.ts`) & Primitives Atomiques Composable
          </h3>
        </div>

        <div class="flex items-center gap-2">
          <span
            v-if="liveAppliedBanner"
            class="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
          >
            ✓ Primitive mise à jour & Web Worker relancé !
          </span>
          <button
            type="button"
            class="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1"
            @click="emit('reset-registry')"
          >
            <RotateCcw class="w-3 h-3" />
            Restaurer Registre Officiel
          </button>
        </div>
      </div>

      <div class="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
        <!-- Liste des cartes du deck (5 cols) -->
        <div class="lg:col-span-5 space-y-2">
          <div class="text-xs font-semibold text-slate-600 flex items-center justify-between">
            <span>Sélectionner une carte du deck (19 templates / 60 cartes)</span>
            <span class="font-mono text-[11px] text-slate-400">ID 1..25</span>
          </div>

          <div class="max-h-[460px] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-200">
            <button
              v-for="card in registry"
              :key="card.id"
              type="button"
              class="w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 transition-colors"
              :class="
                selectedCardId === card.id
                  ? 'bg-blue-50/80 text-slate-900 font-semibold'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              "
              @click="selectedCardId = card.id"
            >
              <div class="min-w-0">
                <div class="text-xs flex items-center gap-2">
                  <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">
                    #{{ card.id }}
                  </span>
                  <span class="truncate">{{ card.name }}</span>
                </div>
                <div class="text-[10px] font-mono text-slate-500 mt-0.5 flex items-center gap-2">
                  <span>{{ card.category }}</span>
                  <span v-if="card.subType">• {{ card.subType }}</span>
                  <span v-if="card.hp">• {{ card.hp }} PV</span>
                </div>
              </div>

              <div class="flex items-center gap-1.5 shrink-0">
                <span
                  v-if="card.primitives.length > 0"
                  class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200"
                >
                  {{ card.primitives[0].opcode }}
                </span>
                <span class="px-2 py-0.5 rounded text-xs font-mono font-bold bg-slate-100 text-slate-800">
                  {{ card.defaultCount }}x
                </span>
              </div>
            </button>
          </div>
        </div>

        <!-- Inspecteur JSON & Modification Live de Primitive (7 cols) -->
        <div class="lg:col-span-7 space-y-4">
          <!-- Contrôles de modification dynamique pour prouver la généricité du moteur -->
          <div class="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Sliders class="w-3.5 h-3.5 text-blue-600" />
                Preuve de Généricité : Modifier les Paramètres Atomiques de « {{ selectedCard.name }} »
              </div>
              <span class="text-[10px] font-mono text-slate-500">{{ selectedCard.code }}</span>
            </div>

            <p class="text-xs text-slate-600">
              Le moteur Web Worker n’utilise aucun <code class="font-mono bg-white px-1 rounded border border-slate-200">if (card.name === '...')</code> : il interprète directement le tableau déclaratif <code class="font-mono bg-white px-1 rounded border border-slate-200">primitives[]</code> ci-dessous. Modifiez un paramètre pour observer son impact immédiat sur les 10 000 parties :
            </p>

            <div v-if="selectedCard.primitives.length > 0" class="space-y-2.5">
              <div
                v-for="(prim, pIdx) in selectedCard.primitives"
                :key="pIdx"
                class="p-3 rounded bg-white border border-slate-200 space-y-2"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    OPCODE : {{ prim.opcode }}
                  </span>
                  <span class="text-[11px] font-mono text-slate-500">
                    Filtre : <strong class="text-slate-800">{{ prim.filter }}</strong> • Précondition : <strong class="text-slate-800">{{ prim.precondition }}</strong>
                  </span>
                </div>
                <p class="text-xs text-slate-600">{{ prim.description }}</p>

                <!-- Boutons d'édition rapide des paramètres numériques de la primitive -->
                <div class="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100">
                  <div v-if="prim.maxTargets > 0" class="flex items-center gap-2">
                    <span class="text-xs font-mono text-slate-600">maxTargets :</span>
                    <div class="inline-flex rounded border border-slate-200 overflow-hidden">
                      <button
                        v-for="val in [1, 2, 3]"
                        :key="val"
                        type="button"
                        class="px-2.5 py-1 text-xs font-mono font-semibold transition-colors"
                        :class="
                          prim.maxTargets === val
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-100'
                        "
                        @click="updatePrimitiveParam(pIdx, 'maxTargets', val)"
                      >
                        {{ val }}
                      </button>
                    </div>
                  </div>

                  <div v-if="prim.maxHp !== undefined" class="flex items-center gap-2">
                    <span class="text-xs font-mono text-slate-600">maxHp (filtre PV) :</span>
                    <div class="inline-flex rounded border border-slate-200 overflow-hidden">
                      <button
                        v-for="hpVal in [60, 70, 90]"
                        :key="hpVal"
                        type="button"
                        class="px-2.5 py-1 text-xs font-mono font-semibold transition-colors"
                        :class="
                          prim.maxHp === hpVal
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-100'
                        "
                        @click="updatePrimitiveParam(pIdx, 'maxHp', hpVal)"
                      >
                        ≤ {{ hpVal }} PV
                      </button>
                    </div>
                  </div>

                  <div v-if="prim.drawCount !== undefined" class="flex items-center gap-2">
                    <span class="text-xs font-mono text-slate-600">drawCount (pioche) :</span>
                    <div class="inline-flex rounded border border-slate-200 overflow-hidden">
                      <button
                        v-for="dVal in [3, 5, 6, 7]"
                        :key="dVal"
                        type="button"
                        class="px-2.5 py-1 text-xs font-mono font-semibold transition-colors"
                        :class="
                          prim.drawCount === dVal
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-100'
                        "
                        @click="updatePrimitiveParam(pIdx, 'drawCount', dVal)"
                      >
                        {{ dVal }} cartes
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="p-3 rounded bg-white border border-slate-200 text-xs font-mono text-slate-500">
              Pokémon de Base sans talent actif — Sert de socle d’évolution ({{ selectedCard.evolutionLine }}) avec {{ selectedCard.hp }} PV.
            </div>
          </div>

          <!-- Schéma JSON Déclaratif Complet -->
          <div class="border border-slate-200 rounded-lg overflow-hidden">
            <div class="px-3.5 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span class="text-[11px] font-mono font-semibold text-slate-700">
                Schéma JSON Déclaratif — {{ selectedCard.name }}
              </span>
              <span class="text-[10px] font-mono text-slate-500">DeclarativeCardDefinition</span>
            </div>
            <pre
              class="p-4 bg-slate-50 text-xs font-mono text-slate-800 overflow-x-auto leading-relaxed max-h-64"
            >{{ JSON.stringify(selectedCard, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </section>

    <!-- 2. Encodage Mémoire Bas Niveau Uint16 (Bit-Packing) & Code Source Go/Wasm -->
    <section class="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div
        class="px-5 py-3 border-b border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2"
      >
        <div class="flex items-center gap-2">
          <Binary class="w-4 h-4 text-slate-700" />
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-800">
            2. Représentation Bas Niveau `Uint16Array(60)` & Architecture de Référence Go / WebAssembly (`engine.go`)
          </h3>
        </div>

        <button
          type="button"
          class="px-3 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-mono font-medium text-slate-700 inline-flex items-center gap-1.5"
          @click="copyGoSource"
        >
          <Check v-if="copiedGo" class="w-3.5 h-3.5 text-emerald-600" />
          <Copy v-else class="w-3.5 h-3.5" />
          {{ copiedGo ? 'Code Go copié !' : 'Copier engine.go' }}
        </button>
      </div>

      <div class="p-5 space-y-5">
        <!-- Visualiseur de Bit-Packing 16 bits en direct -->
        <div class="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs font-bold text-slate-800">
              Inspecteur Bit-Packing 16-bit (`uint16`) — Carte « {{ selectedCard.name }} »
            </span>
            <span class="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded border border-blue-200">
              Valeur Uint16 = {{ packedUint16Value }} (0x{{ packedUint16Value.toString(16).toUpperCase().padStart(4, '0') }}) • Binaire : {{ packedBinaryString }}
            </span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
            <div class="p-2.5 rounded bg-white border border-slate-200">
              <div class="text-[10px] text-slate-500">Bits 0..4 (5 bits)</div>
              <div class="font-bold text-slate-900 mt-0.5">CardID = {{ selectedCard.id }}</div>
              <div class="text-[10px] text-emerald-700">{{ selectedCard.id.toString(2).padStart(5, '0') }}</div>
            </div>
            <div class="p-2.5 rounded bg-white border border-slate-200">
              <div class="text-[10px] text-slate-500">Bits 5..8 (4 bits)</div>
              <div class="font-bold text-slate-900 mt-0.5 flex items-center justify-between">
                <span>TurnPlayed = T{{ previewTurnPlayed }}</span>
                <button
                  type="button"
                  class="px-1.5 py-0.2 rounded bg-slate-100 hover:bg-slate-200 text-[10px]"
                  @click="previewTurnPlayed = (previewTurnPlayed % 10) + 1"
                >
                  +1
                </button>
              </div>
              <div class="text-[10px] text-blue-700">{{ previewTurnPlayed.toString(2).padStart(4, '0') }}</div>
            </div>
            <div class="p-2.5 rounded bg-white border border-slate-200">
              <div class="text-[10px] text-slate-500">Bits 9..12 (4 bits)</div>
              <div class="font-bold text-slate-900 mt-0.5 flex items-center justify-between">
                <span>Energies = {{ previewEnergies }}🔥</span>
                <button
                  type="button"
                  class="px-1.5 py-0.2 rounded bg-slate-100 hover:bg-slate-200 text-[10px]"
                  @click="previewEnergies = (previewEnergies + 1) % 6"
                >
                  +1
                </button>
              </div>
              <div class="text-[10px] text-amber-700">{{ previewEnergies.toString(2).padStart(4, '0') }}</div>
            </div>
            <div class="p-2.5 rounded bg-white border border-slate-200">
              <div class="text-[10px] text-slate-500">Bit 13 (1 bit)</div>
              <div class="font-bold text-slate-900 mt-0.5 flex items-center justify-between">
                <span>SealStone = {{ previewSealStone ? 1 : 0 }}</span>
                <button
                  type="button"
                  class="px-1.5 py-0.2 rounded bg-slate-100 hover:bg-slate-200 text-[10px]"
                  @click="previewSealStone = !previewSealStone"
                >
                  Toggle
                </button>
              </div>
              <div class="text-[10px] text-slate-600">VSTAR Tool</div>
            </div>
            <div class="p-2.5 rounded bg-white border border-slate-200">
              <div class="text-[10px] text-slate-500">Bits 14..15 (2 bits)</div>
              <div class="font-bold text-slate-900 mt-0.5">Ability / Tool</div>
              <div class="text-[10px] text-slate-600">Verrous intra-tour</div>
            </div>
          </div>
        </div>

        <!-- Code Source Go / Wasm (`./go-engine/*.go`) -->
        <div class="border border-slate-200 rounded-lg overflow-hidden">
          <div class="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Code2 class="w-4 h-4 text-slate-700" />
              <span class="text-xs font-mono font-bold text-slate-800">
                Dossier `./poc-4-pokeengine/go-engine/` — Fichiers Sources Go Éditables (`?raw` HMR)
              </span>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200">
              Synchronisé en direct avec `./go-engine/*.go`
            </span>
          </div>

          <!-- Sélecteur des fichiers du dossier go-engine/ -->
          <div class="px-4 py-2 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="file in GO_ENGINE_FILES"
                :key="file.filename"
                type="button"
                class="px-2.5 py-1 rounded border text-xs font-mono font-semibold transition-colors"
                :class="
                  selectedGoFile === file.filename
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                "
                @click="selectedGoFile = file.filename"
              >
                {{ file.filename }}
              </button>
              <button
                type="button"
                class="px-2.5 py-1 rounded border text-xs font-mono font-semibold transition-colors"
                :class="
                  selectedGoFile === 'ALL'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                "
                @click="selectedGoFile = 'ALL'"
              >
                Tous les fichiers
              </button>
            </div>

            <span v-if="currentGoFileEntry" class="text-[11px] font-mono text-slate-500">
              poc-4-pokeengine/{{ currentGoFileEntry.relativePath }} — {{ currentGoFileEntry.description }}
            </span>
          </div>

          <pre
            class="p-4 bg-slate-50 text-xs font-mono text-slate-800 overflow-x-auto leading-relaxed max-h-[520px]"
          >{{ displayedGoCode }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>
