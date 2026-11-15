import { computed, getCurrentInstance, onMounted, ref } from 'vue';

export type OlydorLang = 'fr' | 'en';

export const LANG_STORAGE_KEY = 'olydor-lang';

/** Global reactive language shared across @olydor/ui and host apps. */
export const currentOlydorLang = ref<OlydorLang>('fr');

let langInitialized = false;

export function setOlydorLanguage(lang: OlydorLang): void {
  currentOlydorLang.value = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', lang);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // Ignore storage quota / privacy mode errors.
    }
  }
}

export function toggleOlydorLanguage(): OlydorLang {
  const next: OlydorLang = currentOlydorLang.value === 'fr' ? 'en' : 'fr';
  setOlydorLanguage(next);
  return next;
}

export function initOlydorLanguage(): OlydorLang {
  if (typeof window === 'undefined') {
    return currentOlydorLang.value;
  }

  let stored: string | null = null;
  if (typeof localStorage !== 'undefined') {
    try {
      stored = localStorage.getItem(LANG_STORAGE_KEY);
    } catch {
      stored = null;
    }
  }

  if (stored === 'fr' || stored === 'en') {
    currentOlydorLang.value = stored;
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', currentOlydorLang.value);
  }
  langInitialized = true;
  return currentOlydorLang.value;
}

export type TranslationDictionary = Record<string, string>;

