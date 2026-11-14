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
        Mentions Légales
      </h1>
      <p class="mt-2 text-sm" style="color: var(--text-secondary)">
        Dernière mise à jour : {{ lastUpdated }} — Écosystème Olydor (`olydor.app`, `insight.olydor.app`, `arena.olydor.app`, `api.olydor.app`).
      </p>
    </div>

    <div class="space-y-6 text-sm leading-relaxed" style="color: var(--text-secondary)">
      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">1. Éditeur du service</h2>
        <p>
          La suite logicielle <strong style="color: var(--text-primary)">Olydor</strong> est un projet de recherche et d’ingénierie logicielle indépendant consacré à l’analyse probabiliste et à la simulation stratégique de jeux de cartes à collectionner (Pokémon TCG).
        </p>
        <p>
          Responsable de publication : Équipe Olydor (projet académique &amp; R&amp;D indépendant, version Bêta Ouverte).
          Pour toute demande légale ou technique, vous pouvez utiliser la modale « Signaler un bug » présente dans la barre de navigation ou le formulaire officiel Bêta-Testeur.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">2. Hébergement et Infrastructure</h2>
        <p>
          Les services Web (`olydor.app`, `insight.olydor.app`, `arena.olydor.app`) et l’API TypeScript (`api.olydor.app`) sont orchestrés via conteneurs Docker managés sous <strong style="color: var(--text-primary)">Coolify</strong> sur infrastructure cloud européenne conforme aux standards de sécurité en vigueur.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">3. Propriété Intellectuelle &amp; Non-Affiliation Pokémon</h2>
        <p>
          L’architecture logicielle, le moteur de simulation `@olydor/engine`, l’évaluateur 3-ply Pythia, le design system « Dark Obsidian &amp; Solar Flare » et le logo officiel Olydor sont la propriété exclusive du projet Olydor.
        </p>
        <p class="rounded-lg border p-3.5 text-xs font-medium" style="background-color: var(--bg-elevated); border-color: var(--border-subtle); color: var(--text-primary)">
          {{ disclaimer }}
        </p>
        <p>
          Pokémon et tous les noms de personnages, visuels de cartes et marques associées sont des marques déposées de Nintendo, Creatures Inc., GAME FREAK Inc. et The Pokémon Company International. Olydor utilise ces références exclusivement à des fins d’analyse stratégique et de recherche algorithmique.
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
