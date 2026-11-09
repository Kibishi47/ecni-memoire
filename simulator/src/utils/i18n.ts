import { ref } from 'vue'

export type Language = 'fr' | 'en'

const savedLang =
  typeof localStorage !== 'undefined'
    ? (localStorage.getItem('poketcg_lang') as Language | null)
    : null

export const currentLang = ref<Language>(savedLang === 'en' ? 'en' : 'fr')

export function setLanguage(lang: Language) {
  currentLang.value = lang
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('poketcg_lang', lang)
  }
}

export function toggleLanguage() {
  setLanguage(currentLang.value === 'fr' ? 'en' : 'fr')
}

export const translations: Record<Language, Record<string, string>> = {
  fr: {
    // Header & Steps
    appTitle: 'PokéSim TCG',
    appSubtitle: 'Simulateur Compétitif & Optimisation A/B',
    step1Title: 'Deck & Synergies',
    step1Short: '1. Import Deck',
    step2Title: 'Configuration Matchups',
    step2Short: '2. Paramètres',
    step3Title: 'Résultats & Atelier A/B',
    step3Short: '3. Résultats & A/B',
    langFr: 'FR',
    langEn: 'EN',

    // Step 1 - Hero & Import
    heroBadge: 'Moteur de Simulation Compétitif 3-Ply',
    heroTitle: 'Optimisez Votre Deck Pokémon TCG Face à la Méta',
    heroDescription:
      'Importez votre liste PTCGL en 1 clic. Analysez la cohérence, simulez des centaines de parties contre le top méta du moment et découvrez les alternatives optimales.',
    pasteDeckPlaceholder: 'Collez ici votre liste de deck exportée depuis Pokémon TCG Live...',
    importButton: 'Importer et Valider le Deck',
    deckValidated: 'Deck Validé',
    cardsRequired: '60 / 60 cartes requises',
    deckIncomplete: 'Deck Incomplet',
    synergyAuditTitle: 'Audit des Synergies du Deck',
    pokemonCount: 'Pokémon',
    trainerCount: 'Dresseurs',
    energyCount: 'Énergies',
    btnConfigure: 'Configurer la Simulation',
    synergyIssues: 'Points d attention détectés',
    ruleBasicRequired: 'Au moins 1 Pokémon de base est obligatoire.',
    ruleExact60: 'Le deck doit contenir exactement 60 cartes.',
    unresolvedCardsAlert: 'carte(s) non reconnue(s) dans la base.',

    // Step 2 - Config
    step2Heading: 'Paramètres de Simulation',
    step2Subheading:
      'Sélectionnez un profil adapté à votre machine et choisissez les matchups à affronter.',
    perfProfileTitle: 'Profil de Performance & Vitesse',
    perfProfileSub: 'Ajusté automatiquement selon les capacités de votre ordinateur',
    profileLightning: 'Éclair',
    profileLightningDesc: '60 parties - Idéal pour un test ultrarapide',
    profileFast: 'Rapide',
    profileFastDesc: '150 parties - Excellent compromis rapidité / précision',
    profileBalanced: 'Équilibré',
    profileBalancedDesc: '300 parties - Profil recommandé par défaut',
    profilePrecise: 'Précis',
    profilePreciseDesc: '600 parties - Analyse statistique approfondie',
    profileTournament: 'Tournoi',
    profileTournamentDesc: '1200 parties - Précision maximale pour tournois majeurs',
    turnOrderTitle: 'Initiative du Premier Tour',
    turnOrderSub: 'Choisissez les conditions de premier tour pour les simulations',
    turnOrderRandom: 'Aléatoire (50/50 Standard)',
    turnOrderFirst: 'Jouer en Premier (J1)',
    turnOrderSecond: 'Jouer en Second (J2)',
    metaMatchupsTitle: 'Matchups Méta à Affronter',
    metaMatchupsSub: 'Sélectionnez les decks adverses contre lesquels simuler',
    btnLaunchSimulation: 'Lancer la Simulation',

    // Step 3 - Dashboard & Comparator
    globalPerformance: 'Performances Globales',
    comparedVariant: 'Variante A/B Comparée',
    globalWinRate: 'Taux de Victoire Global',
    vsBaseline: 'vs deck initial',
    simulatedGamesCount: 'Basé sur {n} parties simulées face aux decks méta sélectionnés.',
    rerunSimulation: 'Relancer la simulation',
    testVariantAndCompare: 'Tester cette variante et comparer',
    adjustDeckTo60: 'Ajustez le deck ({n} / 60 cartes requises)',
    exportPtcglVariant: 'Exporter la variante PTCGL',
    simulatingProgress: 'Simulation en cours... {done} / {total} parties',

    // Version History
    versionHistoryTitle: 'Historique des Versions',
    versionLabel: 'Version {v}',
    initialVersion: 'Initiale',
    restoreVersion: 'Restaurer',
    setAsBaseline: 'Définir comme référence',
    currentActiveVersion: 'Version Active',
    saveAsNewVersion: 'Sauvegarder nouvelle version',
    newVersionBadge: 'Nouvelle version',

    // Step 3 Tabs
    tabOverview: 'Vue d ensemble',
    tabDetailedStats: 'Statistiques Détaillées',
    tabCardAudit: 'Audit des Cartes',

    // KPIs
    kpiSectionTitle: 'Indicateurs Clés de Stabilité & Efficacité',
    kpiSectionSub: 'Mesures de consistance au cours des parties simulées',
    kpiSetupSpeed: 'Vitesse de Setup (T1/T2)',
    kpiSetupSpeedDesc: 'Attaquant prêt et alimenté en énergie dès le Tour 2.',
    kpiAttackStreaming: 'Enchaînement d Attaque',
    kpiAttackStreamingDesc: 'Capacité à riposter immédiatement après avoir subi un KO.',
    kpiDisruptionResilience: 'Résilience aux Perturbations',
    kpiDisruptionResilienceDesc: 'Taux de reprise après une carte comme Mashynn ou Tampon Injuste.',
    kpiBossFlexibility: 'Flexibilité Ordres du Boss',
    kpiBossFlexibilityDesc: 'Attaquer et cibler le banc sans bloquer sa propre pioche.',

    // Detailed Stats
    turnOrderHeader: 'Ordre du Tour & Pression T1',
    turnOrderStatsSub: 'Performance selon l initiative et capacité d item-lock dès le T1',
    winRateJ1: 'Win Rate en J1 (1er)',
    winRateJ2: 'Win Rate en J2 (2d)',
    turn1AttackLockJ2: 'Attaque / Item-Lock T1 en J2',
    turn1ItemLockDesc: 'Verrouillage d Objets T1 J2 (Pollen Démangeant) :',
    avgDamagePerTurn: 'Dégâts Moyens / Tour :',

    prizeMulliganHeader: 'Économie de Récompenses & Régularité',
    avgPlayerPrizes: 'Prizes Moyens Joueur',
    prizesTakenPerMatch: 'Récompenses prises / match',
    avgOpponentPrizes: 'Prizes Moyens Adversaire',
    prizesConcededPerMatch: 'Récompenses concédées',
    netPrizeDifferential: 'Différentiel net :',
    mulliganRate: 'Taux de Mulligan',
    gamesWithMulligan: 'partie(s) avec au moins un mulligan',
    avgTurnsPerGame: 'Moyenne Tours / Match',
    simSpeed: 'Débit Simulation',

    winReasonsHeader: 'Raisons de Victoire',
    reasonPrizes: 'Toutes Récompenses Prises',
    reasonBenchWipe: 'Banc Adverse Éliminé',
    reasonDeckOut: 'Deck-Out Adverse',

    conditionalCombosHeader: 'Combos Conditionnels & Attaques Clés',
    comboCardAction: 'Carte & Action',
    comboCondition: 'Condition Requise',
    comboTriggerRate: 'Taux Déclenchement',
    comboFirstTurn: '1er Tour Moyen',
    comboAvgDamage: 'Dégâts Moyens',

    // Card Audit
    cardAuditHeader: 'Audit d Utilité Carte par Carte',
    cardAuditSub:
      'Repérez les cartes mortes en main, les défausses inutiles et mesurez le risque de Prize Lock',
    colCard: 'Carte du Deck',
    colPlayRate: 'Taux de Jeu Effectif (%)',
    colDeadDiscardRate: 'Carte Morte / Défaussée sans effet (%)',
    colPrizedImpact: 'Impact si Prized (Tous exemplaires)',
    colAlternatives: 'Alternatives Intelligentes',

    // Atelier & Alternatives
    deckComposition: 'Composition du Deck',
    clickCardForAlternatives: 'Cliquez sur une carte pour voir ses alternatives et son image',
    suggestedAlternatives: 'Alternatives Suggérées',
    replaceInDeck: 'Remplacer dans le deck',
    searchAddCard: 'Rechercher une carte à ajouter (ex: Mashynn, Poffin)...',
    addCard: '+ Ajouter',
    altCountBadge: '{n} alt.',

    // Export Modal
    exportModalTitle: 'Exporter la variante optimisée (60 cartes)',
    formatReadyForPtcgl: 'Format prêt à coller dans Pokémon TCG Live :',
    copyClipboard: 'Copier dans le presse-papier',
    downloadTxt: 'Télécharger .txt',
    copiedSuccess: 'Liste copiée !',

    // Card Zoom Modal
    closeModal: 'Fermer',
    cardDetails: 'Détails de la Carte',
    rulesAndEffects: 'Règles et Effets',
    clickToEnlarge: 'Cliquer pour agrandir',
    cardHp: 'PV',
  },
  en: {
    // Header & Steps
    appTitle: 'PokéSim TCG',
    appSubtitle: 'Competitive Simulator & A/B Deck Optimizer',
    step1Title: 'Deck & Synergies',
    step1Short: '1. Import Deck',
    step2Title: 'Matchup Configuration',
    step2Short: '2. Settings',
    step3Title: 'Results & A/B Workshop',
    step3Short: '3. Results & A/B',
    langFr: 'FR',
    langEn: 'EN',

    // Step 1 - Hero & Import
    heroBadge: '3-Ply Competitive Simulation Engine',
    heroTitle: 'Optimize Your Pokémon TCG Deck Against the Meta',
    heroDescription:
      'Import your PTCGL decklist in 1 click. Analyze consistency, simulate hundreds of games against the top meta, and discover optimal alternatives.',
    pasteDeckPlaceholder: 'Paste your decklist exported from Pokémon TCG Live here...',
    importButton: 'Import and Validate Deck',
    deckValidated: 'Deck Validated',
    cardsRequired: '60 / 60 cards required',
    deckIncomplete: 'Incomplete Deck',
    synergyAuditTitle: 'Deck Synergy Audit',
    pokemonCount: 'Pokémon',
    trainerCount: 'Trainers',
    energyCount: 'Energy',
    btnConfigure: 'Configure Simulation',
    synergyIssues: 'Synergy points detected',
    ruleBasicRequired: 'At least 1 Basic Pokémon is required.',
    ruleExact60: 'Deck must contain exactly 60 cards.',
    unresolvedCardsAlert: 'unresolved card(s) in database.',

    // Step 2 - Config
    step2Heading: 'Simulation Settings',
    step2Subheading:
      'Select a profile adapted to your hardware and choose the matchups to face.',
    perfProfileTitle: 'Performance Profile & Speed',
    perfProfileSub: 'Automatically calibrated to your computer capabilities',
    profileLightning: 'Lightning',
    profileLightningDesc: '60 games - Ideal for an ultrarapid test',
    profileFast: 'Fast',
    profileFastDesc: '150 games - Great balance between speed and precision',
    profileBalanced: 'Balanced',
    profileBalancedDesc: '300 games - Recommended default profile',
    profilePrecise: 'Precise',
    profilePreciseDesc: '600 games - In-depth statistical analysis',
    profileTournament: 'Tournament',
    profileTournamentDesc: '1200 games - Maximum precision for major events',
    turnOrderTitle: 'First Turn Initiative',
    turnOrderSub: 'Choose first turn conditions for the simulation runs',
    turnOrderRandom: 'Random (50/50 Standard)',
    turnOrderFirst: 'Go First (P1)',
    turnOrderSecond: 'Go Second (P2)',
    metaMatchupsTitle: 'Meta Matchups to Face',
    metaMatchupsSub: 'Select the opponent decks to benchmark against',
    btnLaunchSimulation: 'Run Simulation',

    // Step 3 - Dashboard & Comparator
    globalPerformance: 'Global Performance',
    comparedVariant: 'A/B Compared Variant',
    globalWinRate: 'Global Win Rate',
    vsBaseline: 'vs initial deck',
    simulatedGamesCount: 'Based on {n} simulated games against selected meta decks.',
    rerunSimulation: 'Rerun simulation',
    testVariantAndCompare: 'Test this variant & compare',
    adjustDeckTo60: 'Adjust deck ({n} / 60 cards required)',
    exportPtcglVariant: 'Export PTCGL Variant',
    simulatingProgress: 'Simulation in progress... {done} / {total} games',

    // Version History
    versionHistoryTitle: 'Deck Version History',
    versionLabel: 'Version {v}',
    initialVersion: 'Initial',
    restoreVersion: 'Restore',
    setAsBaseline: 'Set as Baseline',
    currentActiveVersion: 'Active Version',
    saveAsNewVersion: 'Save as new version',
    newVersionBadge: 'New version',

    // Step 3 Tabs
    tabOverview: 'Overview',
    tabDetailedStats: 'Detailed Stats',
    tabCardAudit: 'Card Utility Audit',

    // KPIs
    kpiSectionTitle: 'Key Consistency & Efficiency Indicators',
    kpiSectionSub: 'Consistency metrics measured across simulated games',
    kpiSetupSpeed: 'Setup Speed (T1/T2)',
    kpiSetupSpeedDesc: 'Attacker ready and powered with energy by Turn 2.',
    kpiAttackStreaming: 'Attack Streaming',
    kpiAttackStreamingDesc: 'Ability to revenge attack immediately after suffering a KO.',
    kpiDisruptionResilience: 'Disruption Resilience',
    kpiDisruptionResilienceDesc: 'Recovery rate after opponent plays Iono or Unfair Stamp.',
    kpiBossFlexibility: 'Boss\'s Orders Flexibility',
    kpiBossFlexibilityDesc: 'Attack and target the bench without stalling your draw engine.',

    // Detailed Stats
    turnOrderHeader: 'Turn Order & T1 Pressure',
    turnOrderStatsSub: 'Performance by initiative and ability to attack or item-lock on T1',
    winRateJ1: 'Win Rate Going First (P1)',
    winRateJ2: 'Win Rate Going Second (P2)',
    turn1AttackLockJ2: 'T1 Attack / Item-Lock Going 2nd',
    turn1ItemLockDesc: 'T1 Item Lock Going 2nd (Itchy Pollen):',
    avgDamagePerTurn: 'Avg Damage / Turn:',

    prizeMulliganHeader: 'Prize Trade & Consistency',
    avgPlayerPrizes: 'Avg Player Prizes Taken',
    prizesTakenPerMatch: 'Prizes taken / match',
    avgOpponentPrizes: 'Avg Opponent Prizes Conceded',
    prizesConcededPerMatch: 'Prizes conceded',
    netPrizeDifferential: 'Net differential:',
    mulliganRate: 'Mulligan Rate',
    gamesWithMulligan: 'game(s) with at least one mulligan',
    avgTurnsPerGame: 'Avg Turns / Game',
    simSpeed: 'Simulation Speed',

    winReasonsHeader: 'Win Reasons',
    reasonPrizes: 'All Prizes Taken',
    reasonBenchWipe: 'Opponent Bench Cleared',
    reasonDeckOut: 'Opponent Deck Out',

    conditionalCombosHeader: 'Conditional Combos & Key Attacks',
    comboCardAction: 'Card & Action',
    comboCondition: 'Condition Required',
    comboTriggerRate: 'Trigger Rate',
    comboFirstTurn: 'Avg First Turn',
    comboAvgDamage: 'Avg Damage',

    // Card Audit
    cardAuditHeader: 'Card-by-Card Utility Audit',
    cardAuditSub:
      'Spot dead cards in hand, useless discards, and evaluate prize lock risk',
    colCard: 'Deck Card',
    colPlayRate: 'Effective Play Rate (%)',
    colDeadDiscardRate: 'Dead Card / Discarded Unused (%)',
    colPrizedImpact: 'Impact When Prized (All copies)',
    colAlternatives: 'Smart Alternatives',

    // Atelier & Alternatives
    deckComposition: 'Deck Composition',
    clickCardForAlternatives: 'Click a card to see its alternatives and artwork',
    suggestedAlternatives: 'Suggested Alternatives',
    replaceInDeck: 'Replace in deck',
    searchAddCard: 'Search a card to add (e.g. Iono, Buddy-Buddy Poffin)...',
    addCard: '+ Add',
    altCountBadge: '{n} alt.',

    // Export Modal
    exportModalTitle: 'Export Optimized Variant (60 cards)',
    formatReadyForPtcgl: 'Format ready to paste in Pokémon TCG Live:',
    copyClipboard: 'Copy to clipboard',
    downloadTxt: 'Download .txt',
    copiedSuccess: 'List copied!',

    // Card Zoom Modal
    closeModal: 'Close',
    cardDetails: 'Card Details',
    rulesAndEffects: 'Rules & Effects',
    clickToEnlarge: 'Click to enlarge',
    cardHp: 'HP',
  },
}

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = currentLang.value
  let text = translations[lang]?.[key] ?? translations.fr[key] ?? String(key)
  if (params) {
    for (const [pKey, pVal] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal))
    }
  }
  return text
}

export function useI18n() {
  return {
    currentLang,
    setLanguage,
    toggleLanguage,
    t,
  }
}
