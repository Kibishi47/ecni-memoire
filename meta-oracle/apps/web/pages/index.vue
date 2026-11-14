<template>
  <div>
    <!-- Hero Section -->
    <section class="relative overflow-hidden border-b mo-obsidian-grid" style="border-color: var(--border-subtle)">
      <div class="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <div class="mx-auto max-w-4xl text-center">
          <div class="mb-6 flex justify-center">
            <div class="rounded-full p-3" style="box-shadow: var(--brand-glow)">
              <MetaOracleLogo size="xl" :show-text="false" />
            </div>
          </div>

          <div
            class="mb-5 inline-flex items-center gap-2 rounded-full border px-3.5 py-1 text-xs font-semibold tracking-wide"
            style="border-color: rgba(255, 107, 0, 0.35); background-color: rgba(255, 107, 0, 0.1); color: var(--brand-amber)"
          >
            <Cpu class="h-3.5 w-3.5" />
            <span>{{ isEn ? '3-Ply Lookahead Engine • 854 Compiled Cards • ~1,600 games/s' : 'Moteur d’Anticipation 3-Ply • 854 Cartes Compilées • ~1 600 parties/sec' }}</span>
          </div>

          <h1 class="text-4xl font-black tracking-tight sm:text-6xl leading-[1.08]">
            <span class="mo-gradient-text">META ORACLE</span>
            <span class="block mt-2 text-2xl sm:text-4xl font-extrabold" style="color: var(--text-primary)">
              {{ isEn
                ? 'Stop guessing the meta. Simulate every branch.'
                : 'Ne devinez plus la méta. Simulez chaque branche.' }}
            </span>
          </h1>

          <p class="mx-auto mt-6 max-w-2xl text-base sm:text-lg leading-relaxed" style="color: var(--text-secondary)">
            {{ isEn
              ? 'Stress-test your 60-card lists across hundreds of multi-threaded Web Worker games against meta archetypes, pinpoint consistency bricks, and optimize card slots with A/B simulation.'
              : 'Évaluez vos decklists de 60 cartes sur des centaines de parties parallélisées en Web Workers, identifiez vos tours morts et optimisez chaque slot grâce à l’atelier comparatif A/B.' }}
          </p>

          <div class="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a
              :href="config.public.simUrl"
              class="mo-btn-solar inline-flex items-center gap-2.5 rounded-xl px-7 py-3.5 text-sm sm:text-base"
            >
              <FlaskConical class="h-5 w-5" />
              <span>{{ isEn ? 'Launch Simulator' : 'Lancer le Simulateur' }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>

            <a
              :href="config.public.arenaUrl"
              class="inline-flex items-center gap-2.5 rounded-xl border px-6 py-3.5 text-sm sm:text-base font-bold transition hover:bg-white/5"
              style="border-color: rgba(56, 189, 248, 0.45); background-color: rgba(56, 189, 248, 0.08); color: var(--ai-accent)"
            >
              <Swords class="h-5 w-5" />
              <span>{{ isEn ? 'Explore Pythia AI Arena' : 'Découvrir l’Arène IA Pythia' }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                style="background-color: rgba(255, 194, 26, 0.16); color: var(--brand-gold)"
              >
                SOON
              </span>
            </a>
          </div>

          <!-- Telemetry Highlight Strip -->
          <div class="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="mo-card p-4 text-left">
              <div class="text-xs font-medium" style="color: var(--text-secondary)">
                {{ isEn ? 'Compiled Database' : 'Catalogue Standard' }}
              </div>
              <div class="mt-1 text-2xl font-black mo-gradient-text">854</div>
              <div class="text-[11px]" style="color: var(--text-muted)">
                {{ isEn ? 'Executable schemas' : 'Cartes compilées' }}
              </div>
            </div>
            <div class="mo-card p-4 text-left">
              <div class="text-xs font-medium" style="color: var(--text-secondary)">
                {{ isEn ? 'Decision Tree' : 'Horizon Tactique' }}
              </div>
              <div class="mt-1 text-2xl font-black" style="color: var(--ai-accent)">3-Ply</div>
              <div class="text-[11px]" style="color: var(--text-muted)">
                T → T<sub>adv</sub> → T+1
              </div>
            </div>
            <div class="mo-card p-4 text-left">
              <div class="text-xs font-medium" style="color: var(--text-secondary)">
                {{ isEn ? 'State Hashing' : 'État Binaire' }}
              </div>
              <div class="mt-1 text-2xl font-black" style="color: var(--status-positive)">53-bit</div>
              <div class="text-[11px]" style="color: var(--text-muted)">
                Zobrist + Int32Array(128)
              </div>
            </div>
            <div class="mo-card p-4 text-left">
              <div class="text-xs font-medium" style="color: var(--text-secondary)">
                {{ isEn ? 'Analytics Suite' : 'Indicateurs Clés' }}
              </div>
              <div class="mt-1 text-2xl font-black" style="color: var(--brand-gold)">8 KPIs</div>
              <div class="text-[11px]" style="color: var(--text-muted)">
                {{ isEn ? '+ 6 tactical probes' : '+ 6 analyses méta' }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Bento Showcase: 2 Platforms -->
    <section id="platforms" class="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <div class="mb-10 max-w-2xl">
        <h2 class="text-2xl font-black tracking-tight sm:text-3xl" style="color: var(--text-primary)">
          {{ isEn ? 'Two Dedicated Platforms, One Shared Engine' : 'Deux Plateformes Spécialisées, Un Cœur Algorithmique Commun' }}
        </h2>
        <p class="mt-2 text-sm sm:text-base" style="color: var(--text-secondary)">
          {{ isEn
            ? 'Built around the zero-DOM @meta-oracle/engine package running seamlessly in browser Web Workers and Node.js.'
            : 'Propulsées par le moteur partagé @meta-oracle/engine s’exécutant aussi bien dans les Web Workers navigateur que sur l’API serveur.' }}
        </p>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <!-- Card 1: Simulator (LIVE) -->
        <article
          class="mo-card flex flex-col justify-between p-7 transition hover:border-orange-500/50"
          style="box-shadow: 0 10px 30px -15px rgba(255, 107, 0, 0.2)"
        >
          <div>
            <div class="flex items-center justify-between gap-3">
              <span class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style="color: var(--brand-amber)">
                <FlaskConical class="h-4 w-4" />
                sim.meta-oracle.com
              </span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                style="background-color: rgba(16, 185, 129, 0.14); color: var(--status-positive); border: 1px solid rgba(16, 185, 129, 0.35)"
              >
                <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {{ isEn ? 'AVAILABLE IN BETA' : 'DISPONIBLE EN BÊTA' }}
              </span>
            </div>

            <h3 class="mt-4 text-2xl font-black" style="color: var(--text-primary)">
              {{ isEn ? 'Monte Carlo Deck Simulator & A/B Lab' : 'Simulateur Monte-Carlo & Atelier A/B' }}
            </h3>
            <p class="mt-3 text-sm leading-relaxed" style="color: var(--text-secondary)">
              {{ isEn
                ? 'Import any PTCGL list, validate 60 cards and Ace Spec / evolution synergies automatically, then run 50 to 1,000 parallel games against curated meta lists.'
                : 'Importez votre decklist PTCGL, auditez instantanément vos 60 cartes et synergies clés, puis lancez jusqu’à 1 000 parties parallèles contre le métagame.' }}
            </p>

            <ul class="mt-5 space-y-2 text-xs sm:text-sm" style="color: var(--text-secondary)">
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 shrink-0" style="color: var(--status-positive)" />
                <span>{{ isEn ? '8 Core KPIs: Winrate, T2 Setup, Brick Rate, Dead Cards, Mulligans' : '8 KPIs officiels : Winrate, Setup T2, Brick Rate, Cartes Mortes, Mulligans' }}</span>
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 shrink-0" style="color: var(--status-positive)" />
                <span>{{ isEn ? '6 Deep Probes: Topdeck, Going First vs Second, Prize Map' : '6 analyses poussées : Topdecking, Joueur 1 vs Joueur 2, Matrice Récompenses' }}</span>
              </li>
              <li class="flex items-center gap-2">
                <CheckCircle2 class="h-4 w-4 shrink-0" style="color: var(--status-positive)" />
                <span>{{ isEn ? 'A/B Comparison & 1-click PTCGL Export + Arena Deep Link' : 'Comparateur A/B (Upgrades / Sidegrades) & export PTCGL en 1 clic' }}</span>
              </li>
            </ul>
          </div>

          <div class="mt-7 pt-5 border-t flex flex-wrap items-center justify-between gap-3" style="border-color: var(--border-subtle)">
            <a
              :href="`${config.public.simUrl}?preset=charizard`"
              class="text-xs font-semibold underline decoration-orange-500/40 underline-offset-4 transition hover:text-white"
              style="color: var(--brand-amber)"
            >
              {{ isEn ? 'Try a meta deck in 1 click →' : 'Tester avec un deck méta en 1 clic →' }}
            </a>
            <a
              :href="config.public.simUrl"
              class="mo-btn-solar inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm"
            >
              <span>{{ isEn ? 'Open Simulator' : 'Ouvrir le Simulateur' }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>
          </div>
        </article>

        <!-- Card 2: AI Arena (COMING SOON) -->
        <article
          class="mo-card flex flex-col justify-between p-7 transition hover:border-sky-400/50"
          style="box-shadow: 0 10px 30px -15px rgba(56, 189, 248, 0.18)"
        >
          <div>
            <div class="flex items-center justify-between gap-3">
              <span class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style="color: var(--ai-accent)">
                <Swords class="h-4 w-4" />
                arena.meta-oracle.com
              </span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                style="background-color: rgba(255, 194, 26, 0.14); color: var(--brand-gold); border: 1px solid rgba(255, 194, 26, 0.35)"
              >
                COMING SOON
              </span>
            </div>

            <h3 class="mt-4 text-2xl font-black" style="color: var(--text-primary)">
              {{ isEn ? 'AI Arena — Challenge Pythia 3-Ply' : 'Arène IA — Affrontez Pythia 3-Ply' }}
            </h3>
            <p class="mt-3 text-sm leading-relaxed" style="color: var(--text-secondary)">
              {{ isEn
                ? 'Play full manual turns directly against Meta Oracle’s 3-ply AI bot Pythia, inspect real-time win probability shifts, and review post-game tactical blunders.'
                : 'Affrontez directement l’Oracle Pythia coup par coup sur un plateau interactif, visualisez la jauge Win Probability en temps réel et analysez vos blunders.' }}
            </p>

            <ul class="mt-5 space-y-2 text-xs sm:text-sm" style="color: var(--text-secondary)">
              <li class="flex items-center gap-2">
                <Sparkles class="h-4 w-4 shrink-0" style="color: var(--ai-accent)" />
                <span>{{ isEn ? 'Live 3-ply thought stream explaining Pythia’s prize & sequencing lines' : 'Journal de pensée 3-ply exposant les plans de récompenses de Pythia' }}</span>
              </li>
              <li class="flex items-center gap-2">
                <Sparkles class="h-4 w-4 shrink-0" style="color: var(--ai-accent)" />
                <span>{{ isEn ? 'Direct ?deck= URL import straight from Meta Oracle Simulator' : 'Import direct via ?deck= depuis l’Atelier A/B du Simulateur' }}</span>
              </li>
              <li class="flex items-center gap-2">
                <Sparkles class="h-4 w-4 shrink-0" style="color: var(--ai-accent)" />
                <span>{{ isEn ? 'Post-Match Blunder Analysis highlighting missed KOs & gust plays' : 'Analyse Post-Match identifiant les KOs manqués et lignes optimales' }}</span>
              </li>
            </ul>
          </div>

          <div class="mt-7 pt-5 border-t flex items-center justify-between" style="border-color: var(--border-subtle)">
            <span class="text-xs font-medium" style="color: var(--text-muted)">
              {{ isEn ? 'Currently in AI training phase' : 'Phase d’entraînement Pythia en cours' }}
            </span>
            <a
              :href="config.public.arenaUrl"
              class="inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-bold transition hover:bg-sky-400/10"
              style="border-color: rgba(56, 189, 248, 0.45); color: var(--ai-accent)"
            >
              <span>{{ isEn ? 'Preview Arena' : 'Voir l’aperçu' }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>
          </div>
        </article>
      </div>
    </section>

    <!-- Architecture & Performance -->
    <section class="border-t border-b py-16" style="background-color: var(--bg-surface); border-color: var(--border-subtle)">
      <div class="mx-auto max-w-7xl px-4 sm:px-6">
        <div class="mb-10 max-w-2xl">
          <h2 class="text-2xl font-black tracking-tight sm:text-3xl" style="color: var(--text-primary)">
            {{ isEn ? 'Engineered for Speed & Rule Precision' : 'Architecture & Performance Technique' }}
          </h2>
          <p class="mt-2 text-sm sm:text-base" style="color: var(--text-secondary)">
            {{ isEn
              ? 'Every layer from offline LLM card compilation to browser worker bit-packing is built to make full TCG lookahead practical.'
              : 'De la compilation LLM des textes de cartes jusqu’au hachage 53-bit, chaque brique vise la fiabilité compétitive et la vitesse d’exécution.' }}
          </p>
        </div>

        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(255, 107, 0, 0.14); color: var(--brand-primary)">
              <Database class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">LLM Card Compiler</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ isEn
                ? 'Offline Python pipeline normalizing card rules into 29 atomic primitives, preconditions, and strategic turn-phase weights.'
                : 'Compilateur offline structurant les textes officiels en 29 primitives atomiques, préconditions et poids stratégiques par tour.' }}
            </p>
          </div>

          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(16, 185, 129, 0.14); color: var(--status-positive)">
              <Zap class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">Zobrist 53-bit &amp; Flat Buffers</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ isEn
                ? 'Commutative Zobrist state hashing, transposition tables, and in-place mutation over Int32Array(128) buffers.'
                : 'Hachage commutatif Zobrist 53-bit pour dédupliquer les permutations de Banc/Main et mutations en place sur Int32Array(128).' }}
            </p>
          </div>

          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(56, 189, 248, 0.14); color: var(--ai-accent)">
              <GitBranch class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">Lookahead 3-Ply Pythia</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ isEn
                ? 'Asymmetric T → T_adv → T+1 evaluation anticipates opponent counterplay, gust threats, and disruption recovery.'
                : 'Évaluation asymétrique T → T_adv → T+1 anticipant les ripostes adverses, Ordres du Boss et bris de main.' }}
            </p>
          </div>

          <div class="mo-card-elevated p-5 space-y-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg" style="background-color: rgba(255, 194, 26, 0.14); color: var(--brand-gold)">
              <Server class="h-5 w-5" />
            </div>
            <h3 class="font-bold text-sm" style="color: var(--text-primary)">API Hybride &amp; Workers</h3>
            <p class="text-xs leading-relaxed" style="color: var(--text-secondary)">
              {{ isEn
                ? 'PostgreSQL + Fastify API backing client Web Workers, with seamless offline JSON catalog fallback when disconnected.'
                : 'API Fastify + PostgreSQL couplée aux Web Workers client, avec repli offline automatique sur le catalogue JSON intégré.' }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Beta Tester CTA -->
    <section class="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div
        class="rounded-2xl border p-8 sm:p-10 text-center"
        style="
          background: radial-gradient(circle at top center, rgba(255, 107, 0, 0.16), transparent 65%), var(--bg-surface);
          border-color: rgba(255, 107, 0, 0.4);
          box-shadow: var(--brand-glow);
        "
      >
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-white"
          style="background: var(--brand-gradient)"
        >
          <Sparkles class="h-3.5 w-3.5" />
          {{ isEn ? 'Beta Feedback Program' : 'Programme Bêta-Testeurs' }}
        </span>

        <h2 class="mt-4 text-2xl font-black sm:text-3xl" style="color: var(--text-primary)">
          {{ isEn
            ? 'Help Calibrate the Oracle for the Standard Metagame'
            : 'Participez au calibrage de Meta Oracle pour le format Standard' }}
        </h2>
        <p class="mx-auto mt-3 max-w-2xl text-sm sm:text-base" style="color: var(--text-secondary)">
          {{ isEn
            ? 'Share your tournament decklists, suggest priority mechanics for Pythia AI Arena, and report card edge cases in under 2 minutes.'
            : 'Partagez vos retours de test sur vos listes de tournoi, votez pour les fonctionnalités prioritaires de l’Arène Pythia et signalez les cas limites en moins de 2 minutes.' }}
        </p>

        <div class="mt-7 flex flex-wrap items-center justify-center gap-4">
          <a
            :href="BETA_FEEDBACK_FORM_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="mo-btn-solar inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-sm font-bold"
          >
            <span>{{ isEn ? 'Open Beta Questionnaire' : 'Devenir Bêta-Testeur (Google Form)' }}</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  FlaskConical,
  GitBranch,
  Server,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-vue-next'
import { BETA_FEEDBACK_FORM_URL, MetaOracleLogo } from '@meta-oracle/ui'

const config = useRuntimeConfig()
const lang = inject<Ref<'fr' | 'en'>>('metaOracleLang', ref('fr'))
const isEn = computed(() => lang.value === 'en')

useSeoMeta({
  title: 'Meta Oracle — Simulateur Stratégique & IA Prédictive Pokémon TCG',
  description:
    'Écosystème compétitif Pokémon TCG : simulateur Monte-Carlo multi-threads (854 cartes compilées), atelier A/B, parseur PTCGL et future arène IA contre Pythia 3-ply.',
  ogTitle: 'Meta Oracle — Simulateur Monte-Carlo & Oracle Tactique Pokémon TCG',
  ogDescription:
    'Testez vos decklists 60 cartes contre le métagame grâce à l’anticipation asymétrique 3-ply et optimisez vos ratios avec l’atelier A/B.',
  ogType: 'website',
  ogUrl: 'https://meta-oracle.com',
  twitterCard: 'summary_large_image',
  twitterTitle: 'Meta Oracle — Pokémon TCG 3-Ply Analytics',
  twitterDescription:
    'Simulateur Monte-Carlo haute performance et future arène IA contre le bot Pythia 3-ply.',
})

useHead({
  link: [{ rel: 'canonical', href: 'https://meta-oracle.com/' }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Meta Oracle',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Web',
        url: 'https://meta-oracle.com',
        description:
          'Simulateur Monte-Carlo 3-ply haute vélocité et plateforme d’analyse stratégique pour Pokémon TCG Standard.',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'EUR',
        },
      }),
    },
  ],
})
</script>
