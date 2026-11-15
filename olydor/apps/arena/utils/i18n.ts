import { computed, getCurrentInstance, onMounted } from 'vue'
import { createI18n, type OlydorLang } from '@olydor/ui'

export const arenaTranslations = {
  fr: {
    comingSoonSuperTitle: 'COMING SOON',
    heroBadge: 'ARÈNE 1v1 VS BOT PYTHIA — EN DÉVELOPPEMENT (COMING SOON)',
    heroTitlePrefix: 'Affrontez le bot ',
    heroTitleMiddle: ' en duel 1v1 sur ',
    heroSubtitle:
      'L’Arène interactive d’Olydor est actuellement en construction. Disputez bientôt de vrais matchs 1v1 tour par tour contre le bot autonome Pythia sur un plateau Pokémon TCG complet.',
    milestone1Label: 'Moteur de Règles Pokémon TCG',
    milestone1Status: 'Opérationnel',
    milestone2Label: 'Olydor Insight Simulator',
    milestone2Status: 'Ouvert en Alpha',
    milestone3Label: 'Arène 1v1 vs Bot Pythia',
    milestone3Status: 'Bientôt disponible',
    ctaVoteAlpha: 'Voter pour les priorités de l’Arène (Alpha)',
    ctaSimNow: 'Simuler 1 000 parties sur Insight',

    deckValidBadge: 'Deck PTCGL Importé & Validé via Deep-Link (?deck=)',
    deckDecodedBadge: 'Deck PTCGL Décrypté via Deep-Link (?deck=)',
    deckValidHeadline:
      "Votre deck de 60 cartes est prêt et validé ! En attendant l'ouverture des matchs 1v1 contre le bot Pythia dans l'Arène, testez votre liste sur 1 000 parties automatisées sur Insight.",
    deckIncompleteHeadline:
      "{count} cartes décodées depuis Insight (format standard attendu : 60 cartes). En attendant l'ouverture des duels 1v1 contre le bot Pythia, ajustez ou testez votre liste sur le Simulateur.",
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

    boardTitle: 'Aperçu — Plateau de Duel 1v1 vs Bot Pythia',
    boardBadge: 'Duel Sans Assistance',
    boardSubtitlePrefix: 'Match Joueur vs ',
    boardSubtitleSuffix: ' — Plateau Pokémon TCG Standard',
    playerLabel: 'Vous (Joueur)',
    pythiaLabel: 'Bot Pythia',
    pythiaTag: 'Bot Pythia',
    prizesLabel: 'Récompenses :',
    handShortLabel: 'Main :',
    activeSpotAi: 'Poste Actif (Adversaire)',
    benchAi: 'Banc (Adversaire)',
    activeSpotPlayer: 'Poste Actif (Vous)',
    benchPlayer: 'Banc (Vous)',
    vsDividerSuffix: ' · Zone de Combat',

    matchLogTitle: 'Journal des Actions du Tour',
    matchRulesBadge: 'Duel Libre',
    matchRulesTitle: 'Conditions Réelles de Partie',
    matchRulesItem1Title: 'Adversaire autonome',
    matchRulesItem1Desc:
      'Pythia joue son tour comme un adversaire réel : ses plans et sa main restent entièrement cachés.',
    matchRulesItem2Title: 'Aucune aide ni coaching',
    matchRulesItem2Desc:
      'Pas de suggestion de coup, pas d’indicateur de probabilité de victoire et pas d’indices en direct.',

    archTitle: 'Ce que proposera l’Arène 1v1',
    archItem1Title: 'Affrontement 1v1 contre le bot Pythia',
    archItem1Desc:
      'Enchaînez des duels complets tour par tour face au bot Pythia pour tester vos sorties et décisions en match.',
    archItem2Title: 'Sélection du deck joué par Pythia',
    archItem2Desc:
      'Choisissez librement l’archétype méta que Pythia pilote contre votre deck afin de travailler vos matchups.',
    archItem3Title: 'Import rapide de vos 60 cartes',
    archItem3Desc:
      'Importez votre liste depuis Pokémon TCG Live ou Insight et affrontez directement le bot sur plateau.',

    roadmapBadge: 'Feuille de route ouverte aux testeurs',
    roadmapTitle: "Qu'attendez-vous en priorité pour les duels contre Pythia ?",
    roadmapSubtitle:
      'Priorisez les premiers ajouts pour le mode duel 1v1 contre le bot dès son lancement :',
    roadmapItem1Title: 'Choix étendu de decks adverses pour Pythia',
    roadmapItem1Desc:
      'Sélectionner n’importe quel deck du format Standard pour que Pythia le joue contre vous.',
    roadmapItem2Title: 'Choix de l’ordre de jeu (Tour 1 / Tour 2)',
    roadmapItem2Desc:
      'Décider de commencer premier ou deuxième pour entraîner des séquences d’ouverture précises.',
    roadmapItem3Title: 'Enchaînement rapide en Best-of-3',
    roadmapItem3Desc:
      'Disputer une série de 2 ou 3 manches contre le même adversaire IA sans recharger votre deck.',
    roadmapFooter: 'Sondage communautaire Olydor (30 sec)',
    roadmapVoteBtn: 'Voter via Google Form',

    seoTitle: 'Olydor Arena — Duel 1v1 vs Bot Pythia (Coming Soon)',
    seoDescription:
      'Affrontez prochainement le bot IA Pythia en duel 1v1 Pokémon TCG sur un plateau interactif sans assistance.',
    hpUnit: 'PV',
    legalMentionsSeoTitle: 'Mentions Légales — Olydor Arena',
    legalMentionsSeoDesc: 'Mentions légales et informations réglementaires d’Olydor Arena (arena.olydor.app).',
    legalPrivacySeoTitle: 'Politique de Confidentialité (RGPD) — Olydor Arena',
    legalPrivacySeoDesc: 'Politique de confidentialité et protection des données RGPD sur Olydor Arena.',
    legalTermsSeoTitle: 'Conditions Générales d’Utilisation — Olydor Arena',
    legalTermsSeoDesc: 'Conditions générales d’utilisation d’Olydor Arena (arena.olydor.app).',
  },
  en: {
    comingSoonSuperTitle: 'COMING SOON',
    heroBadge: '1v1 ARENA VS PYTHIA BOT — UNDER DEVELOPMENT (COMING SOON)',
    heroTitlePrefix: 'Battle the ',
    heroTitleMiddle: ' bot in 1v1 duels on ',
    heroSubtitle:
      'The interactive Olydor Arena is currently under active development. Soon you will play full turn-by-turn 1v1 Pokémon TCG matches against the autonomous Pythia bot on an interactive board.',
    milestone1Label: 'Pokémon TCG Rules Engine',
    milestone1Status: 'Operational',
    milestone2Label: 'Olydor Insight Simulator',
    milestone2Status: 'Open Alpha',
    milestone3Label: '1v1 Arena vs Pythia Bot',
    milestone3Status: 'Coming Soon',
    ctaVoteAlpha: 'Vote on Arena Roadmap (Alpha)',
    ctaSimNow: 'Simulate 1,000 Games on Insight',

    deckValidBadge: 'PTCGL Deck Validated via Deep-Link (?deck=)',
    deckDecodedBadge: 'PTCGL Deck Decoded via Deep-Link (?deck=)',
    deckValidHeadline:
      'Your 60-card deck is validated! While 1v1 matches against the Pythia bot are in development, run 1,000 automated benchmark games in the Insight Simulator.',
    deckIncompleteHeadline:
      '{count} cards decoded from Insight (Standard requires 60 cards). Refine or benchmark your deck in the Simulator while 1v1 Arena vs Pythia opens.',
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

    boardTitle: 'Preview — 1v1 Duel Board vs Pythia Bot',
    boardBadge: 'Unassisted Duel',
    boardSubtitlePrefix: 'Player vs ',
    boardSubtitleSuffix: ' — Standard Pokémon TCG Board',
    playerLabel: 'You (Player)',
    pythiaLabel: 'Pythia Bot',
    pythiaTag: 'Pythia Bot',
    prizesLabel: 'Prizes:',
    handShortLabel: 'Hand:',
    activeSpotAi: 'Active Spot (Opponent)',
    benchAi: 'Bench (Opponent)',
    activeSpotPlayer: 'Active Spot (You)',
    benchPlayer: 'Bench (You)',
    vsDividerSuffix: ' · Battle Board',

    matchLogTitle: 'Turn Action Log',
    matchRulesBadge: 'Pure Duel',
    matchRulesTitle: 'Realistic Match Rules',
    matchRulesItem1Title: 'Autonomous bot opponent',
    matchRulesItem1Desc:
      'Pythia plays its turns like a real opponent — its hidden hand and internal plans are never exposed.',
    matchRulesItem2Title: 'Pure match conditions (no coaching)',
    matchRulesItem2Desc:
      'No move suggestions or tactical coaching — every decision on the board is yours alone.',

    archTitle: 'What the 1v1 Arena Offers',
    archItem1Title: 'Head-to-Head Duels vs Pythia Bot',
    archItem1Desc:
      'Play complete turn-by-turn Pokémon TCG matches against Pythia to test your decklist under match pressure.',
    archItem2Title: 'Pick Pythia’s Meta Decklist',
    archItem2Desc:
      'Select any curated competitive archetype for Pythia to pilot against you and practice key matchups.',
    archItem3Title: '1-Click 60-Card Deck Import',
    archItem3Desc:
      'Import your list directly from Pokémon TCG Live or Insight and jump into a bot match.',

    roadmapBadge: 'Alpha Community Roadmap',
    roadmapTitle: 'Which feature do you want first for Pythia bot matches?',
    roadmapSubtitle:
      'Help prioritize the first features shipping for the 1v1 bot duel mode:',
    roadmapItem1Title: 'Expanded Meta Deck Roster for Pythia',
    roadmapItem1Desc:
      'Choose freely which Standard metagame deck Pythia plays against your list.',
    roadmapItem2Title: 'Going First / Going Second Selector',
    roadmapItem2Desc:
      'Specifically practice your Turn 1 or Turn 2 setups against the bot.',
    roadmapItem3Title: 'Quick Best-of-3 Match Flow',
    roadmapItem3Desc:
      'Play a 3-game set back-to-back against the same opponent list without re-importing.',
    roadmapFooter: 'Olydor Community Survey (30 sec)',
    roadmapVoteBtn: 'Vote via Google Form',

    seoTitle: 'Olydor Arena — 1v1 Duel vs Pythia Bot (Coming Soon)',
    seoDescription:
      'Coming soon: battle the Pythia AI bot in unassisted 1v1 Pokémon TCG duels on an interactive board.',
    hpUnit: 'HP',
    legalMentionsSeoTitle: 'Legal Notice — Olydor Arena',
    legalMentionsSeoDesc: 'Legal notice and regulatory information for Olydor Arena (arena.olydor.app).',
    legalPrivacySeoTitle: 'Privacy Policy (GDPR) — Olydor Arena',
    legalPrivacySeoDesc: 'Privacy policy and GDPR data protection on Olydor Arena.',
    legalTermsSeoTitle: 'Terms of Service — Olydor Arena',
    legalTermsSeoDesc: 'Terms of service for Olydor Arena (arena.olydor.app).',
  },
} as const

