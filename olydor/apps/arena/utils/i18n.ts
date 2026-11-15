import { computed, getCurrentInstance, onMounted } from 'vue'
import { createI18n, type OlydorLang } from '@olydor/ui'

export const arenaTranslations = {
  fr: {
    comingSoonSuperTitle: 'COMING SOON',
    heroBadge: 'ARÈNE TACTIQUE 1v1 — EN DÉVELOPPEMENT (COMING SOON)',
    heroTitlePrefix: 'Affrontez ',
    heroTitleMiddle: ', l’IA Lookahead 3-Ply de ',
    heroSubtitle:
      'L’Arène interactive 1v1 d’Olydor est actuellement en construction. Entraînez-vous bientôt en duel manuel contre une intelligence artificielle anticipant votre tour, sa contre-attaque et votre riposte (T → T_adv → T+1).',
    milestone1Label: 'Moteur 3-Ply & Zobrist',
    milestone1Status: 'Opérationnel',
    milestone2Label: 'Olydor Insight Simulator',
    milestone2Status: 'Ouvert en Bêta',
    milestone3Label: 'Arène Tactique Pythia 1v1',
    milestone3Status: 'Bientôt disponible',
    ctaVoteBeta: 'Voter pour les priorités de l’Arène (Bêta)',
    ctaSimNow: 'Simuler 1 000 parties sur Insight',

    deckValidBadge: 'Deck PTCGL Importé & Validé via Deep-Link (?deck=)',
    deckDecodedBadge: 'Deck PTCGL Décrypté via Deep-Link (?deck=)',
    deckValidHeadline:
      "Votre deck de 60 cartes est prêt et validé pour l'Arène ! En attendant l'ouverture des duels interactifs en 1v1, lancez un duel automatisé de 1 000 parties contre Pythia sur le Simulateur.",
    deckIncompleteHeadline:
      "{count} cartes décodées depuis le Simulateur (format standard attendu : 60 cartes). En attendant l'ouverture des duels interactifs en 1v1, ajustez ou lancez votre liste contre Pythia sur le Simulateur.",
    deckErrorHeadline:
      'Le paramètre ?deck= n’a pas pu être décodé. Vérifiez le lien exporté depuis Insight.',
    deckStatTotal: 'Total :',
    deckStatPokemon: 'Pokémon :',
    deckStatTrainers: 'Dresseurs :',
    deckStatEnergy: 'Énergies :',
    deckStatResolution: 'Résolution moteur :',
    deckResolutionReady: '100% prête',
    deckResolutionPartial: 'Partielle',
    deckLaunchSimBtn: 'Lancer 1 000 parties sur Insight',
    deckMoreCards: '+{count} autres cartes',

    boardTitle: 'Aperçu Interactif — Plateau de Duel 1v1',
    boardBadge: 'Simulation Temps Réel',
    boardSubtitlePrefix: 'Joueur vs ',
    boardSubtitleSuffix: ' — Moteur @olydor/engine 3-Ply Lookahead',
    playerLabel: 'Joueur',
    pythiaLabel: 'Pythia (IA 3-Ply)',
    pythiaTag: 'Pythia (IA)',
    prizesLabel: 'Récompenses :',
    handShortLabel: 'Main :',
    activeSpotAi: 'Poste Actif (IA)',
    benchAi: 'Banc (IA)',
    activeSpotPlayer: 'Poste Actif (Joueur)',
    benchPlayer: 'Banc (Joueur)',
    vsDividerSuffix: ' · Zone de Confrontation',

    thoughtLogTitle: 'Journal de Pensée 3-Ply (Pythia)',
    blunderTitle: 'Blunder Analysis — Aperçu Post-Match',
    blunderBadTitle: '✕ Coup joué : Ordres du Boss sur Fezandipiti ex',
    blunderBadDesc:
      'Expose votre attaquant principal à un contre-KO immédiat (probabilité chute à 47%).',
    blunderGoodTitle: '✓ Ligne Optimale 3-Ply : Échange + Iono + Bribe',
    blunderGoodDesc:
      'Force l’adversaire à 2 cartes en main et sécurise votre Setup T+1 sans bris de prix.',

    archTitle: 'Sous le capot de Pythia 3-Ply',
    archItem1Title: 'Zobrist 53-bit & Transposition Table',
    archItem1Desc:
      'Hachage commutatif dédupliquant instantanément les permutations d’ordre sur Banc ou en Main.',
    archItem2Title: 'Moteur Flat Buffer zero-allocation',
    archItem2Desc:
      'Mutations mutateInPlace zéro-GC permettant d’évaluer des milliers de séquences en millisecondes.',
    archItem3Title: 'Blunder Analysis Automatisée',
    archItem3Desc:
      'Compare chaque décision humaine face au Top-3 des branches calculées et chiffre le delta d’EV.',

    roadmapBadge: 'Feuille de route ouverte aux testeurs',
    roadmapTitle: "Quelle fonctionnalité voulez-vous en premier dans l'Arène ?",
    roadmapSubtitle:
      'Priorisez les modules d’entraînement interactifs à déployer dès la fin de la Bêta du Simulateur :',
    roadmapItem1Title: 'Takeback & Replay de branche',
    roadmapItem1Desc:
      'Revenir d’un coup en arrière pour tester une alternative face à Pythia et voir l’évolution de la Win Probability.',
    roadmapItem2Title: 'Coach en direct (Live Hints)',
    roadmapItem2Desc:
      'Affichage temps réel des 3 meilleures séquences suggérées pendant votre tour avec score EV.',
    roadmapItem3Title: 'Puzzles de fin de partie (Lethal / Prize Map)',
    roadmapItem3Desc:
      'Défis quotidiens issus de vraies parties compétitives où un seul séquençage mène à la victoire.',
    roadmapFooter: 'Sondage communautaire Olydor (30 sec)',
    roadmapVoteBtn: 'Voter via Google Form',

    seoTitle: 'Olydor Arena — Duel 1v1 vs Pythia IA 3-Ply (Coming Soon)',
    seoDescription:
      'Affrontez Pythia, l’IA 3-Ply Lookahead d’Olydor en duel 1v1 Pokémon TCG : barre de Win Probability, journal tactique T → T_adv → T+1 et Blunder Analysis.',
  },
  en: {
    comingSoonSuperTitle: 'COMING SOON',
    heroBadge: '1v1 TACTICAL ARENA — UNDER DEVELOPMENT (COMING SOON)',
    heroTitlePrefix: 'Challenge ',
    heroTitleMiddle: ", Olydor's 3-Ply Lookahead AI — ",
    heroSubtitle:
      'The interactive 1v1 Olydor Arena is currently under active development. Soon you will play manual duels against a deterministic AI lookahead engine evaluating T → T_opp → T+1 branches live.',
    milestone1Label: '3-Ply Engine & Zobrist',
    milestone1Status: 'Operational',
    milestone2Label: 'Olydor Insight Simulator',
    milestone2Status: 'Open Beta',
    milestone3Label: 'Pythia 1v1 Tactical Arena',
    milestone3Status: 'Coming Soon',
    ctaVoteBeta: 'Vote on Arena Roadmap (Beta)',
    ctaSimNow: 'Simulate 1,000 Games on Insight',

    deckValidBadge: 'PTCGL Deck Validated via Deep-Link (?deck=)',
    deckDecodedBadge: 'PTCGL Deck Decoded via Deep-Link (?deck=)',
    deckValidHeadline:
      'Your 60-card deck is validated and Arena-ready! While 1v1 interactive duels are in development, run 1,000 automated games against Pythia in the Insight Simulator.',
    deckIncompleteHeadline:
      '{count} cards decoded from Insight (Standard requires 60 cards). Refine or benchmark your deck against Pythia in the Simulator while 1v1 Arena opens.',
    deckErrorHeadline:
      'Could not decode the ?deck= query parameter. Check the exported link from Insight.',
    deckStatTotal: 'Total:',
    deckStatPokemon: 'Pokémon:',
    deckStatTrainers: 'Trainers:',
    deckStatEnergy: 'Energy:',
    deckStatResolution: 'Engine resolution:',
    deckResolutionReady: '100% ready',
    deckResolutionPartial: 'Partial',
    deckLaunchSimBtn: 'Run 1,000 Games on Insight',
    deckMoreCards: '+{count} more cards',

    boardTitle: 'Interactive Preview — 1v1 Duel Board',
    boardBadge: 'Real-Time Mockup',
    boardSubtitlePrefix: 'Player vs ',
    boardSubtitleSuffix: ' — @olydor/engine 3-Ply Lookahead',
    playerLabel: 'Player',
    pythiaLabel: 'Pythia (3-Ply AI)',
    pythiaTag: 'Pythia (AI)',
    prizesLabel: 'Prizes:',
    handShortLabel: 'Hand:',
    activeSpotAi: 'Active Spot (AI)',
    benchAi: 'Bench (AI)',
    activeSpotPlayer: 'Active Spot (Player)',
    benchPlayer: 'Bench (Player)',
    vsDividerSuffix: ' · Combat Zone',

    thoughtLogTitle: '3-Ply Thought Stream (Pythia)',
    blunderTitle: 'Blunder Analysis — Post-Match Preview',
    blunderBadTitle: "✕ Played Line: Boss's Orders on Fezandipiti ex",
    blunderBadDesc:
      'Exposes your main attacker to an immediate return KO (win odds drop to 47%).',
    blunderGoodTitle: '✓ Optimal 3-Ply Line: Switch + Iono + Prime Catcher',
    blunderGoodDesc:
      'Disrupts opponent hand down to 2 cards and secures your T+1 prize map cleanly.',

    archTitle: 'Inside Pythia 3-Ply Architecture',
    archItem1Title: 'Zobrist 53-bit & Transposition Table',
    archItem1Desc:
      'Commutative state hashing deduplicating Bench and Hand permutations instantaneously.',
    archItem2Title: 'Zero-Allocation Flat Buffer Engine',
    archItem2Desc:
      'In-place zero-GC mutations evaluating thousands of tactical branches per millisecond.',
    archItem3Title: 'Automated Blunder Analysis',
    archItem3Desc:
      'Compares every human action against the Top-3 computed lines and quantifies EV delta.',

    roadmapBadge: 'Beta Community Roadmap',
    roadmapTitle: 'Which feature do you want first in the Arena?',
    roadmapSubtitle:
      'Help prioritize the interactive training modules shipping right after Simulator Beta:',
    roadmapItem1Title: 'Takeback & Branch Replay',
    roadmapItem1Desc:
      'Step back one move to test an alternative sequence against Pythia and watch Win Probability react.',
    roadmapItem2Title: 'Live Tactical Coach (Hints)',
    roadmapItem2Desc:
      'Real-time EV ranking of the top 3 suggested action sequences during your turn.',
    roadmapItem3Title: 'Endgame Lethal / Prize Puzzles',
    roadmapItem3Desc:
      'Daily competitive scenarios extracted from tournament games with one winning line.',
    roadmapFooter: 'Olydor Community Survey (30 sec)',
    roadmapVoteBtn: 'Vote via Google Form',

    seoTitle: 'Olydor Arena — 1v1 Duel vs Pythia 3-Ply AI (Coming Soon)',
    seoDescription:
      'Coming soon: battle Pythia, Olydor’s 3-Ply Lookahead Pokémon TCG AI with live Win Probability Bar and post-game Blunder Analysis.',
  },
} as const

export type ArenaTranslationKey = keyof typeof arenaTranslations.fr

export function useArenaI18n(langOverride?: () => OlydorLang | undefined) {
  const instance = createI18n<ArenaTranslationKey>(arenaTranslations, langOverride)
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
