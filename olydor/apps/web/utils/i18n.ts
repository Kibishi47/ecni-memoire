import { computed, getCurrentInstance, onMounted } from 'vue'
import { createI18n, type OlydorLang } from '@olydor/ui'

export const webTranslations = {
  fr: {
    heroSubtitle: 'Ne devinez plus la méta. Simulez chaque branche.',
    heroDescription:
      'Évaluez vos decklists de 60 cartes sur des centaines de parties parallélisées dans votre navigateur, identifiez vos tours morts et optimisez chaque slot grâce à l’atelier comparatif A/B.',
    heroLaunchSim: 'Lancer le Simulateur',
    heroArenaDisabled: 'Arène 1v1 vs Bot Pythia — Bientôt disponible',
    soonBadge: 'SOON',

    platformsTitle: 'Deux Plateformes Complémentaires Pour Vos Tournois',
    platformsSubtitle:
      'Analysez mathématiquement la régularité de vos listes sur Insight et préparez-vous bientôt à disputer de vrais matchs contre le bot Pythia dans l’Arène.',

    simDomain: 'insight.olydor.app',
    simStatusBadge: 'DISPONIBLE EN ALPHA',
    simCardTitle: 'Simulateur Monte-Carlo & Atelier A/B',
    simCardDesc:
      'Importez votre decklist PTCGL, auditez instantanément vos 60 cartes et synergies clés, puis lancez jusqu’à 1 000 parties parallèles contre le métagame.',
    simFeature1: 'Indicateurs clés : Winrate, Setup T2, Brick Rate, Cartes Mortes, Mulligans',
    simFeature2: 'Analyses détaillées : Topdecking, Joueur 1 vs Joueur 2, Matrice Récompenses',
    simFeature3: 'Comparateur A/B (Upgrades / Sidegrades) & export PTCGL en 1 clic',
    simPresetCta: 'Tester avec un deck méta en 1 clic →',
    simOpenCta: 'Ouvrir le Simulateur',

    arenaDomain: 'arena.olydor.app',
    arenaStatusBadge: 'COMING SOON',
    arenaCardTitle: 'Arène 1v1 — Affrontez le Bot Pythia',
    arenaCardDesc:
      'Disputez de véritables matchs tour par tour sur un plateau interactif face au bot autonome Pythia afin de tester votre deck en conditions réelles, sans assistance.',
    arenaFeature1: 'Duel 1v1 complet contre le bot Pythia (Poste Actif, Banc, Récompenses, Stade)',
    arenaFeature2: 'Choix libre du deck méta piloté par Pythia face à votre liste',
    arenaFeature3: 'Import direct de votre decklist 60 cartes depuis Pokémon TCG Live ou Insight',
    arenaStatusNote: 'Mode duel en préparation',
    arenaDisabledAction: 'Bientôt disponible',

    archTitle: 'Pourquoi préparer vos decks sur Olydor ?',
    archSubtitle:
      'Des outils pensés pour les joueurs compétitifs afin de fiabiliser chaque liste avant de passer à la table de jeu.',
    archCompilerTitle: 'Import PTCGL en 1 Clic',
    archCompilerDesc:
      'Collez votre decklist exportée depuis Pokémon TCG Live : détection instantanée des 60 cartes, chaînes d’évolution et Ace Spec.',
    archMetaBenchTitle: 'Benchmarks Contre la Méta',
    archMetaBenchDesc:
      'Mesurez automatiquement votre taux de victoire et votre vitesse de mise en place face aux archétypes populaires du format Standard.',
    archLookaheadTitle: 'Comparateur A/B Précis',
    archLookaheadDesc:
      'Remplacez 1 ou 2 cartes dans votre liste et comparez côte à côte l’impact réel sur la régularité et les sorties Tour 2.',
    archHybridTitle: 'Futur Duel 1v1 vs Pythia',
    archHybridDesc:
      'Préparez et affinez vos listes sur Insight aujourd’hui pour affronter bientôt le bot autonome Pythia dans l’Arène.',

    alphaBadge: 'Programme Alpha-Testeurs',
    alphaTitle: 'Participez au calibrage d’Olydor pour le format Standard',
    alphaDesc:
      'L’IA Pythia est encore en cours de refonte : partagez vos retours de test sur vos listes de tournoi, votez pour les priorités des duels 1v1 et signalez les cas limites en moins de 2 minutes.',
    alphaCta: 'Devenir Alpha-Testeur (Google Form)',

    seoTitle: 'Olydor — Simulateur Stratégique & Duel IA Pokémon TCG',
    seoDescription:
      'Écosystème compétitif Pokémon TCG : simulateur Monte-Carlo multi-threads dynamique, atelier A/B, parseur PTCGL et future arène de duel 1v1 contre le bot Pythia.',
    ogTitle: 'Olydor — Simulateur Monte-Carlo & Analyse Pokémon TCG',
    ogDescription:
      'Testez vos decklists 60 cartes contre le métagame grâce à la simulation massive et optimisez vos ratios avec l’atelier A/B.',
    twitterTitle: 'Olydor — Pokémon TCG Simulator & Bot Arena',
    twitterDescription:
      'Simulateur Monte-Carlo haute performance et future arène 1v1 contre le bot Pythia.',
    schemaDescription:
      'Simulateur Monte-Carlo haute vélocité et plateforme d’analyse de decklists pour Pokémon TCG Standard.',
    legalMentionsSeoTitle: 'Mentions Légales — Olydor',
    legalMentionsSeoDesc: 'Mentions légales et informations réglementaires de l’écosystème Olydor (olydor.app).',
    legalPrivacySeoTitle: 'Politique de Confidentialité (RGPD) — Olydor',
    legalPrivacySeoDesc: 'Politique de confidentialité et protection des données RGPD sur Olydor.',
    legalTermsSeoTitle: 'Conditions Générales d’Utilisation — Olydor',
    legalTermsSeoDesc: 'Conditions générales d’utilisation des plateformes Olydor (Hub, Simulateur, Arène IA).',
  },
  en: {
    heroSubtitle: 'Stop guessing the meta. Simulate every branch.',
    heroDescription:
      'Stress-test your 60-card lists across hundreds of multi-threaded Web Worker games against meta archetypes, pinpoint consistency bricks, and optimize card slots with A/B simulation.',
    heroLaunchSim: 'Launch Simulator',
    heroArenaDisabled: '1v1 Arena vs Pythia Bot — Coming Soon',
    soonBadge: 'SOON',

    platformsTitle: 'Two Dedicated Platforms for Your Tournament Prep',
    platformsSubtitle:
      'Benchmark list consistency mathematically in Insight, and soon play full 1v1 matches directly against the Pythia AI bot in the Arena.',

    simDomain: 'insight.olydor.app',
    simStatusBadge: 'AVAILABLE IN ALPHA',
    simCardTitle: 'Monte Carlo Deck Simulator & A/B Lab',
    simCardDesc:
      'Import any PTCGL list, validate 60 cards and Ace Spec / evolution synergies automatically, then run 50 to 1,000 parallel games against curated meta lists.',
    simFeature1: 'Core KPIs: Winrate, T2 Setup, Brick Rate, Dead Cards, Mulligans',
    simFeature2: 'Deep Probes: Topdeck, Going First vs Second, Prize Map',
    simFeature3: 'A/B Comparison & 1-click PTCGL Export',
    simPresetCta: 'Try a meta deck in 1 click →',
    simOpenCta: 'Open Simulator',

    arenaDomain: 'arena.olydor.app',
    arenaStatusBadge: 'COMING SOON',
    arenaCardTitle: '1v1 Arena — Challenge the Pythia Bot',
    arenaCardDesc:
      'Play full turn-by-turn matches on an interactive board against the autonomous Pythia bot to test your deck in unassisted, tournament-like duel conditions.',
    arenaFeature1: 'Full 1v1 match vs Pythia bot (Active Spot, Bench, Prizes, Stadium)',
    arenaFeature2: 'Select which competitive meta deck Pythia pilots against you',
    arenaFeature3: 'Direct 60-card decklist import from Pokémon TCG Live or Insight',
    arenaStatusNote: 'Bot duel mode in development',
    arenaDisabledAction: 'Coming soon',

    archTitle: 'Why Prepare Your Decks on Olydor?',
    archSubtitle:
      'Practical tools designed for competitive players to validate ratios and openings before sitting at the table.',
    archCompilerTitle: '1-Click PTCGL Import',
    archCompilerDesc:
      'Paste your decklist exported from Pokémon TCG Live for instant 60-card validation, evolution lines, and Ace Spec detection.',
    archMetaBenchTitle: 'Benchmarks vs the Meta',
    archMetaBenchDesc:
      'Run hundreds of automated games against popular Standard archetypes to measure setup consistency and win rates.',
    archLookaheadTitle: 'Precise A/B Comparator',
    archLookaheadDesc:
      'Swap 1 or 2 slots in your list and immediately compare how each tweak shifts opening reliability and Turn 2 setup.',
    archHybridTitle: 'Upcoming 1v1 Bot Arena',
    archHybridDesc:
      'Refine your decklists in Insight today and get ready to battle the Pythia bot directly in 1v1 Arena matches.',

    alphaBadge: 'Alpha Feedback Program',
    alphaTitle: 'Help Calibrate Olydor for the Standard Metagame',
    alphaDesc:
      'The Pythia AI is still being reworked: share your tournament decklist test feedback, vote on upcoming 1v1 bot battle priorities, and report card edge cases in under 2 minutes.',
    alphaCta: 'Open Alpha Questionnaire',

    seoTitle: 'Olydor — Strategic Pokémon TCG Simulator & 1v1 Bot Arena',
    seoDescription:
      'Competitive Pokémon TCG ecosystem: dynamic multi-threaded Monte Carlo simulator, A/B lab, PTCGL parser, and upcoming 1v1 battle Arena vs the Pythia bot.',
    ogTitle: 'Olydor — Monte Carlo Simulator & Tactical Pokémon TCG Analytics',
    ogDescription:
      'Stress-test 60-card decklists against the metagame and optimize card slots in the A/B lab.',
    twitterTitle: 'Olydor — Pokémon TCG Simulator & Bot Arena',
    twitterDescription:
      'High-throughput Monte Carlo simulator and upcoming 1v1 Arena against the Pythia bot.',
    schemaDescription:
      'High-throughput Monte Carlo simulator and strategic deck analysis platform for Standard Pokémon TCG.',
    legalMentionsSeoTitle: 'Legal Notice — Olydor',
    legalMentionsSeoDesc: 'Legal notice and regulatory information for the Olydor ecosystem (olydor.app).',
    legalPrivacySeoTitle: 'Privacy Policy (GDPR) — Olydor',
    legalPrivacySeoDesc: 'Privacy policy and GDPR data protection on Olydor.',
    legalTermsSeoTitle: 'Terms of Service — Olydor',
    legalTermsSeoDesc: 'Terms of service for the Olydor platforms (Hub, Simulator, AI Arena).',
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
