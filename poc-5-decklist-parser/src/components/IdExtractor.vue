<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  Copy,
  Check,
  Download,
  FileJson,
  ListOrdered,
  Hash,
  FileSpreadsheet,
} from 'lucide-vue-next'
import type { IdFormatMode, IdOutputStyle, ParsedCard } from '../types/deck'
import {
  extractCardIdsList,
  exportTargetIdentityJson,
  exportCardsToCsv,
  getCardIdByMode,
} from '../utils/export'

const props = defineProps<{
  cards: ParsedCard[]
}>()

const idMode = ref<IdFormatMode>('tcgdex-padded')
const outputStyle = ref<IdOutputStyle>('target-json')
const uniqueOnly = ref(true)
const copiedMain = ref(false)
const copiedPill = ref<string | null>(null)

const uniqueCardsWithIds = computed(() => {
  const seen = new Map<string, { id: string; nameFr: string; qty: number; category: string }>()
  for (const c of props.cards) {
    if (c.quantity <= 0) continue
    const id = getCardIdByMode(c, idMode.value)
    const existing = seen.get(id)
    if (existing) {
      existing.qty += c.quantity
    } else {
      seen.set(id, {
        id,
        nameFr: c.nameFr,
        qty: c.quantity,
        category: c.category,
      })
    }
  }
  return Array.from(seen.values())
})

const formattedOutput = computed(() => {
  if (outputStyle.value === 'target-json') {
    const jsonArr = exportTargetIdentityJson(props.cards, idMode.value)
    return JSON.stringify(jsonArr, null, 2)
  }
  if (outputStyle.value === 'quantities') {
    return extractCardIdsList(props.cards, {
      mode: idMode.value,
      withQuantities: true,
    }).join('\n')
  }
  if (outputStyle.value === 'csv') {
    return exportCardsToCsv(props.cards, idMode.value)
  }
  // 'list'
  return extractCardIdsList(props.cards, {
    mode: idMode.value,
    uniqueOnly: uniqueOnly.value,
  }).join('\n')
})

async function copyMainOutput() {
  try {
    await navigator.clipboard.writeText(formattedOutput.value)
    copiedMain.value = true
    setTimeout(() => {
      copiedMain.value = false
    }, 2000)
  } catch {
    // Fallback
  }
}

async function copySingleId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    copiedPill.value = id
    setTimeout(() => {
      copiedPill.value = null
    }, 1500)
  } catch {
    // Fallback
  }
}

