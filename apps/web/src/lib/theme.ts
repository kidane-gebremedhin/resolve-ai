export type Theme = 'light' | 'dark';

export const THEME_COOKIE = 'theme';

export function parseTheme(value: string | undefined): Theme | null {
  if (value === 'light' || value === 'dark') return value;
  return null;
}

export function setThemeCookie(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme};path=/;max-age=31536000;SameSite=Lax`;
}

export function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_COOKIE);
    return parseTheme(stored ?? undefined);
  } catch {
    return null;
  }
}

export function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(stored: Theme | null, system: Theme): Theme {
  return stored ?? system;
}

export function applyThemeClass(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
