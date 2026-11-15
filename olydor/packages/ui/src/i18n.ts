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
    navArena: 'Arène Bot',
    navSoonBadge: 'SOON',
    navArenaDisabledTitle: 'Arène 1v1 vs bot Pythia — Bientôt disponible (accès désactivé)',
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
      'Olydor est en phase Bêta ouverte — aidez-nous à améliorer le Simulateur et la future Arène 1v1 contre le bot Pythia !',
    betaFeedbackBtn: 'Devenir Bêta-Testeur',
    betaDismissAria: 'Masquer le bandeau bêta pour cette session',

    // Footer
    footerDesc:
      'Écosystème d’analyse compétitive Pokémon TCG : simulateur Monte-Carlo haute vélocité et laboratoire d’optimisation de decklists.',
    footerPlatformsHeading: 'Plateforme',
    footerHubLink: 'Hub — olydor.app',
    footerInsightLink: 'Insight & Simulateur — insight.olydor.app',
    footerArenaDisabled: 'Arène 1v1 vs bot Pythia — arena.olydor.app (Bientôt disponible)',
    footerBetaCta: 'Rejoindre le programme Bêta',
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
    bugErrorRateLimit: 'Trop de signalements envoyés. Réessayez dans {retry}s.',
    bugErrorNetwork: 'Impossible de joindre l’API Olydor.',
    bugSuccessMsg: 'Signalement #{id} enregistré avec succès.',
    bugCancel: 'Fermer',
    bugSubmit: 'Envoyer le signalement',
    bugSubmitting: 'Envoi en cours...',
  },
  en: {
    // Subtitles
    subtitleInsight: 'Deck Simulator',
    subtitleArena: '1v1 Bot Arena',
    subtitleWeb: 'Pokémon TCG Analytics',

    // Navbar
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

    // Beta banner
    betaRegionAria: 'Olydor Open Beta Program',
    betaBadge: 'OPEN BETA',
    betaText:
      'Olydor is in open Beta testing — help shape the Simulator and upcoming 1v1 Arena against the Pythia bot!',
    betaFeedbackBtn: 'Become a Beta Tester',
    betaDismissAria: 'Dismiss beta banner',

    // Footer
    footerDesc:
      'High-throughput Monte Carlo simulator and deck optimization platform built for competitive Pokémon TCG Standard analysis.',
    footerPlatformsHeading: 'Ecosystem',
    footerHubLink: 'Hub — olydor.app',
    footerInsightLink: 'Insight Simulator — insight.olydor.app',
    footerArenaDisabled: '1v1 Arena vs Pythia bot — arena.olydor.app (Coming Soon)',
    footerBetaCta: 'Beta Feedback Form',
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