function downloadOutput() {
  const ext =
    outputStyle.value === 'target-json'
      ? 'json'
      : outputStyle.value === 'csv'
        ? 'csv'
        : 'txt'
  const mime =
    ext === 'json'
      ? 'application/json'
      : ext === 'csv'
        ? 'text/csv'
        : 'text/plain'
  const blob = new Blob([formattedOutput.value], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pokemon-deck-ids.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Barre de configuration du format d'ID -->
    <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <!-- Sélecteur de convention d'ID -->
        <div class="flex flex-col gap-1.5">
          <label class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            1. Convention d'identifiant (cardId)
          </label>
          <div class="inline-flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              @click="idMode = 'tcgdex-padded'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5',
                idMode === 'tcgdex-padded'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              <span>TCGdex Officiel</span>
              <code class="text-[11px] font-mono opacity-80">(sv01-166 / sv03.5-004)</code>
            </button>
            <button
              type="button"
              @click="idMode = 'tcgdex-raw'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5',
                idMode === 'tcgdex-raw'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              <span>TCGdex Non-padé</span>
              <code class="text-[11px] font-mono opacity-80">(sv03.5-4)</code>
            </button>
            <button
              type="button"
              @click="idMode = 'ptcgl-code'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5',
                idMode === 'ptcgl-code'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              <span>Code PTCGL</span>
              <code class="text-[11px] font-mono opacity-80">(SVI-166)</code>
            </button>
          </div>
        </div>

        <!-- Sélecteur de structure de sortie -->
        <div class="flex flex-col gap-1.5">
          <label class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            2. Format de sortie
          </label>
          <div class="inline-flex flex-wrap gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              type="button"
              @click="outputStyle = 'target-json'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5',
                outputStyle === 'target-json'
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              <FileJson class="w-3.5 h-3.5" />
              <span>JSON Identity Cible</span>
            </button>
            <button
              type="button"
              @click="outputStyle = 'list'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5',
                outputStyle === 'list'
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              <Hash class="w-3.5 h-3.5" />
              <span>Liste brute d'IDs</span>
            </button>
            <button
              type="button"
              @click="outputStyle = 'quantities'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5',
                outputStyle === 'quantities'
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              <ListOrdered class="w-3.5 h-3.5" />
              <span>Quantités + IDs</span>
            </button>
            <button
              type="button"
              @click="outputStyle = 'csv'"
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer flex items-center gap-1.5',
                outputStyle === 'csv'
                  ? 'bg-white text-blue-700 shadow-xs border border-slate-200/60 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              ]"
            >
              <FileSpreadsheet class="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Badges rapides des IDs extraits (cliquables pour copier 1 ID) -->
      <div class="pt-3 border-t border-slate-200 flex flex-col gap-2">
        <div class="flex items-center justify-between text-xs text-slate-500">
          <span>
            Aperçu rapide des <strong class="text-slate-900">{{ uniqueCardsWithIds.length }} identifiants uniques</strong> utilisés (cliquez sur un badge pour le copier) :
          </span>
          <label
            v-if="outputStyle === 'list'"
            class="inline-flex items-center gap-2 cursor-pointer text-slate-600"
          >
            <input
              type="checkbox"
              v-model="uniqueOnly"
              class="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Dédupliquer les IDs (uniques uniquement)</span>
          </label>
        </div>

        <div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
          <button
            v-for="item in uniqueCardsWithIds"
            :key="item.id"
            type="button"
            @click="copySingleId(item.id)"
            class="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 text-slate-700 transition cursor-pointer"
            :title="`${item.qty}x ${item.nameFr} — Cliquer pour copier ${item.id}`"
          >
            <span class="text-slate-500 font-sans font-semibold">{{ item.qty }}×</span>
            <span class="text-blue-700 font-semibold group-hover:text-blue-900">{{ item.id }}</span>
            <span class="text-[11px] font-sans text-slate-500 truncate max-w-[120px]">{{ item.nameFr }}</span>
            <Check
              v-if="copiedPill === item.id"
              class="w-3 h-3 text-emerald-600"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Zone de résultat & Actions d'export -->
    <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-bold text-slate-900">
            Résultat de l'extraction ({{ uniqueCardsWithIds.length }} références)
          </h3>
          <p class="text-xs text-slate-500">
            <template v-if="outputStyle === 'target-json'">
              Schéma complet <code class="text-slate-700 font-mono">{ cardId, count, identity: { ... } }</code> conforme aux spécifications.
            </template>
            <template v-else>
              Liste générée dynamiquement en fonction de vos cartes et ratios actuels.
            </template>
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            @click="copyMainOutput"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition cursor-pointer"
          >
            <Check v-if="copiedMain" class="w-3.5 h-3.5 text-white" />
            <Copy v-else class="w-3.5 h-3.5" />
            <span>{{ copiedMain ? 'Copié dans le presse-papier !' : 'Copier tout' }}</span>
          </button>

          <button
            type="button"
            @click="downloadOutput"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-xs transition cursor-pointer"
          >
            <Download class="w-3.5 h-3.5" />
            <span>Télécharger</span>
          </button>
        </div>
      </div>

      <pre class="w-full max-h-[500px] overflow-auto rounded-lg bg-slate-900 text-slate-100 p-4 text-xs font-mono leading-relaxed select-all border border-slate-800">{{ formattedOutput }}</pre>
    </div>
  </div>
</template>
