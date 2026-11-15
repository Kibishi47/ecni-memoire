import { computed, getCurrentInstance, onMounted } from 'vue'
import { createI18n, type OlydorLang } from '@olydor/ui'

export const webTranslations = {
  fr: {
    heroSubtitle: 'Ne devinez plus la méta. Simulez chaque branche.',
    heroDescription:
      'Évaluez vos decklists de 60 cartes sur des centaines de parties parallélisées en Web Workers, identifiez vos tours morts et optimisez chaque slot grâce à l’atelier comparatif A/B.',
    heroLaunchSim: 'Lancer le Simulateur',
    heroArenaDisabled: 'Arène IA Pythia — Bientôt disponible',
    soonBadge: 'SOON',

    statPrimitivesTitle: 'Couverture Moteur',
    statPrimitivesValue: '29',
    statPrimitivesSub: 'Primitives TCG exécutables',
    statHorizonTitle: 'Horizon Tactique',
    statHorizonValue: '3-Ply',
    statStateTitle: 'État Binaire',
    statStateValue: '53-bit',
    statKpiTitle: 'Indicateurs Clés',
    statKpiValue: '8 KPIs',
    statKpiSub: '+ 6 analyses méta',

    platformsTitle: 'Deux Plateformes Spécialisées, Un Cœur Algorithmique Commun',
    platformsSubtitle:
      'Propulsées par le moteur partagé @olydor/engine s’exécutant aussi bien dans les Web Workers navigateur que sur l’API serveur.',

    simDomain: 'insight.olydor.app',
    simStatusBadge: 'DISPONIBLE EN BÊTA',
    simCardTitle: 'Simulateur Monte-Carlo & Atelier A/B',
    simCardDesc:
      'Importez votre decklist PTCGL, auditez instantanément vos 60 cartes et synergies clés, puis lancez jusqu’à 1 000 parties parallèles contre le métagame.',
    simFeature1: '8 KPIs officiels : Winrate, Setup T2, Brick Rate, Cartes Mortes, Mulligans',
    simFeature2: '6 analyses poussées : Topdecking, Joueur 1 vs Joueur 2, Matrice Récompenses',
    simFeature3: 'Comparateur A/B (Upgrades / Sidegrades) & export PTCGL en 1 clic',
    simPresetCta: 'Tester avec un deck méta en 1 clic →',
    simOpenCta: 'Ouvrir le Simulateur',

    arenaDomain: 'arena.olydor.app',
    arenaStatusBadge: 'COMING SOON',
    arenaCardTitle: 'Arène IA — Affrontez Pythia 3-Ply',
    arenaCardDesc:
      'Affrontez directement l’IA Pythia coup par coup sur un plateau interactif, visualisez la jauge Win Probability en temps réel et analysez vos blunders.',
    arenaFeature1: 'Journal de pensée 3-ply exposant les plans de récompenses de Pythia',
    arenaFeature2: 'Import direct via ?deck= depuis l’Atelier A/B du Simulateur',
    arenaFeature3: 'Analyse Post-Match identifiant les KOs manqués et lignes optimales',
    arenaStatusNote: 'Phase d’entraînement Pythia en cours',
    arenaDisabledAction: 'Accès prochainement ouvert',

    archTitle: 'Architecture & Performance Technique',
    archSubtitle:
      'De la compilation LLM des textes de cartes jusqu’au hachage 53-bit, chaque brique vise la fiabilité compétitive et la vitesse d’exécution.',
    archCompilerTitle: 'LLM Card Compiler',
    archCompilerDesc:
      'Compilateur offline structurant les textes officiels en 29 primitives atomiques, préconditions et poids stratégiques par tour.',
    archZobristTitle: 'Zobrist 53-bit & Flat Buffers',
    archZobristDesc:
      'Hachage commutatif Zobrist 53-bit pour dédupliquer les permutations de Banc/Main et mutations en place sur Int32Array(128).',
    archLookaheadTitle: 'Lookahead 3-Ply Pythia',
    archLookaheadDesc:
      'Évaluation asymétrique T → T_adv → T+1 anticipant les ripostes adverses, Ordres du Boss et bris de main.',
    archHybridTitle: 'API Hybride & Workers',
    archHybridDesc:
      'API Fastify + PostgreSQL couplée aux Web Workers client, avec repli offline automatique sur le catalogue intégré.',

    betaBadge: 'Programme Bêta-Testeurs',
    betaTitle: 'Participez au calibrage d’Olydor pour le format Standard',
    betaDesc:
      'Partagez vos retours de test sur vos listes de tournoi, votez pour les fonctionnalités prioritaires de l’Arène Pythia et signalez les cas limites en moins de 2 minutes.',
    betaCta: 'Devenir Bêta-Testeur (Google Form)',

    seoTitle: 'Olydor — Simulateur Stratégique & IA Prédictive Pokémon TCG',
    seoDescription:
      'Écosystème compétitif Pokémon TCG : simulateur Monte-Carlo multi-threads dynamique, atelier A/B, parseur PTCGL et future arène IA contre Pythia 3-ply.',
    ogTitle: 'Olydor — Simulateur Monte-Carlo & Analyse Tactique Pokémon TCG',
    ogDescription:
      'Testez vos decklists 60 cartes contre le métagame grâce à l’anticipation asymétrique 3-ply et optimisez vos ratios avec l’atelier A/B.',
    twitterTitle: 'Olydor — Pokémon TCG 3-Ply Analytics',
    twitterDescription:
      'Simulateur Monte-Carlo haute performance et future arène IA contre le bot Pythia 3-ply.',
    schemaDescription:
      'Simulateur Monte-Carlo 3-ply haute vélocité et plateforme d’analyse stratégique pour Pokémon TCG Standard.',
  },
  en: {
    heroSubtitle: 'Stop guessing the meta. Simulate every branch.',
    heroDescription:
      'Stress-test your 60-card lists across hundreds of multi-threaded Web Worker games against meta archetypes, pinpoint consistency bricks, and optimize card slots with A/B simulation.',
    heroLaunchSim: 'Launch Simulator',
    heroArenaDisabled: 'Pythia AI Arena — Coming Soon',
    soonBadge: 'SOON',

    statPrimitivesTitle: 'Engine Coverage',
    statPrimitivesValue: '29',
    statPrimitivesSub: 'Executable TCG primitives',
    statHorizonTitle: 'Decision Tree',
    statHorizonValue: '3-Ply',
    statStateTitle: 'State Hashing',
    statStateValue: '53-bit',
    statKpiTitle: 'Analytics Suite',
    statKpiValue: '8 KPIs',
    statKpiSub: '+ 6 tactical probes',

    platformsTitle: 'Two Dedicated Platforms, One Shared Engine',
    platformsSubtitle:
      'Built around the zero-DOM @olydor/engine package running seamlessly in browser Web Workers and Node.js.',

    simDomain: 'insight.olydor.app',
    simStatusBadge: 'AVAILABLE IN BETA',
    simCardTitle: 'Monte Carlo Deck Simulator & A/B Lab',
    simCardDesc:
      'Import any PTCGL list, validate 60 cards and Ace Spec / evolution synergies automatically, then run 50 to 1,000 parallel games against curated meta lists.',
    simFeature1: '8 Core KPIs: Winrate, T2 Setup, Brick Rate, Dead Cards, Mulligans',
    simFeature2: '6 Deep Probes: Topdeck, Going First vs Second, Prize Map',
    simFeature3: 'A/B Comparison & 1-click PTCGL Export',
    simPresetCta: 'Try a meta deck in 1 click →',
    simOpenCta: 'Open Simulator',

    arenaDomain: 'arena.olydor.app',
    arenaStatusBadge: 'COMING SOON',
    arenaCardTitle: 'AI Arena — Challenge Pythia 3-Ply',
    arenaCardDesc:
      'Play full manual turns directly against Olydor’s 3-ply AI bot Pythia, inspect real-time win probability shifts, and review post-game tactical blunders.',
    arenaFeature1: 'Live 3-ply thought stream explaining Pythia’s prize & sequencing lines',
    arenaFeature2: 'Direct ?deck= URL import straight from Olydor Insight',
    arenaFeature3: 'Post-Match Blunder Analysis highlighting missed KOs & gust plays',
    arenaStatusNote: 'Currently in AI training phase',
    arenaDisabledAction: 'Opening soon',

    archTitle: 'Engineered for Speed & Rule Precision',
    archSubtitle:
      'Every layer from offline LLM card compilation to browser worker bit-packing is built to make full TCG lookahead practical.',
    archCompilerTitle: 'LLM Card Compiler',
    archCompilerDesc:
      'Offline Python pipeline normalizing card rules into 29 atomic primitives, preconditions, and strategic turn-phase weights.',
    archZobristTitle: 'Zobrist 53-bit & Flat Buffers',
    archZobristDesc:
      'Commutative Zobrist state hashing, transposition tables, and in-place mutation over Int32Array(128) buffers.',
    archLookaheadTitle: 'Lookahead 3-Ply Pythia',
    archLookaheadDesc:
      'Asymmetric T → T_adv → T+1 evaluation anticipates opponent counterplay, gust threats, and disruption recovery.',
    archHybridTitle: 'Hybrid API & Workers',
    archHybridDesc:
      'PostgreSQL + Fastify API backing client Web Workers, with seamless built-in catalog fallback when offline.',

    betaBadge: 'Beta Feedback Program',
    betaTitle: 'Help Calibrate Olydor for the Standard Metagame',
    betaDesc:
      'Share your tournament decklists, suggest priority mechanics for Pythia AI Arena, and report card edge cases in under 2 minutes.',
    betaCta: 'Open Beta Questionnaire',

    seoTitle: 'Olydor — Strategic Pokémon TCG Simulator & Predictive AI',
    seoDescription:
      'Competitive Pokémon TCG ecosystem: dynamic multi-threaded Monte Carlo simulator, A/B lab, PTCGL parser, and upcoming Pythia 3-ply AI Arena.',
    ogTitle: 'Olydor — Monte Carlo Simulator & Tactical Pokémon TCG Analytics',
    ogDescription:
      'Stress-test 60-card decklists against the metagame with 3-ply lookahead AI and optimize card slots in the A/B lab.',
    twitterTitle: 'Olydor — Pokémon TCG 3-Ply Analytics',
    twitterDescription:
      'High-throughput Monte Carlo simulator and upcoming AI Arena against Pythia 3-ply.',
    schemaDescription:
      'High-throughput 3-ply Monte Carlo simulator and strategic analytics platform for Standard Pokémon TCG.',
  },
} as const

export type WebTranslationKey = keyof typeof webTranslations.fr

export function useWebI18n(langOverride?: () => OlydorLang | undefined) {
  const instance = createI18n<WebTranslationKey>(webTranslations, langOverride)
  if (getCurrentInstance()) {
    onMounted(() => {
      instance.initLanguage()
    })
  } else if (typeof window !== 'undefined') {
    instance.initLanguage()
  }
  return {
    ...instance,
    lang: computed(() => instance.activeLang.value),
  }
}