export function createI18n<K extends string>(
  dictionaries: Record<OlydorLang, Record<K, string>>,
  langOverride?: () => OlydorLang | undefined,
) {
  function t(
    key: K,
    params?: Record<string, string | number>,
    explicitLang?: OlydorLang,
  ): string {
    const lang = explicitLang ?? langOverride?.() ?? currentOlydorLang.value;
    let text = dictionaries[lang]?.[key] ?? dictionaries.fr[key] ?? String(key);
    if (params) {
      for (const [pKey, pVal] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${pKey}\\}`, 'g'), String(pVal));
      }
    }
    return text;
  }

  const activeLang = computed<OlydorLang>(() => langOverride?.() ?? currentOlydorLang.value);

  return {
    currentLang: currentOlydorLang,
    activeLang,
    setLanguage: setOlydorLanguage,
    toggleLanguage: toggleOlydorLanguage,
    initLanguage: () => {
      if (!langInitialized) {
        return initOlydorLanguage();
      }
      return currentOlydorLang.value;
    },
    t,
  };
}

export const uiTranslations = {
  fr: {
    // Subtitles
    subtitleInsight: 'Simulateur 3-Ply',
    subtitleArena: 'Arène IA Pythia',
    subtitleWeb: 'Pokémon TCG Analytics',

    // Navbar
    navMainAria: 'Navigation principale',
    navHub: 'Hub',
    navInsight: 'Insight',
    navArena: 'Arène Bot',
    navSoonBadge: 'SOON',
    navArenaDisabledTitle: 'Arène 1v1 vs bot Pythia — Bientôt disponible (accès désactivé)',
    navSwitchLangLabel: 'Passer en Anglais',
    navLangCode: 'FR',
    navSwitchThemeToLight: 'Passer au thème clair',
    navSwitchThemeToDark: 'Passer au thème sombre',
    navReportBug: 'Signaler un bug',
    navOpenMenu: 'Menu',

    // Alpha banner
    alphaRegionAria: 'Programme Alpha Ouverte Olydor',
    alphaBadge: 'ALPHA OUVERTE',
    alphaText:
      'Olydor est en phase Alpha — l’IA est encore en cours de refonte. Aidez-nous à améliorer le Simulateur et la future Arène 1v1 !',
    alphaFeedbackBtn: 'Devenir Alpha-Testeur',
    alphaDismissAria: 'Masquer le bandeau alpha pour cette session',

    // Alpha onboarding modal
    onboardingTitle: 'Bienvenue sur l’Alpha d’Olydor',
    onboardingIntro:
      'Avant de lancer vos premières simulations, voici pourquoi cette plateforme existe, pourquoi elle est encore en Alpha et comment votre aide fait la différence.',
    onboardingGoalTitle: 'Le projet & son objectif',
    onboardingGoalBody:
      'Olydor est un laboratoire d’analyse compétitive lancé sur le Pokémon TCG, avec pour ambition d’accueillir d’autres TCG à l’avenir : un simulateur Monte-Carlo exécuté localement dans votre navigateur pour mesurer stabilité, sorties T1/T2, courbes de dégâts et comparer des variantes de decklists (A/B).',
    onboardingWhyAlphaTitle: 'Pourquoi est-ce en Alpha ?',
    onboardingWhyAlphaBody:
      'Le moteur de décision de l’IA (Pythia) n’est pas encore assez fort et doit être profondément retravaillé. Certaines séquences de cartes et interactions avancées peuvent donc produire des coups sous-optimaux ou des imprécisions : prenez les statistiques actuelles comme un prototype expérimental.',
    onboardingHelpTitle: 'Pourquoi j’ai besoin de vous',
    onboardingHelpBody:
      'Chaque retour compte : importez vos propres decks, repérez les erreurs de l’IA ou les bugs de cartes, utilisez le bouton « Signaler un bug » en haut à droite ou partagez vos suggestions via le questionnaire Alpha-Testeur.',
    onboardingFeedbackLink: 'Questionnaire Alpha-Testeur',
    onboardingStartBtn: 'J’ai compris, explorer Olydor',

    // Footer
    footerDesc:
      'Écosystème d’analyse compétitive Pokémon TCG (et d’autres TCG à venir) : simulateur Monte-Carlo haute vélocité et laboratoire d’optimisation de decklists.',
    footerPlatformsHeading: 'Plateforme',
    footerHubLink: 'Hub — olydor.app',
    footerInsightLink: 'Insight & Simulateur — insight.olydor.app',
    footerArenaDisabled: 'Arène 1v1 vs bot Pythia — arena.olydor.app (Bientôt disponible)',
    footerAlphaCta: 'Rejoindre le programme Alpha',
    footerAboutAlpha: 'À propos de cette Alpha (Onboarding)',
    footerLegalHeading: 'Informations Légales',
    footerLegalNotice: 'Mentions Légales',
    footerPrivacy: 'Politique de Confidentialité (RGPD)',
    footerTerms: 'Conditions Générales d’Utilisation (CGU)',
    footerCopyright: '© {year} Olydor',

    // Bug report modal
    bugModalTitle: 'Signaler un bug',
    bugModalSubtitle: 'Écrivez directement votre commentaire pour l’équipe Olydor.',
    bugModalCloseAria: 'Fermer',
    bugDescLabel: 'Votre commentaire',
    bugDescPlaceholder: 'Décrivez directement le problème rencontré ou ce qui devrait être corrigé...',
    bugErrorEmptyComment: 'Veuillez écrire un commentaire avant d’envoyer votre signalement.',
    bugErrorServer: 'Erreur serveur ({status})',
    bugErrorRateLimit: 'Trop de signalements envoyés. Réessayez dans {retry}.',
    bugErrorNetwork: 'Impossible de joindre l’API Olydor.',
    bugSuccessMsg: 'Signalement #{id} enregistré avec succès.',
    bugCancel: 'Fermer',
    bugSubmit: 'Envoyer le signalement',
    bugSubmitting: 'Envoi en cours...',

    // Legal pages
    legalBackHome: 'Retour à l’accueil',
    legalDefaultDate: 'Novembre 2026',
    mentionsTitle: 'Mentions Légales',
    mentionsSubtitle:
      'Dernière mise à jour : {date} — Écosystème Olydor (`olydor.app`, `insight.olydor.app`, `arena.olydor.app`, `api.olydor.app`).',
    mentionsS1Title: '1. Éditeur du service',
    mentionsS1Body1Prefix: 'La suite logicielle',
    mentionsS1Body1Strong: 'Olydor',
    mentionsS1Body1Suffix:
      'est un projet de recherche et d’ingénierie logicielle indépendant consacré à l’analyse probabiliste et à la simulation stratégique de jeux de cartes à collectionner (Pokémon TCG).',
    mentionsS1Body2:
      'Responsable de publication : Équipe Olydor (projet académique & R&D indépendant, version Alpha Ouverte). Pour toute demande légale ou technique, vous pouvez utiliser la modale « Signaler un bug » présente dans la barre de navigation ou le formulaire officiel Alpha-Testeur.',
    mentionsS2Title: '2. Hébergement et Infrastructure',
    mentionsS2BodyPrefix:
      'Les services Web (`olydor.app`, `insight.olydor.app`, `arena.olydor.app`) et l’API TypeScript (`api.olydor.app`) sont orchestrés via conteneurs Docker managés sous',
    mentionsS2BodyStrong: 'Coolify',
    mentionsS2BodySuffix: 'sur infrastructure cloud européenne conforme aux standards de sécurité en vigueur.',
    mentionsS3Title: '3. Propriété Intellectuelle & Non-Affiliation Pokémon',
    mentionsS3Body1:
      'L’architecture logicielle, le moteur de simulation `@olydor/engine`, l’évaluateur tactique Pythia, le design system « Dark Obsidian & Solar Flare » et le logo officiel Olydor sont la propriété exclusive du projet Olydor.',
    mentionsS3Body2:
      'Pokémon et tous les noms de personnages, visuels de cartes et marques associées sont des marques déposées de Nintendo, Creatures Inc., GAME FREAK Inc. et The Pokémon Company International. Olydor utilise ces références exclusivement à des fins d’analyse stratégique et de recherche algorithmique.',
    privacyTitle: 'Politique de Confidentialité (RGPD)',
    privacySubtitle: 'Dernière mise à jour : {date} — Protection des données sur les plateformes Olydor.',
    privacyS1Title: '1. Minimisation des données & Zéro Tracking Publicitaire',
    privacyS1Body:
      'Olydor respecte strictement le principe de minimisation défini par le Règlement Général sur la Protection des Données (RGPD). Aucun cookie publicitaire, aucun traceur tiers comportemental et aucune vente ou cession de données à des tiers ne sont pratiqués sur `olydor.app`, `insight.olydor.app` ou `arena.olydor.app`.',
    privacyS2Title: '2. Stockage local navigateur (LocalStorage & SessionStorage)',
    privacyS2BodyPrefix: 'Les simulations Monte-Carlo s’exécutent localement dans les',
    privacyS2BodyStrong: 'Web Workers',
    privacyS2BodySuffix:
      'de votre navigateur. Seules des préférences techniques non identifiantes (langue FR/EN, thème clair/sombre, statut d’affichage de l’onboarding ou masquage temporaire du bandeau alpha, decklist en cours d’édition) peuvent être conservées localement dans votre navigateur.',
    privacyS3Title: '3. Signalements de bugs (`POST /api/reports`) & Programme Alpha',
    privacyS3Body1:
      'Lorsque vous soumettez volontairement un signalement via le bouton « Signaler un bug », seules les informations techniques nécessaires au diagnostic sont enregistrées sur `api.olydor.app` (type d’anomalie, identifiant de carte, commentaire libre, et capture anonyme de l’état du moteur si applicable). Une limitation anti-abus par adresse IP (rate-limiting) est appliquée en mémoire vive sans profilage commercial.',
    privacyS3Body2:
      'La participation au questionnaire alpha hébergé via Google Forms est strictement facultative et soumise aux conditions que vous acceptez explicitement lors de sa soumission.',
    privacyS4Title: '4. Vos droits RGPD',
    privacyS4Body:
      'Conformément à la réglementation européenne, vous disposez d’un droit d’accès, de rectification, de limitation et de suppression de toute donnée éventuellement transmise dans un commentaire technique libre, exerçable via le canal de contact Alpha d’Olydor.',
    termsTitle: 'Conditions Générales d’Utilisation (CGU)',
    termsSubtitle: 'Dernière mise à jour : {date} — Accès aux outils Olydor.',
    termsS1Title: '1. Objet & Statut Alpha',
    termsS1Body1Prefix: 'Les présentes Conditions Générales d’Utilisation régissent l’accès gratuit aux services web',
    termsS1Body1Strong: 'Olydor',
    termsS1Body1Suffix:
      ': le Hub d’information (`olydor.app`), le Simulateur Monte-Carlo (`insight.olydor.app`), l’Arène IA Pythia (`arena.olydor.app`, en préparation) et l’API associée (`api.olydor.app`).',
    termsS1Body2Prefix: 'Le service est fourni en version',
    termsS1Body2Strong: 'Alpha Ouverte',
    termsS1Body2Suffix:
      '« en l’état » : l’intelligence artificielle est encore en cours de refonte et certaines modélisations de cartes ou interactions complexes du règlement Pokémon TCG peuvent comporter des imprécisions signalables à tout moment via l’interface.',
    termsS2Title: '2. Caractère analytique des résultats',
    termsS2Body:
      'Les indicateurs (Winrate Global, Tour Moyen Premier KO, Taux de Setup T2, Taux de Brick, Atelier A/B) résultent de simulations stochastiques expérimentales destinées au test technique et à l’entraînement. Olydor ne garantit en aucun cas l’optimalité de l’IA ni des résultats exacts en tournoi officiel Play! Pokémon.',
    termsS3Title: '3. Usage loyal de l’API & Disponibilité',
    termsS3Body:
      'Toute tentative d’extraction massive automatisée, de saturation volontaire de `api.olydor.app` ou de contournement des limites de débit (rate-limiting) est interdite. Olydor se réserve le droit d’interrompre ou de faire évoluer les endpoints sans préavis durant la phase Alpha.',
    termsS4Title: '4. Non-Affiliation',
  },
  en: {
    // Subtitles
    subtitleInsight: 'Deck Simulator',
    subtitleArena: '1v1 Bot Arena',
    subtitleWeb: 'Pokémon TCG Analytics',

    // Navbar
    navMainAria: 'Main navigation',
    navHub: 'Hub',
    navInsight: 'Insight',
    navArena: 'Bot Arena',
    navSoonBadge: 'SOON',
    navArenaDisabledTitle: '1v1 Arena vs Pythia bot — Coming Soon (disabled)',
    navSwitchLangLabel: 'Switch to French',
    navLangCode: 'EN',
    navSwitchThemeToLight: 'Switch to light theme',
    navSwitchThemeToDark: 'Switch to dark theme',
    navReportBug: 'Report Bug',
    navOpenMenu: 'Menu',

    // Alpha banner
    alphaRegionAria: 'Olydor Open Alpha Program',
    alphaBadge: 'OPEN ALPHA',
    alphaText:
      'Olydor is in open Alpha — the AI engine is being reworked. Help us improve the Simulator and upcoming 1v1 Arena!',
    alphaFeedbackBtn: 'Become an Alpha Tester',
    alphaDismissAria: 'Dismiss alpha banner',

    // Alpha onboarding modal
    onboardingTitle: 'Welcome to the Olydor Alpha',
    onboardingIntro:
      'Before running your first simulations, here is what this project aims to build, why it is currently in Alpha, and how your feedback helps.',
    onboardingGoalTitle: 'The Project & Goal',
    onboardingGoalBody:
      'Olydor is a competitive TCG analytics workbench starting with Pokémon TCG, with additional TCGs planned in the future: a local browser Monte Carlo simulator designed to measure decklist consistency, T1/T2 setup odds, damage output, and A/B tech comparisons.',
    onboardingWhyAlphaTitle: 'Why is it in Alpha?',
    onboardingWhyAlphaBody:
      'The decision AI (Pythia) is not strong enough yet and needs a deep rework. Some card mechanics and complex edge cases can also cause suboptimal plays or inaccuracies—please treat current numbers as an experimental prototype.',
    onboardingHelpTitle: 'Why we need your help',
    onboardingHelpBody:
      'Every report helps: test your own decklists, spot AI misplays or card bugs, click "Report Bug" in the top bar anytime, or share structured feedback through the Alpha Tester survey.',
    onboardingFeedbackLink: 'Alpha Tester Survey',
    onboardingStartBtn: 'Got it, explore Olydor',

    // Footer
    footerDesc:
      'High-throughput Monte Carlo simulator and deck optimization platform starting with Pokémon TCG Standard analysis, with other TCGs coming in the future.',
    footerPlatformsHeading: 'Ecosystem',
    footerHubLink: 'Hub — olydor.app',
    footerInsightLink: 'Insight Simulator — insight.olydor.app',
    footerArenaDisabled: '1v1 Arena vs Pythia bot — arena.olydor.app (Coming Soon)',
    footerAlphaCta: 'Alpha Feedback Form',
    footerAboutAlpha: 'About this Alpha (Onboarding)',
    footerLegalHeading: 'Legal & Compliance',
    footerLegalNotice: 'Legal Notice',
    footerPrivacy: 'Privacy Policy (GDPR)',
    footerTerms: 'Terms of Service',
    footerCopyright: '© {year} Olydor',

    // Bug report modal
    bugModalTitle: 'Report a Bug',
    bugModalSubtitle: 'Write your feedback directly for the Olydor team.',
    bugModalCloseAria: 'Close',
    bugDescLabel: 'Your comment',
    bugDescPlaceholder: 'Describe the issue you ran into or what needs to be fixed...',
    bugErrorEmptyComment: 'Please write a comment before submitting your report.',
    bugErrorServer: 'Server error ({status})',
    bugErrorRateLimit: 'Too many reports sent. Please try again in {retry}.',
    bugErrorNetwork: 'Unable to reach Olydor API.',
    bugSuccessMsg: 'Report #{id} recorded successfully.',
    bugCancel: 'Close',
    bugSubmit: 'Submit Report',
    bugSubmitting: 'Sending...',

    // Legal pages
    legalBackHome: 'Back to home',
    legalDefaultDate: 'November 2026',
    mentionsTitle: 'Legal Notice',
    mentionsSubtitle:
      'Last updated: {date} — Olydor Ecosystem (`olydor.app`, `insight.olydor.app`, `arena.olydor.app`, `api.olydor.app`).',
    mentionsS1Title: '1. Service Publisher',
    mentionsS1Body1Prefix: 'The',
    mentionsS1Body1Strong: 'Olydor',
    mentionsS1Body1Suffix:
      'software suite is an independent research and software engineering project dedicated to probabilistic analysis and strategic simulation of trading card games (Pokémon TCG).',
    mentionsS1Body2:
      'Publication lead: Olydor Team (independent academic & R&D project, Open Alpha release). For any legal or technical inquiry, please use the "Report Bug" modal in the navigation bar or the official Alpha Tester form.',
    mentionsS2Title: '2. Hosting & Infrastructure',
    mentionsS2BodyPrefix:
      'Web applications (`olydor.app`, `insight.olydor.app`, `arena.olydor.app`) and the TypeScript API (`api.olydor.app`) are orchestrated via Docker containers managed under',
    mentionsS2BodyStrong: 'Coolify',
    mentionsS2BodySuffix: 'on European cloud infrastructure compliant with modern security standards.',
    mentionsS3Title: '3. Intellectual Property & Pokémon Non-Affiliation',
    mentionsS3Body1:
      'The software architecture, `@olydor/engine` simulation core, Pythia tactical evaluator, "Dark Obsidian & Solar Flare" design system, and official Olydor logo are the exclusive property of the Olydor project.',
    mentionsS3Body2:
      'Pokémon and all related character names, card artwork, and trademarks are registered trademarks of Nintendo, Creatures Inc., GAME FREAK Inc., and The Pokémon Company International. Olydor references these strictly for strategic analysis and algorithmic research.',
    privacyTitle: 'Privacy Policy (GDPR)',
    privacySubtitle: 'Last updated: {date} — Data protection across Olydor platforms.',
    privacyS1Title: '1. Data Minimization & Zero Ad Tracking',
    privacyS1Body:
      'Olydor strictly follows the data minimization principle of the General Data Protection Regulation (GDPR). No advertising cookies, third-party behavioral trackers, or data sales/transfers occur on `olydor.app`, `insight.olydor.app`, or `arena.olydor.app`.',
    privacyS2Title: '2. Browser Local Storage (LocalStorage & SessionStorage)',
    privacyS2BodyPrefix: 'Monte Carlo simulations execute locally inside your browser',
    privacyS2BodyStrong: 'Web Workers',
    privacyS2BodySuffix:
      '. Only non-identifying technical preferences (FR/EN language, light/dark theme, onboarding dismissal or temporary alpha banner state, active decklist draft) may be stored locally in your browser.',
    privacyS3Title: '3. Bug Reports (`POST /api/reports`) & Alpha Program',
    privacyS3Body1:
      'When you voluntarily submit a report via "Report Bug", only the technical details needed for diagnostics are stored on `api.olydor.app` (issue category, card identifier, your comment, and an anonymous engine snapshot if applicable). In-memory IP rate-limiting is applied purely to prevent abuse, without commercial profiling.',
    privacyS3Body2:
      'Participating in the optional Alpha survey hosted on Google Forms is completely voluntary and governed by the terms you explicitly accept when submitting it.',
    privacyS4Title: '4. Your GDPR Rights',
    privacyS4Body:
      'Under European regulations, you have the right to access, rectify, restrict, or delete any data submitted in a free-form technical comment via the Olydor Alpha contact channel.',
    termsTitle: 'Terms of Service',
    termsSubtitle: 'Last updated: {date} — Access to Olydor tools.',
    termsS1Title: '1. Scope & Alpha Status',
    termsS1Body1Prefix: 'These Terms of Service govern free access to the',
    termsS1Body1Strong: 'Olydor',
    termsS1Body1Suffix:
      'web services: the Hub (`olydor.app`), the Monte Carlo Simulator (`insight.olydor.app`), the Pythia AI Arena (`arena.olydor.app`, coming soon), and the companion API (`api.olydor.app`).',
    termsS1Body2Prefix: 'The service is provided in',
    termsS1Body2Strong: 'Open Alpha',
    termsS1Body2Suffix:
      '"as-is": the decision AI is undergoing major rework and certain card models or complex Pokémon TCG rule interactions may contain inaccuracies that can be reported anytime via the UI.',
    termsS2Title: '2. Analytical Nature of Results',
    termsS2Body:
      'Metrics (Overall Winrate, Average First KO Turn, T2 Setup Rate, Brick Rate, A/B Workbench) stem from experimental stochastic simulations intended for testing and practice. Olydor makes no guarantee of AI optimality or exact official Play! Pokémon tournament outcomes.',
    termsS3Title: '3. Fair API Usage & Availability',
    termsS3Body:
      'Any automated bulk scraping, intentional flooding of `api.olydor.app`, or circumvention of rate limits is prohibited. Olydor reserves the right to pause or change endpoints without prior notice during the Alpha phase.',
    termsS4Title: '4. Non-Affiliation',
  },
} as const;

export type UiTranslationKey = keyof typeof uiTranslations.fr;

export function useUiI18n(langOverride?: () => OlydorLang | undefined) {
  const instance = createI18n<UiTranslationKey>(uiTranslations, langOverride);
  if (getCurrentInstance()) {
    onMounted(() => {
      instance.initLanguage();
    });
  } else if (typeof window !== 'undefined') {
    instance.initLanguage();
  }
  return instance;
}

/**
 * Formats a retry-after delay (in seconds) into a human-readable localized duration.
 */
export function formatRetryAfterDuration(seconds: number, lang: OlydorLang): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 3600;
  if (safeSeconds >= 3540) {
    const hours = Math.max(1, Math.round(safeSeconds / 3600));
    if (lang === 'en') {
      return hours === 1 ? '1 hour' : `${hours} hours`;
    }
    return hours === 1 ? '1 heure' : `${hours} heures`;
  }
  if (safeSeconds >= 60) {
    const minutes = Math.round(safeSeconds / 60);
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return `${safeSeconds}s`;
}
