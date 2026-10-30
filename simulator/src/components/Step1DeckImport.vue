<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ParsedDeck, ParsedDeckEntry } from '../types/deck'
import { META_OPPONENT_DECKS } from '../data/metaDecks'

const props = defineProps<{
  rawDeckText: string
  validatedDeck: ParsedDeck
}>()

const emit = defineEmits<{
  (e: 'validate-deck', rawText: string): void
  (e: 'proceed-step2'): void
}>()

const localText = ref(props.rawDeckText)
const activePresetId = ref<string>(META_OPPONENT_DECKS[0]?.id || '')

watch(
  () => props.rawDeckText,
  (val) => {
    localText.value = val
  },
)

function loadSampleDeck(presetId: string) {
  const found = META_OPPONENT_DECKS.find((d) => d.id === presetId)
  if (!found) return
  activePresetId.value = found.id
  localText.value = found.ptcglText
  emit('validate-deck', found.ptcglText)
}

function handleValidateClick() {
  emit('validate-deck', localText.value)
}

const pokemonCards = computed<ParsedDeckEntry[]>(() =>
  props.validatedDeck.cards.filter((c) => c.category === 'pokemon'),
)
const trainerCards = computed<ParsedDeckEntry[]>(() =>
  props.validatedDeck.cards.filter((c) => c.category === 'trainer'),
)
const energyCards = computed<ParsedDeckEntry[]>(() =>
  props.validatedDeck.cards.filter((c) => c.category === 'energy'),
)

const compiledDbCount = computed(() =>
  props.validatedDeck.cards
    .filter((c) => c.resolvedFromSource === 'compiled_db')
    .reduce((sum, c) => sum + c.quantity, 0),
)

const nativeEnergyCount = computed(() =>
  props.validatedDeck.cards
    .filter((c) => c.resolvedFromSource === 'native_basic_energy')
    .reduce((sum, c) => sum + c.quantity, 0),
)

function formatRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    MAIN_ATTACKER: 'Attaquant Principal',
    SECONDARY_ATTACKER: 'Attaquant Secondaire',
    DRAW_ENGINE_POKEMON: 'Moteur de Pioche',
    TUTOR_ENGINE_POKEMON: 'Moteur de Recherche',
    ENERGY_ACCELERATOR: 'Accélérateur Énergie',
    BENCH_DEPLOYER: 'Déployeur de Banc',
    CONSISTENCY_TUTOR: 'Tuteur Consistance',
    EVOLUTION_ACCELERATOR: 'Accélérateur Évolution',
    HAND_REFRESH_DRAW: 'Pioche / Refresh',
    HAND_DISRUPTION: 'Disruption Main',
    GUST_BOSS: 'Gust / Ciblage Banc',
    SWITCH_MOBILITY: 'Mobilité / Retraite',
    RECOVERY_RECYCLER: 'Recyclage Défausse',
    ENERGY_RESOURCE: 'Ressource Énergie',
    TECH_UTILITY: 'Utilitaire / Tech',
  }
  return labels[role] || role
}
</script>

