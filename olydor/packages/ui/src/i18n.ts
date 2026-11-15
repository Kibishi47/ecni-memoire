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
    navHub: 'Hub',
    navInsight: 'Insight',
    navArena: 'Arène IA',
    navSoonBadge: 'SOON',
    navArenaDisabledTitle: 'Arène IA Pythia — Bientôt disponible (accès désactivé)',
    navSwitchLangLabel: 'Passer en Anglais',
    navLangCode: 'FR',
    navSwitchThemeToLight: 'Passer au thème clair',
    navSwitchThemeToDark: 'Passer au thème sombre',
    navReportBug: 'Signaler un bug',
    navOpenMenu: 'Menu',

    // Beta banner
    betaRegionAria: 'Programme Bêta Ouverte Olydor',
    betaBadge: 'BÊTA OUVERTE',
    betaText:
      'Olydor est en phase Bêta ouverte — contribuez à améliorer le moteur 3-ply et la future Arène IA Pythia !',
    betaFeedbackBtn: 'Devenir Bêta-Testeur',
    betaDismissAria: 'Masquer le bandeau bêta pour cette session',

    // Footer
    footerDesc:
      'Écosystème d’analyse compétitive Pokémon TCG : simulation Monte-Carlo 3-ply haute vélocité et laboratoire d’optimisation de decklists.',
    footerPlatformsHeading: 'Plateforme',
    footerHubLink: 'Hub — olydor.app',
    footerInsightLink: 'Insight & Simulateur — insight.olydor.app',
    footerArenaDisabled: 'Arène IA Pythia — arena.olydor.app (Bientôt disponible)',
    footerBetaCta: 'Rejoindre le programme Bêta',
    footerLegalHeading: 'Informations Légales',
    footerLegalNotice: 'Mentions Légales',
    footerPrivacy: 'Politique de Confidentialité (RGPD)',
    footerTerms: 'Conditions Générales d’Utilisation (CGU)',
    footerCopyright: '© {year} Olydor',

    // Bug report modal
    bugModalTitle: 'Signaler un bug ou une carte erronée',
    bugModalSubtitle: 'Transmis directement à l’équipe Olydor via api.olydor.app',
    bugModalCloseAria: 'Fermer',
    bugTypeLabel: 'Type de signalement',
    bugTypeCardTitle: 'CARD_MODEL_ERROR',
    bugTypeCardDesc: 'Modèle ou effet d’une carte',
    bugTypeEngineTitle: 'ENGINE_RULE_ERROR',
    bugTypeEngineDesc: 'Règle TCG / décision IA 3-ply',
    bugCardIdLabel: 'Identifiant de carte (ex: sv03-125)',
    bugDescLabel: 'Description du problème observé',
    bugDescPlaceholder: 'Décrivez le comportement attendu vs ce que Olydor a exécuté...',
    bugErrorMissingCardId:
      'Veuillez saisir un identifiant de carte (ex: sv03-125) pour une erreur de carte.',
    bugErrorServer: 'Erreur serveur ({status})',
    bugErrorRateLimit: 'Trop de signalements envoyés. Réessayez dans {retry}s.',
    bugErrorNetwork: 'Impossible de joindre l’API Olydor.',
    bugSuccessMsg: 'Signalement #{id} enregistré avec succès.',
    bugCancel: 'Fermer',
    bugSubmit: 'Envoyer le signalement',
    bugSubmitting: 'Envoi en cours...',
  },
  en: {
    // Subtitles
    subtitleInsight: 'Monte Carlo 3-Ply',
    subtitleArena: 'Pythia AI Arena',
    subtitleWeb: 'Pokémon TCG Analytics',

    // Navbar
    navHub: 'Hub',
    navInsight: 'Insight',
    navArena: 'AI Arena',
    navSoonBadge: 'SOON',
    navArenaDisabledTitle: 'Pythia AI Arena — Coming Soon (disabled)',
    navSwitchLangLabel: 'Switch to French',
    navLangCode: 'EN',
    navSwitchThemeToLight: 'Switch to light theme',
    navSwitchThemeToDark: 'Switch to dark theme',
    navReportBug: 'Report Bug',
    navOpenMenu: 'Menu',

    // Beta banner
    betaRegionAria: 'Olydor Open Beta Program',
    betaBadge: 'OPEN BETA',
    betaText:
      'Olydor is in open Beta testing — help shape the 3-ply Pokémon TCG engine & Pythia AI Arena.',
    betaFeedbackBtn: 'Become a Beta Tester',
    betaDismissAria: 'Dismiss beta banner',

    // Footer
    footerDesc:
      'High-throughput Monte Carlo simulator and 3-ply lookahead tactical engine built for competitive Pokémon TCG Standard analysis.',
    footerPlatformsHeading: 'Ecosystem',
    footerHubLink: 'Hub — olydor.app',
    footerInsightLink: 'Insight Simulator — insight.olydor.app',
    footerArenaDisabled: 'AI Arena — arena.olydor.app (Coming Soon)',
    footerBetaCta: 'Beta Feedback Form',
    footerLegalHeading: 'Legal & Compliance',
    footerLegalNotice: 'Legal Notice',
    footerPrivacy: 'Privacy Policy (GDPR)',
    footerTerms: 'Terms of Service',
    footerCopyright: '© {year} Olydor',

    // Bug report modal
    bugModalTitle: 'Report an Issue',
    bugModalSubtitle: 'Sent directly to Olydor maintainers',
    bugModalCloseAria: 'Close',
    bugTypeLabel: 'Issue Type',
    bugTypeCardTitle: 'CARD_MODEL_ERROR',
    bugTypeCardDesc: 'Compiled card effect / stats',
    bugTypeEngineTitle: 'ENGINE_RULE_ERROR',
    bugTypeEngineDesc: 'TCG rule / 3-ply AI behavior',
    bugCardIdLabel: 'Card ID (e.g. sv03-125)',
    bugDescLabel: 'Description',
    bugDescPlaceholder: 'Describe the expected behavior vs what Olydor did...',
    bugErrorMissingCardId: 'Please enter a Card ID (e.g. sv03-125) for a card model report.',
    bugErrorServer: 'Server error ({status})',
    bugErrorRateLimit: 'Too many reports sent. Please wait {retry}s.',
    bugErrorNetwork: 'Unable to reach Olydor API.',
    bugSuccessMsg: 'Report #{id} recorded successfully.',
    bugCancel: 'Close',
    bugSubmit: 'Submit Report',
    bugSubmitting: 'Sending...',
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
