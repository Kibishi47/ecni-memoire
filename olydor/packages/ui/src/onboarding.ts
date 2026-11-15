import { ref } from 'vue'

export const ALPHA_ONBOARDING_STORAGE_KEY = 'olydor_alpha_onboarding_seen_v1'

export const isAlphaOnboardingOpen = ref(false)

export function openAlphaOnboarding(): void {
  isAlphaOnboardingOpen.value = true
}

export function closeAlphaOnboarding(): void {
  isAlphaOnboardingOpen.value = false
}
