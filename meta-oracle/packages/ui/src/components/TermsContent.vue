<template>
  <article class="mx-auto max-w-4xl px-4 py-12 sm:px-6">
    <div class="mb-8">
      <a
        href="/"
        class="inline-flex items-center gap-1.5 text-xs font-semibold transition hover:brightness-125"
        style="color: var(--brand-amber)"
      >
        <span>←</span>
        <span>Retour à l’accueil</span>
      </a>
      <h1 class="mt-4 text-3xl font-black tracking-tight sm:text-4xl mo-gradient-text">
        Conditions Générales d’Utilisation (CGU)
      </h1>
      <p class="mt-2 text-sm" style="color: var(--text-secondary)">
        Dernière mise à jour : {{ lastUpdated }} — Accès aux outils Meta Oracle.
      </p>
    </div>

    <div class="space-y-6 text-sm leading-relaxed" style="color: var(--text-secondary)">
      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">1. Objet &amp; Statut Bêta</h2>
        <p>
          Les présentes Conditions Générales d’Utilisation régissent l’accès gratuit aux services web <strong style="color: var(--text-primary)">Meta Oracle</strong> : le Hub d’information (`meta-oracle.com`), le Simulateur Monte-Carlo 3-ply (`sim.meta-oracle.com`), l’Arène IA Pythia (`arena.meta-oracle.com`, en préparation) et l’API associée (`api.meta-oracle.com`).
        </p>
        <p>
          Le service est fourni en version <strong style="color: var(--brand-amber)">Bêta Ouverte</strong> « en l’état » : certaines modélisations de cartes ou interactions complexes du règlement Pokémon TCG peuvent encore comporter des imprécisions signalables à tout moment via l’interface.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">2. Caractère analytique des résultats</h2>
        <p>
          Les indicateurs (Winrate Global, Tour Moyen Premier KO, Taux de Setup T2, Taux de Brick, Atelier A/B) résultent de simulations stochastiques et d’heuristiques 3-ply destinées à l’entraînement compétitif. Meta Oracle ne garantit en aucun cas des résultats exacts en tournoi officiel Play! Pokémon.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">3. Usage loyal de l’API &amp; Disponibilité</h2>
        <p>
          Toute tentative d’extraction massive automatisée, de saturation volontaire de `api.meta-oracle.com` ou de contournement des limites de débit (rate-limiting) est interdite. Meta Oracle se réserve le droit d’interrompre ou de faire évoluer les endpoints sans préavis durant la phase Bêta.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">4. Non-Affiliation</h2>
        <p style="color: var(--text-primary)">
          {{ disclaimer }}
        </p>
      </section>
    </div>
  </article>
</template>

<script setup lang="ts">
import { TPCI_NON_AFFILIATION_DISCLAIMER_FR } from '../logo'

withDefaults(
  defineProps<{
    lastUpdated?: string
  }>(),
  {
    lastUpdated: 'Novembre 2026',
  },
)

const disclaimer = TPCI_NON_AFFILIATION_DISCLAIMER_FR
</script>
