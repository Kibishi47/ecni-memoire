import { computed, getCurrentInstance, onMounted, ref } from 'vue';

export type OlydorTheme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'olydor-theme';

/** Global reactive theme shared across @olydor/ui and host apps. */
export const currentTheme = ref<OlydorTheme>('dark');

let initialized = false;

export function applyThemeToDocument(theme: OlydorTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('light', theme === 'light');
  root.classList.toggle('dark', theme === 'dark');
  root.setAttribute('data-theme', theme);
}

export function setTheme(theme: OlydorTheme): void {
  currentTheme.value = theme;
  applyThemeToDocument(theme);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage quota / privacy mode errors.
    }
  }
}

export function toggleTheme(): OlydorTheme {
  const next: OlydorTheme = currentTheme.value === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme(): OlydorTheme {
  if (typeof window === 'undefined') {
    return currentTheme.value;
  }

  let stored: string | null = null;
  if (typeof localStorage !== 'undefined') {
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      stored = null;
    }
  }

  const resolved: OlydorTheme = stored === 'light' || stored === 'dark' ? stored : 'dark';
  currentTheme.value = resolved;
  applyThemeToDocument(resolved);
  initialized = true;
  return resolved;
}

export function useTheme() {
  if (getCurrentInstance()) {
    onMounted(() => {
      if (!initialized) {
        initTheme();
      } else {
        applyThemeToDocument(currentTheme.value);
      }
    });
  } else if (typeof window !== 'undefined' && !initialized) {
    initTheme();
  }

  const isLight = computed(() => currentTheme.value === 'light');
  const isDark = computed(() => currentTheme.value === 'dark');

  return {
    theme: currentTheme,
    isLight,
    isDark,
    setTheme,
    toggleTheme,
    initTheme,
  };
}
