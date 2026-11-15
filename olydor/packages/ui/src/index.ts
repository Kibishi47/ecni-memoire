export { default as OlydorLogo } from './components/OlydorLogo.vue'
export { default as AlphaTesterBanner } from './components/AlphaTesterBanner.vue'
export { default as AlphaOnboardingModal } from './components/AlphaOnboardingModal.vue'
export { default as BugReportModal } from './components/BugReportModal.vue'
export { default as AppNavbar } from './components/AppNavbar.vue'
export { default as AppFooter } from './components/AppFooter.vue'
export { default as LegalMentionsContent } from './components/LegalMentionsContent.vue'
export { default as PrivacyPolicyContent } from './components/PrivacyPolicyContent.vue'
export { default as TermsContent } from './components/TermsContent.vue'

export {
  OLYDOR_SVG,
  ALPHA_FEEDBACK_FORM_URL,
  TPCI_NON_AFFILIATION_DISCLAIMER_FR,
  TPCI_NON_AFFILIATION_DISCLAIMER_EN,
} from './logo'
export {
  ALPHA_ONBOARDING_STORAGE_KEY,
  isAlphaOnboardingOpen,
  openAlphaOnboarding,
  closeAlphaOnboarding,
} from './onboarding'
export { olydorTailwindPreset } from './tailwind.preset'
export {
  DEFAULT_LOCAL_URLS,
  DEFAULT_PROD_URLS,
  isDefaultProdUrl,
  isLocalDevEnvironment,
  isLocalHost,
  isLocalUrl,
  resolvePlatformUrls,
  type OlydorPlatformUrls,
  type ResolvePlatformUrlsOptions,
} from './urls'
export {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  currentTheme,
  initTheme,
  setTheme,
  toggleTheme,
  useTheme,
  type OlydorTheme,
} from './theme'
export {
  LANG_STORAGE_KEY,
  createI18n,
  currentOlydorLang,
  initOlydorLanguage,
  setOlydorLanguage,
  toggleOlydorLanguage,
  uiTranslations,
  useUiI18n,
  type OlydorLang,
  type TranslationDictionary,
  type UiTranslationKey,
} from './i18n'
