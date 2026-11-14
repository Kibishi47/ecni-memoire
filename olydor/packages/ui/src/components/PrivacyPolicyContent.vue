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
        Politique de Confidentialité (RGPD)
      </h1>
      <p class="mt-2 text-sm" style="color: var(--text-secondary)">
        Dernière mise à jour : {{ lastUpdated }} — Protection des données sur les plateformes Olydor.
      </p>
    </div>

    <div class="space-y-6 text-sm leading-relaxed" style="color: var(--text-secondary)">
      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">1. Minimisation des données &amp; Zéro Tracking Publicitaire</h2>
        <p>
          Olydor respecte strictement le principe de minimisation défini par le Règlement Général sur la Protection des Données (RGPD). Aucun cookie publicitaire, aucun traceur tiers comportemental et aucune vente ou cession de données à des tiers ne sont pratiqués sur `olydor.app`, `insight.olydor.app` ou `arena.olydor.app`.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">2. Stockage local navigateur (LocalStorage &amp; SessionStorage)</h2>
        <p>
          Les simulations Monte-Carlo s’exécutent localement dans les <strong style="color: var(--text-primary)">Web Workers</strong> de votre navigateur. Seules des préférences techniques non identifiantes (langue FR/EN, masquage temporaire du bandeau bêta, decklist en cours d’édition) peuvent être conservées localement dans votre navigateur.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">3. Signalements de bugs (`POST /api/reports`) &amp; Programme Bêta</h2>
        <p>
          Lorsque vous soumettez volontairement un signalement via le bouton « Signaler un bug », seules les informations techniques nécessaires au diagnostic sont enregistrées sur `api.olydor.app` (type d’anomalie, identifiant de carte, commentaire libre, et capture anonyme de l’état du moteur si applicable). Une limitation anti-abus par adresse IP (rate-limiting) est appliquée en mémoire vive sans profilage commercial.
        </p>
        <p>
          La participation au questionnaire bêta hébergé via Google Forms est strictement facultative et soumise aux conditions que vous acceptez explicitement lors de sa soumission.
        </p>
      </section>

      <section class="mo-card p-6 space-y-2.5">
        <h2 class="text-lg font-bold" style="color: var(--text-primary)">4. Vos droits RGPD</h2>
        <p>
          Conformément à la réglementation européenne, vous disposez d’un droit d’accès, de rectification, de limitation et de suppression de toute donnée éventuellement transmise dans un commentaire technique libre, exerçable via le canal de contact Bêta d’Olydor.
        </p>
      </section>
    </div>
  </article>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    lastUpdated?: string
  }>(),
  {
    lastUpdated: 'Novembre 2026',
  },
)
</script>
