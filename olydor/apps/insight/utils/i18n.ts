import type { EngineCardModel, ParsedDeckEntry } from '@olydor/types'
import {
  currentOlydorLang,
  initOlydorLanguage,
  setOlydorLanguage,
  toggleOlydorLanguage,
} from '@olydor/ui'

export type Language = 'fr' | 'en'

export const currentLang = currentOlydorLang

export function setLanguage(lang: Language) {
  setOlydorLanguage(lang)
}

export function toggleLanguage() {
  toggleOlydorLanguage()
}

export function pickLocalizedField<T>(frValue: T, enValue?: T | null): T {
  if (currentLang.value === 'en' && enValue !== undefined && enValue !== null) {
    if (typeof enValue === 'string' && enValue.length === 0) {
      return frValue
    }
    if (Array.isArray(enValue) && enValue.length === 0) {
      return frValue
    }
    return enValue
  }
  return frValue
}

export const translations: Record<Language, Record<string, string>> = {
  fr: {
    // Header & Steps
    appTitle: 'Olydor Insight',
    appSubtitle: 'Simulateur Monte-Carlo 3-Ply & Atelier A/B',
    debugModeBadge: 'MODE DEBUG (?debug=true)',
    sendToArena: 'Affronter le bot Pythia dans l’Arène',
    offlineCatalogBanner: 'Mode hybride offline actif : catalogue local embarqué utilisé.',
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
    awaitingDecklist: 'En attente de votre decklist',
    pasteDecklistPrompt: 'Collez votre decklist dans la zone de texte puis cliquez sur Valider.',
    distinctCardsDetected: '{n} références de cartes distinctes détectées.',
    deckSynergyVerification: 'Vérification des cartes requises par vos attaquants et moteurs',
    synergiesValidated: '{done} / {total} synergies validées',
    synergySatisfied: 'Validé',
    synergyMissing: 'Manquant',
    unresolvedCardsTitle: 'Cartes non reconnues ({n}) :',

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
    turnOrderRandomDesc: 'Simule un pile ou face réaliste à chaque manche',
    turnOrderFirst: 'Jouer en Premier (J1)',
    turnOrderFirstDesc: 'Votre deck commence 100% des parties au T1',
    turnOrderSecond: 'Jouer en Second (J2)',
    turnOrderSecondDesc: 'Votre deck joue toujours en second (attaque T1 autorisée)',
    metaMatchupsTitle: 'Matchups Méta à Affronter',
    metaMatchupsSub: 'Sélectionnez les decks adverses contre lesquels simuler',
    btnLaunchSimulation: 'Lancer la Simulation',
    selectAll: 'Tout sélectionner',
    recommended: 'Recommandé',
    threatsLabel: 'Menaces',
    modifyDeck: 'Modifier mon deck',
    cancelSimulation: 'Annuler la simulation',
    simulationCancelled: 'Simulation interrompue par l utilisateur.',
    simulationErrorHeading: 'Une erreur est survenue pendant l exécution de la simulation',
    closeAlert: 'Fermer l alerte',
    hardwareDetected: 'Hardware : {n} cœurs détectés',
    invalidDeckStep1: 'Deck invalide : veuillez revenir à l étape 1',
    selectAtLeastOneOpp: 'Sélectionnez au moins un adversaire',
    gamesUnit: 'parties',

    // Step 2 - Hardware Calibration, Quick Selectors & Advanced Drawer
    hwCalibratedBanner: 'Calibration Matérielle Détectée',
    hwRecalibrateBtn: 'Recalibrer',
    hwCoresUnit: '{n} cœurs logiques',
    hwScoreLabel: 'Indice CPU : {score}',
    hwClusterSpeed: 'Capacité estimée : ~{gps} parties/sec',
    hwTierEco: 'Profil Éco',
    hwTierBalanced: 'Équilibré',
    hwTierPerformance: 'Performance',
    hwTierExtreme: 'Station Extrême',
    tabQuickSettings: 'Réglages Rapides',
    tabAdvancedSettings: 'Paramètres Avancés',
    estDurationLabel: 'Durée estimée',
    estSpeedLabel: 'Débit estimé',
    estSpeedValue: '~{gps} parties/sec',
    estLiveCalibrated: 'Auto-calibré',
    selectorCpuTitle: '1. Puissance PC (CPU)',
    selectorCpuSub: 'Ressources utilisées sur votre ordinateur',
    cpuEcoLabel: 'Léger (40%)',
    cpuEcoDesc: 'Garde votre PC silencieux',
    cpuBalancedLabel: 'Normal (75%)',
    cpuBalancedDesc: 'Idéal par défaut',
    cpuMaxLabel: 'Maximum (100%)',
    cpuMaxDesc: 'Vitesse maximale',
    selectorVolumeTitle: '2. Nombre de parties',
    selectorVolumeSub: 'Plus il y a de parties, plus le résultat est fiable',
    volFlashLabel: 'Aperçu rapide',
    volFlashDesc: '150 parties',
    volStandardLabel: 'Standard',
    volStandardDesc: '500 parties',
    volTournamentLabel: 'Tournoi',
    volTournamentDesc: '2000 parties',
    volDeepLabel: 'Très précis',
    volDeepDesc: '5000 parties',
    selectorAiTitle: '3. Niveau de l’IA',
    selectorAiSub: 'Qualité des décisions prises pendant les parties',
    aiFastLabel: 'Basique',
    aiFastDesc: 'Rapide • coup par coup',
    aiCompLabel: 'Standard',
    aiCompDesc: 'Anticipe la riposte adverse',
    aiExpertLabel: 'Expert',
    aiExpertDesc: 'Réflexion approfondie',
    advancedToggleTitle: 'Paramètres Avancés du Moteur',
    advancedToggleSub: 'Réglage fin des 14 leviers IA, exécution, ordonnancement et stress-tests',
    advancedCustomBadge: 'Personnalisé',
    advancedResetBtn: 'Réinitialiser',
    advGroupAiTitle: 'A. Recherche & Évaluateur IA',
    advGroupExecTitle: 'B. Règles d’Exécution & Partie',
    advGroupWorkersTitle: 'C. Parallélisme & Ordonnancement',
    advGroupStatsTitle: 'D. Télémétrie & Stress-Tests',
    advLookaheadPly: 'Profondeur Lookahead (Ply)',
    advMaxBranches: 'Plafond de branches / tour',
    advBeamWidth: 'Largeur du Beam ({n})',
    advTopK: 'Candidats Top-K évalués ({n})',
    advMaxActionDepth: 'Actions max / tour IA ({n})',
    advRolloutMaxActions: 'Actions rollout T_adv / T+1 ({n})',
    advAiTemperament: 'Tempérament Stratégique',
    tempBalanced: 'Équilibré (0.35 / 0.30 / 0.35)',
    tempAggressive: 'Agressif (0.45 / 0.25 / 0.30)',
    tempConservative: 'Conservateur (0.25 / 0.45 / 0.30)',
    advOpponentLookahead: 'Anticipation Adversaire (Ply)',
    advOpponentBranches: 'Branches max Adversaire',
    advIterations: 'Nombre d’itérations',
    advMaxTurns: 'Tours maximum / partie ({n})',
    advFixedSeed: 'Graine RNG fixe (optionnel)',
    advFixedSeedPlaceholder: 'Aléatoire par défaut',
    advWorkerCount: 'Web Workers actifs ({n} / {max})',
    advSchedulingMode: 'Ordonnancement des tâches',
    schedDynamic: 'Lots dynamiques (Work-Stealing)',
    schedStatic: 'Shards statiques équilibrés',
    advBatchSize: 'Taille des lots dynamiques',
    advCollectTelemetry: 'Collecter la télémétrie détaillée carte par carte',
    advStressOhko: 'Stress-Test : K.O. actif à chaque tour dès T3',
    advPerturbation: 'Perturbation scénarisée',
    pertNone: 'Aucune',
    pertIono: 'Mashynn adverse forcée',
    pertKo: 'K.O. Actif forcé',
    pertPrized: 'Carte clé en Récompenses',
    advPerturbationTurn: 'Tour de perturbation',

    // Step 3 - Dashboard & Comparator
    globalPerformance: 'Performances Globales',
    comparedVariant: 'Variante A/B Comparée',
    globalWinRate: 'Taux de Victoire Global',
    vsBaseline: 'vs deck initial',
    simulatedGamesCount: 'Basé sur {n} parties simulées face aux decks méta sélectionnés.',
    globalWldSummary: '{wins}V • {losses}D • {draws}N',
    simPerfStatsLine: 'Temps d’exécution : {sec} s • {rate} parties/sec • {workers} cœurs',
    rerunSimulation: 'Relancer la simulation',
    testVariantAndCompare: 'Tester cette variante et comparer',
    adjustDeckTo60: 'Ajustez le deck ({n} / 60 cartes requises)',
    exportPtcglVariant: 'Exporter la variante PTCGL',
    exportPtcglDeck: 'Exporter le deck PTCGL',
    simulatingProgress: 'Simulation en cours... {done} / {total} parties',

    // Version History
    versionHistoryTitle: 'Historique des Versions',
    versionHistorySub: 'Cliquez sur une version pour charger ses cartes et ses statistiques',
    baselineRef: 'Réf',
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
    kpiBossFlexibility: 'Flexibilité Supporter',
    kpiBossFlexibilityDesc:
      'Attaquer sans consommer le Supporter du tour, libérant un Supporter offensif (Ordres du Boss, etc.).',

    // Detailed Stats
    turnOrderHeader: 'Ordre du Tour & Pression T1',
    turnOrderStatsSub: 'Performance selon l initiative et capacité d item-lock dès le T1',
    winRateJ1: 'Win Rate en J1 (1er)',
    winRateJ2: 'Win Rate en J2 (2d)',
    turn1AttackLockJ2: 'Attaque / Item-Lock T1 en J2',
    turn1ItemLockDesc: 'Verrouillage d Objets T1 J2 (Pollen Démangeant) :',
    avgDamagePerTurn: 'Dégâts Moyens / Tour :',
    avgDamageSub: 'Moyenne infligée par tour actif',

    prizeMulliganHeader: 'Économie de Récompenses & Régularité',
    avgPlayerPrizes: 'Prizes Moyens Joueur',
    prizesTakenPerMatch: 'Récompenses prises / match',
    avgOpponentPrizes: 'Prizes Moyens Adversaire',
    prizesConcededPerMatch: 'Récompenses concédées',
    netPrizeDifferential: 'Différentiel net :',
    mulliganRate: 'Taux de Mulligan',
    gamesWithMulligan: 'partie(s) avec au moins un mulligan',
    avgTurnsPerGame: 'Moyenne Tours / Match',
    avgTurnsCount: '{turns} tours',
    simSpeed: 'Débit Simulation',
    gamesPerSec: '{rate} parties / sec',

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
    comboDamageLabel: '{dmg} dég.',
    comboEffectLabel: 'Effet',

    // Card Audit
    cardAuditHeader: 'Audit d Utilité Carte par Carte',
    cardAuditSub:
      'Repérez les cartes mortes en main, les défausses inutiles et mesurez le risque de Prize Lock',
    colCard: 'Carte du Deck',
    colPlayRate: 'Taux de Jeu Effectif (%)',
    colDeadDiscardRate: 'Carte Morte / Défaussée sans effet (%)',
    colPrizedImpact: 'Impact si Prized (Tous exemplaires)',
    colAlternatives: 'Alternatives Intelligentes',
    seenRate: 'Vue : {pct} %',
    stuckTurns: '{n}t bloquée',
    neverPrized: '0 % (Jamais 100% Prized)',
    gamesPctPrized: '{pct} % des parties',

    // Atelier & Alternatives
    deckComposition: 'Composition du Deck',
    clickCardForAlternatives: 'Cliquez sur une carte pour voir ses alternatives et son image',
    suggestedAlternatives: 'Alternatives Suggérées',
    replaceInDeck: 'Remplacer dans le deck',
    searchAddCard: 'Rechercher une carte à ajouter (ex: Mashynn, Poffin)...',
    addCard: '+ Ajouter',
    altCountBadge: '{n} alt.',
    cardReplacedFeedback: '{oldCard} remplacé par {newCard}.',
    matchupStats: '{wins}V - {losses}D - {draws}N ({total} parties)',

    // Export Modal
    exportModalTitle: 'Exporter la variante optimisée (60 cartes)',
    exportModalTitleDeck: 'Exporter le deck actif (60 cartes)',
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
    noRulesText: 'Carte sans effet de règles particulier.',
    cardsUnit: 'cartes',
    formatQtyNameCode: 'Format : Qté Nom CODE N°',
    tabRulesAndCard: 'Règles & Carte',
    tabAiEngineModel: 'Modèle IA Moteur',
    aiRoleLabel: 'Rôle Stratégique IA',
    aiActionsTitle: 'Actions & Effets Transcrits par l IA',
    aiCostLabel: 'Coût',
    aiCostNone: 'Aucun coût requis',
    aiPreconditionsLabel: 'Conditions d activation',
    aiPreconditionsNone: 'Aucune condition spécifique',
    aiEffectsLabel: 'Effet(s) Moteur',
    aiEffectsNone: 'Aucun sous-effet atomique',
    aiDeadCardCondition: 'Carte morte si',
    aiViewCleanJson: 'Voir le JSON épuré (sans clés null)',
    aiHideCleanJson: 'Masquer le JSON',
    aiTurn1AllowedJ2: 'Autorisé T1 J2',
    aiTurn1ForbiddenJ1: 'Interdit T1 J1',
    aiNoAiModelAvailable: 'Aucun modèle IA disponible pour cette carte.',
    prevCard: 'Carte précédente',
    nextCard: 'Carte suivante',
    cardCounter: '{current} / {total}',
    tabCardInfo: 'Infos de base',
    tabCardAiLogic: 'Comportement IA',
    aiPhasePriorityTitle: 'Importance selon le tour de jeu',
    aiDecisionHabitsTitle: 'Réflexes de l’IA',
    aiDeckSynergiesTitle: 'Synergies attendues dans le deck',
    aiDeadConditionsTitle: 'Quand l’IA évite ou défausse cette carte',
    aiEvolutionLine: 'Lignée évolutive',
    aiHowItWorksTitle: 'Actions et effets simulés',
    aiNoActionsDefined: 'Cette carte agit principalement comme ressource ou base passive.',
    clickToInspectCards: 'Cliquer pour inspecter ({n} cartes)',

    // Subcategories
    subcatBasic: 'Base',
    subcatStage1: 'Niveau 1',
    subcatStage2: 'Niveau 2',
    subcatSupporter: 'Supporter',
    subcatItem: 'Objet',
    subcatTool: 'Outil Pokémon',
    subcatStadium: 'Stade',
    subcatBasicEnergy: 'Énergie de base',
    subcatSpecialEnergy: 'Énergie Spéciale',

    // API Integration & Bug Reports
    resolvingDeckApi: 'Résolution des cartes via l’API...',
    apiResolveErrorTitle: 'Impossible de résoudre la decklist via le serveur API',
    retryButton: 'Réessayer',
    loadingMetaDecks: 'Chargement des decks Meta depuis l’API...',
    metaDecksErrorTitle: 'Impossible de charger les decks Meta depuis l’API',
    noMetaDecksAvailable: 'Aucun deck Meta actif n’est disponible sur le serveur.',
    metaDecksLoadedFromApi: '{n} deck(s) Meta chargé(s) depuis l’API',
    searchCatalogLoading: 'Recherche dans le catalogue API...',
    searchCatalogError: 'Erreur lors de la recherche dans le catalogue API',
    searchCatalogPrompt: 'Tapez au moins 2 caractères ou un ID (ex : sv03-125) pour rechercher dans le catalogue API.',
    searchCatalogCount: '{n} carte(s) trouvée(s) sur {total}',
    alternativesLoading: 'Chargement des alternatives intelligentes via l’API...',
    alternativesError: 'Impossible de charger les alternatives depuis l’API',
    reportCardIssueBtn: 'Signaler un problème sur cette carte',
    reportEngineIssueBtn: 'Signaler un bug moteur / règle sur ce match',
    reportTitleCard: 'Signaler une erreur de modélisation (Carte {cardId})',
    reportTitleEngine: 'Signaler une erreur de règle du moteur (Match #{seed})',
    reportCommentLabel: 'Description du problème (optionnel)',
    reportCommentPlaceholder: 'Décrivez l’anomalie observée (effet manquant, dégâts erronés, mauvaise interaction...)',
    reportSubmitBtn: 'Envoyer le signalement',
    reportSubmitting: 'Envoi en cours...',
    reportCancelBtn: 'Fermer',
    reportSuccessMsg: 'Signalement #{id} enregistré avec succès.',
    reportRateLimitError: 'Limite de signalements atteinte. Réessayez dans {retry}.',
    reportErrorGeneric: 'Impossible d’envoyer le signalement',
    winInitial: 'V',
    soonBadge: 'BIENTÔT',
    simRunningProgress:
      'Simulation en cours sur {cores} cœurs : {completed} / {total} parties ({percent} %)...',
    simThroughputRate: 'Débit : ~{rate} parties/sec',
    simElapsedSec: 'Temps écoulé : {sec} s',
    simStopBtn: '🛑 Annuler la simulation',

    // Wizard, Config & Results extra i18n
    wizardStepsNavAria: 'Navigation des étapes',
    debugModeTooltip: 'Mode debug actif via {param}',
    workersUnit: 'Workers',
    ply1Label: '1-Ply (Tour T seul)',
    maxBranchesInfinite: 'INFINITE (plafond 60)',
    versionsCount: '{n} version(s)',
    cardFallbackLabel: 'CARTE',
    seoTitle: 'Olydor Insight — Simulateur Monte-Carlo & Atelier A/B Pokémon TCG',
    seoDescription:
      'Importez votre decklist PTCGL, vérifiez ses 60 cartes et lancez des simulations Monte-Carlo multi-threads avec comparateur A/B.',
    ogTitle: 'Olydor Insight — insight.olydor.app',
    ogDescription:
      'Indicateurs compétitifs, analyses méta, suggestions d’alternatives et inspecteur tactique pour Pokémon TCG Standard.',
    legalMentionsSeoTitle: 'Mentions Légales — Olydor Insight',
    legalMentionsSeoDesc: 'Mentions légales du simulateur Olydor Insight (insight.olydor.app).',
    legalPrivacySeoTitle: 'Politique de Confidentialité — Olydor Insight',
    legalPrivacySeoDesc: 'Politique de confidentialité d’Olydor Insight (insight.olydor.app).',
    legalTermsSeoTitle: 'Conditions Générales d’Utilisation — Olydor Insight',
    legalTermsSeoDesc: 'Conditions générales d’utilisation d’Olydor Insight (insight.olydor.app).',

    // Debug Inspector Panel
    dbgAriaLabel: 'Inspecteur granulaire de parties',
    dbgTitle: 'Inspection Granulaire : Partie → Timeline par Tour → Branches 3-Ply (T → T_adv → T+1)',
    dbgSubtitle:
      'Examinez les mains initiales, les 6 Récompenses, l’état exact du Double Plateau et le calcul mathématique de chaque branche candidate.',
    dbgFilterOutcomeAria: 'Filtrer par issue de la partie',
    dbgOutcomeAll: 'Toutes les issues ({n})',
    dbgOutcomePlayer: 'Victoires Joueur uniquement',
    dbgOutcomeOpponent: 'Défaites uniquement',
    dbgOutcomeDraw: 'Égalités uniquement',
    dbgFilterOpponentAria: 'Filtrer par deck adverse affronté',
    dbgOpponentAll: 'Tous les decks affrontés',
    dbgSelectGameAria: 'Sélectionner la partie tracée',
    dbgGameOption: 'Partie #{index} — {outcome} vs {opponent} ({turns}t)',
    dbgShortWin: 'VICTOIRE',
    dbgShortLoss: 'DÉFAITE',
    dbgShortDraw: 'ÉGALITÉ',
    dbgNoMatchingGames: 'Aucune partie tracée ne correspond aux filtres sélectionnés.',
    dbgGameNumber: 'Partie #{index}',
    dbgBadgePlayerWin: 'VICTOIRE JOUEUR',
    dbgBadgeOpponentWin: 'VICTOIRE ADVERSE',
    dbgBadgeDraw: 'ÉGALITÉ',
    dbgReasonPrefix: 'Motif : {reason}',
    dbgWinReasonAllPrizes: '6 Récompenses prises',
    dbgWinReasonNoPokemon: 'Plus aucun Pokémon en jeu (KO Table)',
    dbgWinReasonDeckOut: 'Deck vide au début du tour (Deck-Out)',
    dbgWinReasonMaxTurns: 'Limite maxTurns atteinte (Départage aux Récompenses)',
    dbgWinReasonFinished: 'Terminé',
    dbgFirstPlayerLabel: '1er Joueur :',
    dbgActorPlayer: 'Joueur',
    dbgActorOpponent: 'Adversaire',
    dbgPrizesWonLabel: 'Prizes gagnés :',
    dbgMulligansLabel: 'Mulligans : J:{player} / Adv:{opp}',
    dbgPlayerOpeningTitle: 'Ouverture Joueur (Main initiale 7 cartes & 6 Récompenses)',
    dbgOpponentOpeningTitle: 'Ouverture Adversaire — {opponent}',
    dbgPlayerInitialHand: 'Main initiale (7 cartes) :',
    dbgPlayerInitialPrizes: '6 Cartes Récompenses initiales :',
    dbgOpponentInitialHand: 'Main initiale adverse (7 cartes) :',
    dbgOpponentInitialPrizes: '6 Cartes Récompenses adverses :',
    dbgTimelineTitle: 'Timeline Interactive des Tours ({n} demi-tours joués)',
    dbgBoardTimingLabel: 'État du plateau affiché :',
    dbgTimingBefore: 'Début de Tour (Avant actions)',
    dbgTimingAfter: 'Fin de Tour (Après actions)',
    dbgTurnShortPlayer: 'Joueur',
    dbgTurnShortOpponent: 'Adv',
    dbgTurnBannerPlayer: 'TOUR {n} — TOUR DU JOUEUR',
    dbgTurnBannerOpponent: 'TOUR {n} — TOUR DE L’ADVERSAIRE',
    dbgDrawnCardLabel: 'Pioche du tour :',
    dbgPerturbationBadge: '[Perturbation] {note}',
    dbgBranchesExplored: 'Branches explorées :',
    dbgChosenScore: 'Score Branche Choisie :',
    dbgPlayerBoardTitle: 'Plateau du Joueur ({timing})',
    dbgOpponentBoardTitle: 'Plateau Adverse ({timing})',
    dbgTimingTagBefore: 'Début de tour',
    dbgTimingTagAfter: 'Fin de tour',
    dbgPrizesRemaining: 'Récompenses restantes : {n} / 6',
    dbgDeckCount: 'Deck: {n}',
    dbgDiscardCount: 'Défausse: {n}',
    dbgActiveSpotPlayer: 'Poste Actif',
    dbgActiveSpotOpponent: 'Poste Actif Adverse',
    dbgHpUnit: 'PV',
    dbgEnergyPrefix: 'NRJ: {name}',
    dbgToolPrefix: 'Outil: {name}',
    dbgNoEnergyOrTool: 'Aucune énergie ni outil attaché',
    dbgNoActivePokemon: 'Aucun Pokémon Actif',
    dbgBenchPlayer: 'Banc ({n} / 5)',
    dbgBenchEmptyPlayer: 'Banc vide',
    dbgBenchOpponent: 'Banc Adverse ({n} / 5)',
    dbgBenchEmptyOpponent: 'Banc adverse vide',
    dbgHandPlayer: 'Main ({n} cartes)',
    dbgHandEmptyPlayer: 'Main vide',
    dbgHandOpponent: 'Main Adverse ({n} cartes)',
    dbgHandEmptyOpponent: 'Main adverse vide',
    dbgTreeTitle: 'Comparateur d’Arbre 3-Ply du Tour {n} — Branches Candidates Évaluées',
    dbgFormulaLabel: 'Formule :',
    dbgBranchesDepthCount: '{n} branches évaluées en profondeur',
    dbgBranchChosen: '— BRANCHE RETENUE',
    dbgBranchDiscarded: '— Écartée',
    dbgActionsCount: '{n} action(s) dans la séquence',
    dbgTotalScore: 'Score Total : {score}',
    dbgAnticipatedRebound: 'Rebond projeté (T+1) :',
    dbgAnticipatedReply: 'Riposte anticipée (T_adv) :',
  },
  en: {
    // Header & Steps
    appTitle: 'Olydor Insight',
    appSubtitle: '3-Ply Monte Carlo Simulator & A/B Deck Optimizer',
    debugModeBadge: 'DEBUG MODE (?debug=true)',
    sendToArena: 'Battle Pythia Bot in the Arena',
    offlineCatalogBanner: 'Offline hybrid mode active: using built-in local catalog.',
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
    awaitingDecklist: 'Awaiting your decklist',
    pasteDecklistPrompt: 'Paste your decklist into the text box and click Validate.',
    distinctCardsDetected: '{n} distinct card references detected.',
    deckSynergyVerification: 'Verifying requirements for your attackers and engines',
    synergiesValidated: '{done} / {total} synergies validated',
    synergySatisfied: 'Satisfied',
    synergyMissing: 'Missing',
    unresolvedCardsTitle: 'Unresolved cards ({n}):',

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
    turnOrderRandomDesc: 'Simulates a realistic coin flip on every game',
    turnOrderFirst: 'Go First (P1)',
    turnOrderFirstDesc: 'Your deck goes first in 100% of games (T1)',
    turnOrderSecond: 'Go Second (P2)',
    turnOrderSecondDesc: 'Your deck goes second in 100% of games (T1 attack allowed)',
    metaMatchupsTitle: 'Meta Matchups to Face',
    metaMatchupsSub: 'Select the opponent decks to benchmark against',
    btnLaunchSimulation: 'Run Simulation',
    selectAll: 'Select all',
    recommended: 'Recommended',
    threatsLabel: 'Threats',
    modifyDeck: 'Edit my deck',
    cancelSimulation: 'Cancel simulation',
    simulationCancelled: 'Simulation cancelled by user.',
    simulationErrorHeading: 'An error occurred during simulation execution',
    closeAlert: 'Dismiss alert',
    hardwareDetected: 'Hardware: {n} cores detected',
    invalidDeckStep1: 'Invalid deck: please return to step 1',
    selectAtLeastOneOpp: 'Select at least one opponent',
    gamesUnit: 'games',

    // Step 2 - Hardware Calibration, Quick Selectors & Advanced Drawer
    hwCalibratedBanner: 'Hardware Calibration Detected',
    hwRecalibrateBtn: 'Recalibrate',
    hwCoresUnit: '{n} logical cores',
    hwScoreLabel: 'CPU Index: {score}',
    hwClusterSpeed: 'Est. cluster throughput: ~{gps} games/sec',
    hwTierEco: 'Eco Tier',
    hwTierBalanced: 'Balanced Tier',
    hwTierPerformance: 'Performance',
    hwTierExtreme: 'Extreme Workstation',
    tabQuickSettings: 'Quick Settings',
    tabAdvancedSettings: 'Advanced Settings',
    estDurationLabel: 'Estimated duration',
    estSpeedLabel: 'Est. throughput',
    estSpeedValue: '~{gps} games/sec',
    estLiveCalibrated: 'Live-calibrated',
    selectorCpuTitle: '1. CPU Power',
    selectorCpuSub: 'Computer resources used during simulation',
    cpuEcoLabel: 'Light (40%)',
    cpuEcoDesc: 'Keeps PC quiet',
    cpuBalancedLabel: 'Balanced (75%)',
    cpuBalancedDesc: 'Best default balance',
    cpuMaxLabel: 'Maximum (100%)',
    cpuMaxDesc: 'Maximum speed',
    selectorVolumeTitle: '2. Number of Games',
    selectorVolumeSub: 'More games give more reliable results',
    volFlashLabel: 'Quick Preview',
    volFlashDesc: '150 games',
    volStandardLabel: 'Standard',
    volStandardDesc: '500 games',
    volTournamentLabel: 'Tournament',
    volTournamentDesc: '2000 games',
    volDeepLabel: 'Very Accurate',
    volDeepDesc: '5000 games',
    selectorAiTitle: '3. AI Level',
    selectorAiSub: 'Decision quality during simulated games',
    aiFastLabel: 'Basic',
    aiFastDesc: 'Fast • turn by turn',
    aiCompLabel: 'Standard',
    aiCompDesc: 'Anticipates opponent response',
    aiExpertLabel: 'Expert',
    aiExpertDesc: 'Deepest calculation',
    advancedToggleTitle: 'Advanced Engine Parameters',
    advancedToggleSub: 'Fine-tune 14 AI evaluator, execution, worker scheduling & stress-test controls',
    advancedCustomBadge: 'Customized',
    advancedResetBtn: 'Reset',
    advGroupAiTitle: 'A. AI Search & Evaluator',
    advGroupExecTitle: 'B. Match Rules & Determinism',
    advGroupWorkersTitle: 'C. Parallelism & Scheduling',
    advGroupStatsTitle: 'D. Telemetry & Stress-Tests',
    advLookaheadPly: 'Lookahead Depth (Ply)',
    advMaxBranches: 'Max Branches / Turn',
    advBeamWidth: 'Beam Width ({n})',
    advTopK: 'Evaluated Top-K Candidates ({n})',
    advMaxActionDepth: 'Max AI Actions / Turn ({n})',
    advRolloutMaxActions: 'Rollout Max Actions ({n})',
    advAiTemperament: 'Strategic Temperament',
    tempBalanced: 'Balanced (0.35 / 0.30 / 0.35)',
    tempAggressive: 'Aggressive (0.45 / 0.25 / 0.30)',
    tempConservative: 'Conservative (0.25 / 0.45 / 0.30)',
    advOpponentLookahead: 'Opponent Lookahead (Ply)',
    advOpponentBranches: 'Opponent Max Branches',
    advIterations: 'Iterations Count',
    advMaxTurns: 'Max Turns / Game ({n})',
    advFixedSeed: 'Fixed RNG Seed (optional)',
    advFixedSeedPlaceholder: 'Random by default',
    advWorkerCount: 'Active Web Workers ({n} / {max})',
    advSchedulingMode: 'Task Scheduling Mode',
    schedDynamic: 'Dynamic Batches (Work-Stealing)',
    schedStatic: 'Static Balanced Shards',
    advBatchSize: 'Dynamic Batch Size',
    advCollectTelemetry: 'Collect detailed card-by-card telemetry',
    advStressOhko: 'Stress-Test: Active KO each turn from T3',
    advPerturbation: 'Scenario Perturbation',
    pertNone: 'None',
    pertIono: 'Forced Opponent Iono',
    pertKo: 'Forced Active KO',
    pertPrized: 'Key Card Forced Prized',
    advPerturbationTurn: 'Perturbation Turn',

    // Step 3 - Dashboard & Comparator
    globalPerformance: 'Global Performance',
    comparedVariant: 'A/B Compared Variant',
    globalWinRate: 'Global Win Rate',
    vsBaseline: 'vs initial deck',
    simulatedGamesCount: 'Based on {n} simulated games against selected meta decks.',
    globalWldSummary: '{wins}W • {losses}L • {draws}D',
    simPerfStatsLine: 'Execution time: {sec} s • {rate} games/sec • {workers} cores',
    rerunSimulation: 'Rerun simulation',
    testVariantAndCompare: 'Test this variant & compare',
    adjustDeckTo60: 'Adjust deck ({n} / 60 cards required)',
    exportPtcglVariant: 'Export PTCGL Variant',
    exportPtcglDeck: 'Export PTCGL Deck',
    simulatingProgress: 'Simulation in progress... {done} / {total} games',

    // Version History
    versionHistoryTitle: 'Deck Version History',
    versionHistorySub: 'Click on a version to inspect its cards and simulation results',
    baselineRef: 'Ref',
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
    kpiBossFlexibility: 'Supporter Flexibility',
    kpiBossFlexibilityDesc:
      'Attack without spending your Supporter for the turn, leaving room for offensive Supporters.',

    // Detailed Stats
    turnOrderHeader: 'Turn Order & T1 Pressure',
    turnOrderStatsSub: 'Performance by initiative and ability to attack or item-lock on T1',
    winRateJ1: 'Win Rate Going First (P1)',
    winRateJ2: 'Win Rate Going Second (P2)',
    turn1AttackLockJ2: 'T1 Attack / Item-Lock Going 2nd',
    turn1ItemLockDesc: 'T1 Item Lock Going 2nd (Itchy Pollen):',
    avgDamagePerTurn: 'Avg Damage / Turn:',
    avgDamageSub: 'Average damage dealt per active turn',

    prizeMulliganHeader: 'Prize Trade & Consistency',
    avgPlayerPrizes: 'Avg Player Prizes Taken',
    prizesTakenPerMatch: 'Prizes taken / match',
    avgOpponentPrizes: 'Avg Opponent Prizes Conceded',
    prizesConcededPerMatch: 'Prizes conceded',
    netPrizeDifferential: 'Net differential:',
    mulliganRate: 'Mulligan Rate',
    gamesWithMulligan: 'game(s) with at least one mulligan',
    avgTurnsPerGame: 'Avg Turns / Game',
    avgTurnsCount: '{turns} turns',
    simSpeed: 'Simulation Speed',
    gamesPerSec: '{rate} games / sec',

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
    comboDamageLabel: '{dmg} dmg',
    comboEffectLabel: 'Effect',

    // Card Audit
    cardAuditHeader: 'Card-by-Card Utility Audit',
    cardAuditSub:
      'Spot dead cards in hand, useless discards, and evaluate prize lock risk',
    colCard: 'Deck Card',
    colPlayRate: 'Effective Play Rate (%)',
    colDeadDiscardRate: 'Dead Card / Discarded Unused (%)',
    colPrizedImpact: 'Impact When Prized (All copies)',
    colAlternatives: 'Smart Alternatives',
    seenRate: 'Seen: {pct} %',
    stuckTurns: '{n}t stuck in hand',
    neverPrized: '0 % (Never 100% Prized)',
    gamesPctPrized: '{pct} % of games',

    // Atelier & Alternatives
    deckComposition: 'Deck Composition',
    clickCardForAlternatives: 'Click a card to see its alternatives and artwork',
    suggestedAlternatives: 'Suggested Alternatives',
    replaceInDeck: 'Replace in deck',
    searchAddCard: 'Search a card to add (e.g. Iono, Buddy-Buddy Poffin)...',
    addCard: '+ Add',
    altCountBadge: '{n} alt.',
    cardReplacedFeedback: '{oldCard} replaced by {newCard}.',
    matchupStats: '{wins}W - {losses}L - {draws}D ({total} games)',

    // Export Modal
    exportModalTitle: 'Export Optimized Variant (60 cards)',
    exportModalTitleDeck: 'Export Active Deck (60 cards)',
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
    noRulesText: 'Card without any special rules effect.',
    cardsUnit: 'cards',
    formatQtyNameCode: 'Format: Qty Name CODE #',
    tabRulesAndCard: 'Rules & Card',
    tabAiEngineModel: 'AI Engine Model',
    aiRoleLabel: 'AI Strategic Role',
    aiActionsTitle: 'Actions & Effects Transcribed by AI',
    aiCostLabel: 'Cost',
    aiCostNone: 'No cost required',
    aiPreconditionsLabel: 'Activation Conditions',
    aiPreconditionsNone: 'No specific conditions',
    aiEffectsLabel: 'Engine Effect(s)',
    aiEffectsNone: 'No atomic sub-effects',
    aiDeadCardCondition: 'Dead card if',
    aiViewCleanJson: 'View cleaned JSON (no nulls)',
    aiHideCleanJson: 'Hide JSON',
    aiTurn1AllowedJ2: 'Allowed T1 P2',
    aiTurn1ForbiddenJ1: 'Forbidden T1 P1',
    aiNoAiModelAvailable: 'No AI model available for this card.',
    prevCard: 'Previous card',
    nextCard: 'Next card',
    cardCounter: '{current} / {total}',
    tabCardInfo: 'Basic Info',
    tabCardAiLogic: 'AI Behavior',
    aiPhasePriorityTitle: 'Priority by Game Phase',
    aiDecisionHabitsTitle: 'AI Decision Habits',
    aiDeckSynergiesTitle: 'Expected Deck Synergies',
    aiDeadConditionsTitle: 'When AI Holds Back or Discards It',
    aiEvolutionLine: 'Evolution Line',
    aiHowItWorksTitle: 'Simulated Actions & Effects',
    aiNoActionsDefined: 'This card primarily acts as a passive resource or Basic Pokémon.',
    clickToInspectCards: 'Click to inspect ({n} cards)',

    // Subcategories
    subcatBasic: 'Basic',
    subcatStage1: 'Stage 1',
    subcatStage2: 'Stage 2',
    subcatSupporter: 'Supporter',
    subcatItem: 'Item',
    subcatTool: 'Pokémon Tool',
    subcatStadium: 'Stadium',
    subcatBasicEnergy: 'Basic Energy',
    subcatSpecialEnergy: 'Special Energy',

    // API Integration & Bug Reports
    resolvingDeckApi: 'Resolving cards via API...',
    apiResolveErrorTitle: 'Unable to resolve decklist via the API server',
    retryButton: 'Retry',
    loadingMetaDecks: 'Loading Meta decks from API...',
    metaDecksErrorTitle: 'Unable to load Meta decks from the API server',
    noMetaDecksAvailable: 'No active Meta deck available on the server.',
    metaDecksLoadedFromApi: '{n} Meta deck(s) loaded from API',
    searchCatalogLoading: 'Searching API catalog...',
    searchCatalogError: 'Error while searching the API catalog',
    searchCatalogPrompt: 'Type at least 2 characters or a card ID (e.g. sv03-125) to search the API catalog.',
    searchCatalogCount: '{n} card(s) shown out of {total}',
    alternativesLoading: 'Loading smart alternatives from API...',
    alternativesError: 'Unable to load alternatives from API',
    reportCardIssueBtn: 'Report an issue with this card',
    reportEngineIssueBtn: 'Report an engine / rule bug on this match',
    reportTitleCard: 'Report a card modeling error ({cardId})',
    reportTitleEngine: 'Report an engine rule bug (Match #{seed})',
    reportCommentLabel: 'Issue description (optional)',
    reportCommentPlaceholder: 'Describe what went wrong (missing effect, wrong damage, rule interaction...)',
    reportSubmitBtn: 'Submit report',
    reportSubmitting: 'Submitting...',
    reportCancelBtn: 'Close',
    reportSuccessMsg: 'Report #{id} submitted successfully.',
    reportRateLimitError: 'Report rate limit reached. Try again in {retry}.',
    reportErrorGeneric: 'Unable to submit report',
    winInitial: 'W',
    soonBadge: 'SOON',
    simRunningProgress:
      'Simulation running on {cores} cores: {completed} / {total} games ({percent}%)...',
    simThroughputRate: 'Throughput: ~{rate} games/sec',
    simElapsedSec: 'Elapsed time: {sec} s',
    simStopBtn: '🛑 Cancel simulation',

    // Wizard, Config & Results extra i18n
    wizardStepsNavAria: 'Wizard steps navigation',
    debugModeTooltip: 'Debug mode active via {param}',
    workersUnit: 'Workers',
    ply1Label: '1-Ply (Turn T only)',
    maxBranchesInfinite: 'INFINITE (cap 60)',
    versionsCount: '{n} version(s)',
    cardFallbackLabel: 'CARD',
    seoTitle: 'Olydor Insight — Monte Carlo Simulator & A/B Lab Pokémon TCG',
    seoDescription:
      'Import your PTCGL decklist, validate all 60 cards, and run multi-threaded Monte Carlo simulations with an A/B deck optimizer.',
    ogTitle: 'Olydor Insight — insight.olydor.app',
    ogDescription:
      'Competitive metrics, meta matchup breakdowns, smart alternative suggestions, and 3-ply inspector for Standard Pokémon TCG.',
    legalMentionsSeoTitle: 'Legal Notice — Olydor Insight',
    legalMentionsSeoDesc: 'Legal notice for Olydor Insight simulator (insight.olydor.app).',
    legalPrivacySeoTitle: 'Privacy Policy — Olydor Insight',
    legalPrivacySeoDesc: 'Privacy policy for Olydor Insight (insight.olydor.app).',
    legalTermsSeoTitle: 'Terms of Service — Olydor Insight',
    legalTermsSeoDesc: 'Terms of service for Olydor Insight (insight.olydor.app).',

    // Debug Inspector Panel
    dbgAriaLabel: 'Granular match inspector',
    dbgTitle: 'Granular Inspection: Match → Turn Timeline → 3-Ply Branches (T → T_opp → T+1)',
    dbgSubtitle:
      'Inspect opening hands, all 6 Prize cards, exact dual-board snapshots, and the score math behind every evaluated branch.',
    dbgFilterOutcomeAria: 'Filter by match outcome',
    dbgOutcomeAll: 'All outcomes ({n})',
    dbgOutcomePlayer: 'Player wins only',
    dbgOutcomeOpponent: 'Losses only',
    dbgOutcomeDraw: 'Draws only',
    dbgFilterOpponentAria: 'Filter by opponent deck',
    dbgOpponentAll: 'All opponent decks',
    dbgSelectGameAria: 'Select traced match',
    dbgGameOption: 'Game #{index} — {outcome} vs {opponent} ({turns}t)',
    dbgShortWin: 'WIN',
    dbgShortLoss: 'LOSS',
    dbgShortDraw: 'DRAW',
    dbgNoMatchingGames: 'No traced match fits the selected filters.',
    dbgGameNumber: 'Game #{index}',
    dbgBadgePlayerWin: 'PLAYER WIN',
    dbgBadgeOpponentWin: 'OPPONENT WIN',
    dbgBadgeDraw: 'DRAW',
    dbgReasonPrefix: 'Reason: {reason}',
    dbgWinReasonAllPrizes: 'All 6 Prize cards taken',
    dbgWinReasonNoPokemon: 'No Pokémon remaining in play (Board Wipe)',
    dbgWinReasonDeckOut: 'Empty deck at start of turn (Deck-Out)',
    dbgWinReasonMaxTurns: 'maxTurns limit reached (Prize tiebreaker)',
    dbgWinReasonFinished: 'Finished',
    dbgFirstPlayerLabel: 'First Player:',
    dbgActorPlayer: 'Player',
    dbgActorOpponent: 'Opponent',
    dbgPrizesWonLabel: 'Prizes taken:',
    dbgMulligansLabel: 'Mulligans: P:{player} / Opp:{opp}',
    dbgPlayerOpeningTitle: 'Player Opening (7-card Hand & 6 Prize Cards)',
    dbgOpponentOpeningTitle: 'Opponent Opening — {opponent}',
    dbgPlayerInitialHand: 'Opening Hand (7 cards):',
    dbgPlayerInitialPrizes: 'Initial 6 Prize Cards:',
    dbgOpponentInitialHand: 'Opponent Opening Hand (7 cards):',
    dbgOpponentInitialPrizes: 'Opponent Initial 6 Prize Cards:',
    dbgTimelineTitle: 'Interactive Turn Timeline ({n} half-turns played)',
    dbgBoardTimingLabel: 'Displayed board state:',
    dbgTimingBefore: 'Start of Turn (Before actions)',
    dbgTimingAfter: 'End of Turn (After actions)',
    dbgTurnShortPlayer: 'Player',
    dbgTurnShortOpponent: 'Opp',
    dbgTurnBannerPlayer: 'TURN {n} — PLAYER TURN',
    dbgTurnBannerOpponent: 'TURN {n} — OPPONENT TURN',
    dbgDrawnCardLabel: 'Turn draw:',
    dbgPerturbationBadge: '[Perturbation] {note}',
    dbgBranchesExplored: 'Branches explored:',
    dbgChosenScore: 'Chosen Branch Score:',
    dbgPlayerBoardTitle: 'Player Board ({timing})',
    dbgOpponentBoardTitle: 'Opponent Board ({timing})',
    dbgTimingTagBefore: 'Start of turn',
    dbgTimingTagAfter: 'End of turn',
    dbgPrizesRemaining: 'Prizes left: {n} / 6',
    dbgDeckCount: 'Deck: {n}',
    dbgDiscardCount: 'Discard: {n}',
    dbgActiveSpotPlayer: 'Active Spot',
    dbgActiveSpotOpponent: 'Opponent Active Spot',
    dbgHpUnit: 'HP',
    dbgEnergyPrefix: 'ENG: {name}',
    dbgToolPrefix: 'Tool: {name}',
    dbgNoEnergyOrTool: 'No energy or tool attached',
    dbgNoActivePokemon: 'No Active Pokémon',
    dbgBenchPlayer: 'Bench ({n} / 5)',
    dbgBenchEmptyPlayer: 'Bench empty',
    dbgBenchOpponent: 'Opponent Bench ({n} / 5)',
    dbgBenchEmptyOpponent: 'Opponent bench empty',
    dbgHandPlayer: 'Hand ({n} cards)',
    dbgHandEmptyPlayer: 'Hand empty',
    dbgHandOpponent: 'Opponent Hand ({n} cards)',
    dbgHandEmptyOpponent: 'Opponent hand empty',
    dbgTreeTitle: 'Turn {n} 3-Ply Tree Comparator — Evaluated Candidate Branches',
    dbgFormulaLabel: 'Formula:',
    dbgBranchesDepthCount: '{n} branches evaluated deeply',
    dbgBranchChosen: '— CHOSEN BRANCH',
    dbgBranchDiscarded: '— Discarded',
    dbgActionsCount: '{n} action(s) in sequence',
    dbgTotalScore: 'Total Score: {score}',
    dbgAnticipatedRebound: 'Projected rebound (T+1):',
    dbgAnticipatedReply: 'Anticipated reply (T_opp):',
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

/**
 * Retourne le nom localisé d'une carte selon la langue active (FR ou EN).
 */
export function getLocalizedCardName(
  card:
    | ParsedDeckEntry
    | EngineCardModel
    | {
        nameFr?: string
        nameEn?: string
        cardNameFr?: string
        cardNameEn?: string
        name?: string
        identity?: { nameFr?: string; nameEn?: string }
        model?: { identity?: { nameFr?: string; nameEn?: string }; nameFr?: string; nameEn?: string }
      }
    | null
    | undefined,
  lang?: Language,
): string {
  if (!card) return ''
  const targetLang = lang || currentLang.value

  const cardObj = card as Record<string, any>
  const nameEn =
    (typeof cardObj.nameEn === 'string' && cardObj.nameEn) ||
    (typeof cardObj.cardNameEn === 'string' && cardObj.cardNameEn) ||
    (typeof cardObj.identity?.nameEn === 'string' && cardObj.identity.nameEn) ||
    (typeof cardObj.model?.identity?.nameEn === 'string' && cardObj.model.identity.nameEn) ||
    (typeof cardObj.model?.nameEn === 'string' && cardObj.model.nameEn) ||
    null

  const nameFr =
    (typeof cardObj.nameFr === 'string' && cardObj.nameFr) ||
    (typeof cardObj.cardNameFr === 'string' && cardObj.cardNameFr) ||
    (typeof cardObj.identity?.nameFr === 'string' && cardObj.identity.nameFr) ||
    (typeof cardObj.model?.identity?.nameFr === 'string' && cardObj.model.identity.nameFr) ||
    (typeof cardObj.model?.nameFr === 'string' && cardObj.model.nameFr) ||
    (typeof cardObj.name === 'string' && cardObj.name) ||
    null

  if (targetLang === 'en') {
    return nameEn || nameFr || 'Card'
  }
  return nameFr || nameEn || 'Carte'
}

/**
 * Nettoie une ligne de règle en retirant le tag de langue redondant (ex: "[Attaque FR: " -> "[Attaque: ").
 */
function cleanRuleLine(line: string, lang: Language): string {
  if (lang === 'fr') {
    return line
      .replace(/^\[(Attaque|Talent|Dresseur|Effet|Règle|Regle)\s+FR\s*:\s*/i, '[$1: ')
      .replace(/^\[(Effet|Énergie|Energie)\s+FR\]\s*/i, '[$1] ')
  }
  return line
    .replace(/^\[(Attack|Ability|Trainer|Effect|Rule)\s+EN\s*:\s*/i, '[$1: ')
    .replace(/^\[(Effect|Energy)\s+EN\]\s*/i, '[$1] ')
}

/**
 * Retourne UNIQUEMENT les règles et effets de la carte correspondant à la langue sélectionnée.
 * Élimine tout mélange de langues sur l'interface.
 */
export function getLocalizedCardRules(
  card:
    | ParsedDeckEntry
    | EngineCardModel
    | {
        identity?: { rawRulesText?: string[] }
        model?: { identity?: { rawRulesText?: string[] } }
        rawRulesText?: string[]
      }
    | null
    | undefined,
  lang?: Language,
): string[] {
  if (!card) return []
  const targetLang = lang || currentLang.value

  const rawRules: string[] =
    ('rawRulesText' in card && Array.isArray(card.rawRulesText) && card.rawRulesText) ||
    ('identity' in card && Array.isArray(card.identity?.rawRulesText) && card.identity.rawRulesText) ||
    ('model' in card && Array.isArray(card.model?.identity?.rawRulesText) && card.model.identity.rawRulesText) ||
    []

  if (rawRules.length === 0) return []

  if (targetLang === 'en') {
    const enRules = rawRules.filter((r) =>
      /\[(?:Attack|Ability|Trainer|Energy|Effect|Rule)\s+EN(?::|\])|\bEN\b/i.test(r),
    )
    if (enRules.length > 0) {
      return enRules.map((r) => cleanRuleLine(r, 'en'))
    }
    const nonFrRules = rawRules.filter(
      (r) => !/\[(?:Attaque|Talent|Dresseur|Énergie|Effet|Règle|Regle)\s+FR|\bFR\b/i.test(r),
    )
    if (nonFrRules.length > 0) {
      return nonFrRules.map((r) => cleanRuleLine(r, 'en'))
    }
  } else {
    const frRules = rawRules.filter((r) =>
      /\[(?:Attaque|Talent|Dresseur|Énergie|Effet|Règle|Regle)\s+FR(?::|\])|\bFR\b/i.test(r),
    )
    if (frRules.length > 0) {
      return frRules.map((r) => cleanRuleLine(r, 'fr'))
    }
    const nonEnRules = rawRules.filter(
      (r) => !/\[(?:Attack|Ability|Trainer|Energy|Effect|Rule)\s+EN|\bEN\b/i.test(r),
    )
    if (nonEnRules.length > 0) {
      return nonEnRules.map((r) => cleanRuleLine(r, 'fr'))
    }
  }

  return rawRules.map((r) => cleanRuleLine(r, targetLang))
}

/**
 * Traduit la sous-catégorie d'une carte (BASIC, STAGE_1, SUPPORTER, ITEM, TOOL, STADIUM, etc.)
 */
export function getLocalizedSubCategory(rawSubCat: string | null | undefined, lang?: Language): string {
  if (!rawSubCat) return ''
  const targetLang = lang || currentLang.value
  const normalized = String(rawSubCat).toUpperCase().trim()

  const mapFr: Record<string, string> = {
    BASIC: 'Base',
    STAGE_1: 'Niveau 1',
    STAGE_2: 'Niveau 2',
    SUPPORTER: 'Supporter',
    ITEM: 'Objet',
    TOOL: 'Outil Pokémon',
    STADIUM: 'Stade',
    BASIC_ENERGY: 'Énergie de base',
    SPECIAL_ENERGY: 'Énergie Spéciale',
  }

  const mapEn: Record<string, string> = {
    BASIC: 'Basic',
    STAGE_1: 'Stage 1',
    STAGE_2: 'Stage 2',
    SUPPORTER: 'Supporter',
    ITEM: 'Item',
    TOOL: 'Pokémon Tool',
    STADIUM: 'Stadium',
    BASIC_ENERGY: 'Basic Energy',
    SPECIAL_ENERGY: 'Special Energy',
  }

  if (targetLang === 'en') {
    return mapEn[normalized] || rawSubCat
  }
  return mapFr[normalized] || rawSubCat
}

export function formatNumber(n: number): string {
  return n.toLocaleString(currentLang.value === 'en' ? 'en-US' : 'fr-FR')
}

export function useI18n() {
  initOlydorLanguage()
  return {
    currentLang,
    setLanguage,
    toggleLanguage,
    pickLocalizedField,
    formatNumber,
    t,
    getLocalizedCardName,
    getLocalizedCardRules,
    getLocalizedSubCategory,
  }
}