<template>
  <section class="space-y-6">
    <!-- Bandeau d'introduction et Presets rapides -->
    <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span
            class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-slate-700"
          >
            ÉTAPE 1 SUR 3
          </span>
          <h2 class="mt-2 text-xl font-bold text-slate-900">
            Import &amp; Validation de votre Decklist PTCGL
          </h2>
          <p class="mt-1 text-sm text-slate-600">
            Collez une liste au format Pokémon TCG Live (FR ou EN) ou chargez un archétype méta de
            référence, puis cliquez sur <strong>Valider le deck</strong>.
          </p>
        </div>

        <!-- Boutons de chargement rapide de listes d'exemple -->
        <div class="flex flex-col items-start sm:items-end">
          <span class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Charger un deck méta d'exemple (60 cartes) :
          </span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="preset in META_OPPONENT_DECKS"
              :key="preset.id"
              type="button"
              @click="loadSampleDeck(preset.id)"
              class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all"
              :class="
                activePresetId === preset.id
                  ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
              "
            >
              {{ preset.name }}
              <span
                class="ml-1 font-mono text-[10px]"
                :class="activePresetId === preset.id ? 'text-slate-300' : 'text-slate-400'"
              >
                ({{ preset.archetypeBadge }})
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Grille principale : Éditeur Texte PTCGL (Gauche) + Résumé de Validation & Synergies (Droite) -->
      <div class="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <!-- Colonne Gauche : Zone de texte PTCGL -->
        <div class="flex flex-col lg:col-span-5">
          <div class="mb-2 flex items-center justify-between">
            <label for="ptcgl-textarea" class="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Liste au format texte PTCGL
            </label>
            <span class="font-mono text-xs text-slate-400">
              Format : Qté Nom CODE Numéro
            </span>
          </div>

          <textarea
            id="ptcgl-textarea"
            v-model="localText"
            rows="16"
            spellcheck="false"
            placeholder="Collez votre liste Pokémon TCG Live ici...&#10;Exemple :&#10;Pokémon: 18&#10;3 Salamèche MEW 4&#10;2 Dracaufeu-ex OBF 125..."
            class="w-full flex-1 rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-slate-900 focus:bg-white focus:outline-none"
          ></textarea>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              @click="handleValidateClick"
              class="inline-flex items-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-slate-800"
            >
              <span>Valider le deck</span>
              <span class="rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs">
                {{ validatedDeck.totalCards }} / 60
              </span>
            </button>

            <button
              type="button"
              :disabled="!validatedDeck.isValid60"
              @click="emit('proceed-step2')"
              class="inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition"
              :class="
                validatedDeck.isValid60
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs hover:bg-emerald-700'
                  : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              "
            >
              <span>Continuer vers la Configuration</span>
              <span>→</span>
            </button>
          </div>
        </div>

        <!-- Colonne Droite : Statut de Validation & Audit des Synergies -->
        <div class="space-y-4 lg:col-span-7">
          <!-- Bannière de Statut Réglementaire 60 cartes -->
          <div
            class="rounded-xl border p-4"
            :class="
              validatedDeck.isValid60
                ? 'border-emerald-200 bg-emerald-50/70'
                : 'border-red-200 bg-red-50/70'
            "
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <span
                  class="flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold"
                  :class="
                    validatedDeck.isValid60
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 text-white'
                  "
                >
                  <svg v-if="validatedDeck.isValid60" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span v-else>!</span>
                </span>
                <div>
                  <h3
                    class="text-sm font-bold"
                    :class="validatedDeck.isValid60 ? 'text-emerald-950' : 'text-red-950'"
                  >
                    {{
                      validatedDeck.isValid60
                        ? 'Decklist de 60 cartes valide et prête pour le moteur 3-Ply'
                        : `Decklist invalide (${validatedDeck.totalCards} / 60 cartes)`
                    }}
                  </h3>
                  <p
                    class="text-xs"
                    :class="validatedDeck.isValid60 ? 'text-emerald-800' : 'text-red-800'"
                  >
                    {{ validatedDeck.uniqueCardCount }} références distinctes ({{
                      compiledDbCount
                    }}
                    cartes issues de <code class="font-mono">cards_database.json</code> +
                    {{ nativeEnergyCount }} Énergies de base natives).
                  </p>
                </div>
              </div>

              <div class="flex items-center gap-2 font-mono text-xs">
                <span class="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-800">
                  Pokémon: {{ validatedDeck.pokemonCount }} (Base: {{ validatedDeck.basicPokemonCount }})
                </span>
                <span class="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-800">
                  Dresseurs: {{ validatedDeck.trainerCount }}
                </span>
                <span class="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-800">
                  Énergies: {{ validatedDeck.energyCount }}
                </span>
              </div>
            </div>

            <!-- Avertissements éventuels du parseur -->
            <ul
              v-if="validatedDeck.warnings.length > 0"
              class="mt-3 space-y-1 border-t border-red-200/80 pt-2.5 text-xs text-red-800"
            >
              <li v-for="(warn, wIdx) in validatedDeck.warnings" :key="wIdx" class="font-medium">
                • <span v-if="warn.line" class="font-mono">[Ligne {{ warn.line }}]</span>
                {{ warn.message }}
              </li>
            </ul>

            <!-- Bandeau de Blocage Critique si base de données vide ou cartes non résolues -->
            <div
              v-if="!validatedDeck.isDatabaseLoaded"
              class="mt-3 rounded-lg border-2 border-red-400 bg-red-50 p-3.5 text-red-950"
            >
              <div class="flex items-center gap-2 text-xs font-bold text-red-900">
                <svg class="h-4 w-4 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>
                  Simulation impossible : la base de données cards_database.json est vide ou introuvable.
                </span>
              </div>
              <p class="mt-1 text-[11px] text-red-700">
                Synchronisez les modèles de cartes compilés en exécutant <code class="font-mono bg-white px-1 py-0.5 rounded border border-red-300">npm run sync-cards</code>.
              </p>
            </div>

            <div
              v-else-if="!validatedDeck.isFullyResolved"
              class="mt-3 rounded-lg border-2 border-red-400 bg-red-50 p-3.5 text-red-950"
            >
              <div class="flex items-center gap-2 text-xs font-bold text-red-900">
                <svg class="h-4 w-4 shrink-0 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>
                  Simulation impossible : {{ validatedDeck.unresolvedCount }} carte{{ validatedDeck.unresolvedCount > 1 ? 's' : '' }} de votre deck n'ont pas été trouvées dans la base de données.
                </span>
              </div>
              <p class="mt-1 text-[11px] text-red-700">
                Chaque carte hors Énergie de base doit être présente dans <code class="font-mono">cards_database.json</code> pour exécuter le moteur de règles.
              </p>
              <div class="mt-2.5 flex flex-wrap gap-1.5">
                <span
                  v-for="unres in validatedDeck.unresolvedCards"
                  :key="unres.uid"
                  class="inline-flex items-center gap-1 rounded border border-red-300 bg-white px-2 py-0.5 font-mono text-xs font-bold text-red-700 shadow-2xs"
                >
                  <span class="rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-800">[Inconnu]</span>
                  {{ unres.quantity }}x {{ unres.name }} {{ unres.setCode }} {{ unres.number }}
                </span>
              </div>
            </div>
          </div>

          <!-- Panneau d'Audit des Synergies (`decklistSynergyRequirements`) -->
          <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Audit Statique des Synergies (<code class="font-mono">decklistSynergyRequirements</code>)
                </h3>
                <p class="text-xs text-slate-500">
                  Vérification automatique des prérequis structurels définis dans les modèles JSON des cartes
                </p>
              </div>
              <span
                class="rounded-md border px-2 py-0.5 font-mono text-xs font-semibold"
                :class="
                  validatedDeck.synergyAudit.every((s) => s.satisfied)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
                "
              >
                {{ validatedDeck.synergyAudit.filter((s) => s.satisfied).length }} /
                {{ validatedDeck.synergyAudit.length }} synergies validées
              </span>
            </div>

            <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div
                v-for="(item, idx) in validatedDeck.synergyAudit"
                :key="idx"
                class="flex items-start justify-between gap-2 rounded-lg border bg-white p-2.5 text-xs"
                :class="
                  item.satisfied
                    ? 'border-slate-200'
                    : item.criticalZeroValue
                      ? 'border-red-300 bg-red-50/40'
                      : 'border-amber-300 bg-amber-50/40'
                "
              >
                <div>
                  <div class="font-semibold text-slate-800">{{ item.cardNameFr }}</div>
                  <div class="mt-0.5 text-[11px] text-slate-500">{{ item.description }}</div>
                </div>
                <span
                  class="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                  :class="
                    item.satisfied
                      ? 'bg-emerald-100 text-emerald-800'
                      : item.criticalZeroValue
                        ? 'bg-red-100 text-red-800'
                        : 'bg-amber-100 text-amber-800'
                  "
                >
                  {{ item.satisfied ? 'OK' : item.criticalZeroValue ? 'VALEUR = 0' : 'SOUS-SEUIL' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Aperçu Catégorisé du Deck (Pokémon / Dresseurs / Énergies) -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Colonne 1 : Pokémon -->
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h3 class="text-sm font-bold text-slate-900">
            Pokémon
          </h3>
          <span class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">
            {{ validatedDeck.pokemonCount }} cartes
          </span>
        </div>

        <ul class="divide-y divide-slate-100">
          <li
            v-for="card in pokemonCards"
            :key="card.uid"
            class="flex items-center justify-between gap-2 py-2 text-xs"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                  {{ card.quantity }}×
                </span>
                <span class="truncate font-semibold text-slate-900">{{ card.nameFr }}</span>
                <span
                  class="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[10px] text-slate-500"
                >
                  {{ card.cardId }}
                </span>
              </div>
              <div class="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{{ card.subCategory }}</span>
                <span>•</span>
                <span>{{ formatRoleLabel(card.model.strategicEvaluator.primaryRole) }}</span>
              </div>
            </div>
            <div class="shrink-0 text-right font-mono">
              <div class="text-[11px] font-semibold text-slate-700">
                Score {{ card.model.strategicEvaluator.intrinsicBaseScore }}
              </div>
              <div class="text-[10px] text-slate-400">
                {{ card.model.pokemonStats?.hp ?? 70 }} PV
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Colonne 2 : Dresseurs -->
      <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
          <h3 class="text-sm font-bold text-slate-900">
            Dresseurs (Objets, Supporters, Outils, Stades)
          </h3>
          <span class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">
            {{ validatedDeck.trainerCount }} cartes
          </span>
        </div>

        <ul class="divide-y divide-slate-100">
          <li
            v-for="card in trainerCards"
            :key="card.uid"
            class="flex items-center justify-between gap-2 py-2 text-xs"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                  {{ card.quantity }}×
                </span>
                <span class="truncate font-semibold text-slate-900">{{ card.nameFr }}</span>
                <span
                  class="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[10px] text-slate-500"
                >
                  {{ card.cardId }}
                </span>
              </div>
              <div class="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                <span>{{ card.subCategory }}</span>
                <span>•</span>
                <span>{{ formatRoleLabel(card.model.strategicEvaluator.primaryRole) }}</span>
              </div>
            </div>
            <div class="shrink-0 text-right font-mono">
              <div class="text-[11px] font-semibold text-slate-700">
                Score {{ card.model.strategicEvaluator.intrinsicBaseScore }}
              </div>
              <div
                class="text-[10px]"
                :class="
                  card.resolvedFromSource === 'compiled_db'
                    ? 'font-semibold text-emerald-600'
                    : card.resolvedFromSource === 'native_basic_energy'
                    ? 'font-semibold text-sky-600'
                    : 'font-semibold text-red-500'
                "
              >
                {{
                  card.resolvedFromSource === 'compiled_db'
                    ? 'DB Compilée'
                    : card.resolvedFromSource === 'native_basic_energy'
                    ? 'Énergie Native'
                    : 'Non Résolue'
                }}
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Colonne 3 : Énergies & Passage à l'Étape 2 -->
      <div class="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div>
          <div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h3 class="text-sm font-bold text-slate-900">
              Énergies
            </h3>
            <span class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">
              {{ validatedDeck.energyCount }} cartes
            </span>
          </div>

          <ul class="divide-y divide-slate-100">
            <li
              v-for="card in energyCards"
              :key="card.uid"
              class="flex items-center justify-between gap-2 py-2 text-xs"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="rounded bg-slate-700 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                    {{ card.quantity }}×
                  </span>
                  <span class="truncate font-semibold text-slate-900">{{ card.nameFr }}</span>
                  <span
                    class="rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[10px] text-slate-500"
                  >
                    {{ card.cardId }}
                  </span>
                </div>
                <div class="mt-0.5 text-[11px] text-slate-500">
                  {{ card.subCategory }}
                </div>
              </div>
              <div class="shrink-0 font-mono text-[11px] text-slate-600">
                Score {{ card.model.strategicEvaluator.intrinsicBaseScore }}
              </div>
            </li>
          </ul>
        </div>

        <div class="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div class="text-xs font-semibold text-slate-800">
            Prêt à lancer les duels Monte-Carlo ?
          </div>
          <p class="mt-1 text-xs text-slate-500">
            Passez à l'étape suivante pour choisir vos decks adverses, la profondeur d'arbre
            (<code class="font-mono">maxBranches</code>) et le nombre de parties ($X$).
          </p>
          <button
            type="button"
            :disabled="!validatedDeck.isValid60"
            @click="emit('proceed-step2')"
            class="mt-3 w-full rounded-lg border px-4 py-2.5 text-center text-sm font-semibold transition"
            :class="
              validatedDeck.isValid60
                ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800'
                : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
            "
          >
            Configurer la Simulation (Étape 2) →
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