export interface ArenaScenario {
  id: string
  label: string
  turnLabel: string
  playerDeck: string
  pythiaDeck: string
  playerPrizes: number
  pythiaPrizes: number
  playerActive: { name: string; hp: string; energy: string; status: string }
  pythiaActive: { name: string; hp: string; energy: string; status: string }
  playerBench: string[]
  pythiaBench: string[]
  actionLog: { actor: 'PLAYER' | 'PYTHIA'; phase: string; action: string }[]
}

export function getLocalizedArenaScenarios(lang: OlydorLang): ArenaScenario[] {
  if (lang === 'en') {
    return [
      {
        id: 'midgame-charizard',
        label: 'Turn 3 · Charizard vs Dragapult',
        turnLabel: 'Turn 3 (Main Phase)',
        playerDeck: 'Charizard ex / Pidgeot',
        pythiaDeck: 'Dragapult ex / Dusknoir',
        playerPrizes: 3,
        pythiaPrizes: 4,
        playerActive: {
          name: 'Charizard ex',
          hp: '330 / 330',
          energy: '2x Fire Energy (Darkness Tera)',
          status: 'Burning Darkness ready',
        },
        pythiaActive: {
          name: 'Dragapult ex',
          hp: '200 / 320',
          energy: '1x Fire + 1x Psychic',
          status: '6 damage counters spread on Bench',
        },
        playerBench: ['Pidgeot ex', 'Charmander · 70 HP', 'Fezandipiti ex'],
        pythiaBench: ['Drakloak · 90 HP', 'Duskull · 60 HP', 'Dusknoir'],
        actionLog: [
          {
            actor: 'PYTHIA',
            phase: 'Turn 2 · Attack',
            action: 'Dragapult ex uses Phantom Dive (200 damage to Active Spot).',
          },
          {
            actor: 'PLAYER',
            phase: 'Turn 3 · Action',
            action: 'Rare Candy evolves Charmander into Charizard ex (Infernal Reign triggered).',
          },
          {
            actor: 'PLAYER',
            phase: 'Turn 3 · Attack',
            action: 'Charizard ex prepares Burning Darkness against Dragapult ex.',
          },
        ],
      },
      {
        id: 't1-lock',
        label: 'Turn 1 (P2) · Budew Item-Lock',
        turnLabel: 'Turn 1 Player 2',
        playerDeck: 'Gardevoir ex / Munkidori',
        pythiaDeck: 'Gholdengo ex / Budew',
        playerPrizes: 6,
        pythiaPrizes: 6,
        playerActive: {
          name: 'Ralts',
          hp: '70 / 70',
          energy: '1x Psychic Energy',
          status: 'Items locked on next turn',
        },
        pythiaActive: {
          name: 'Budew',
          hp: '30 / 30',
          energy: '0 Energy',
          status: 'Itchy Pollen active',
        },
        playerBench: ['Munkidori', 'Ralts · 70 HP'],
        pythiaBench: ['Gimmighoul · 70 HP', 'Gimmighoul · 70 HP', 'Radiant Greninja'],
        actionLog: [
          {
            actor: 'PLAYER',
            phase: 'Turn 1 · Setup',
            action: 'Places Ralts in Active Spot, attaches 1 Psychic Energy and ends turn.',
          },
          {
            actor: 'PYTHIA',
            phase: 'Turn 1 P2 · Bench',
            action: 'Plays Buddy-Buddy Poffin and benches two Gimmighoul.',
          },
          {
            actor: 'PYTHIA',
            phase: 'Turn 1 P2 · Attack',
            action: 'Budew uses Itchy Pollen (10 damage, Items blocked next turn).',
          },
        ],
      },
    ]
  }
  return [
    {
      id: 'midgame-charizard',
      label: 'Tour 3 · Charizard vs Dragapult',
      turnLabel: 'Tour 3 (Phase Principale)',
      playerDeck: 'Charizard ex / Pidgeot',
      pythiaDeck: 'Dragapult ex / Dusknoir',
      playerPrizes: 3,
      pythiaPrizes: 4,
      playerActive: {
        name: 'Dracaufeu ex',
        hp: '330 / 330',
        energy: '2x Énergie Feu (Obscurité Téra)',
        status: 'Obscurité Enflammée disponible',
      },
      pythiaActive: {
        name: 'Lanssorien ex',
        hp: '200 / 320',
        energy: '1x Feu + 1x Psy',
        status: '6 marqueurs de dégâts sur le Banc',
      },
      playerBench: ['Roucarnage ex', 'Salamèche · 70 PV', 'Favianos ex'],
      pythiaBench: ['Dispareptil · 90 PV', 'Skelénox · 60 PV', 'Noctunoir'],
      actionLog: [
        {
          actor: 'PYTHIA',
          phase: 'Tour 2 · Attaque',
          action: 'Lanssorien ex utilise Fantôme Plongeant (200 dégâts sur le Poste Actif).',
        },
        {
          actor: 'PLAYER',
          phase: 'Tour 3 · Action',
          action: 'Super Bonbon joue Dracaufeu ex depuis Salamèche (Talent Règne Infernal activé).',
        },
        {
          actor: 'PLAYER',
          phase: 'Tour 3 · Attaque',
          action: 'Dracaufeu ex prépare Obscurité Enflammée sur Lanssorien ex.',
        },
      ],
    },
    {
      id: 't1-lock',
      label: 'Tour 1 (J2) · Budew Item-Lock',
      turnLabel: 'Tour 1 Joueur 2',
      playerDeck: 'Gardevoir ex / Munkidori',
      pythiaDeck: 'Gholdengo ex / Budew',
      playerPrizes: 6,
      pythiaPrizes: 6,
      playerActive: {
        name: 'Tarsal',
        hp: '70 / 70',
        energy: '1x Énergie Psy',
        status: 'Verrouillage Objets Actif au prochain tour',
      },
      pythiaActive: {
        name: 'Rozbouton (Budew)',
        hp: '30 / 30',
        energy: '0 Énergie',
        status: 'Pollen Démangeant actif',
      },
      playerBench: ['Fortusimia', 'Tarsal · 70 PV'],
      pythiaBench: ['Mordudor · 70 PV', 'Mordudor · 70 PV', 'Amphinobi Radieux'],
      actionLog: [
        {
          actor: 'PLAYER',
          phase: 'Tour 1 · Préparation',
          action: 'Pose Tarsal en Actif, attache 1 Énergie Psy et passe le tour.',
        },
        {
          actor: 'PYTHIA',
          phase: 'Tour 1 J2 · Banc',
          action: 'Joue Poffin Copain-Copain et place deux Mordudor sur le Banc.',
        },
        {
          actor: 'PYTHIA',
          phase: 'Tour 1 J2 · Attaque',
          action: 'Rozbouton utilise Pollen Démangeant (10 dégâts, Objets bloqués au prochain tour).',
        },
      ],
    },
  ]
}

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
