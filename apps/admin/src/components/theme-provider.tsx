'use client';

import {
  type Theme,
  THEME_COOKIE,
  applyThemeClass,
  getStoredTheme,
  getSystemTheme,
  resolveTheme,
  setThemeCookie,
} from '@/lib/theme';
import { createContext, useContext, useLayoutEffect, useState } from 'react';

type Ctx = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void };

const ThemeContext = createContext<Ctx | null>(null);

type ThemeProviderProps = {
  children: React.ReactNode;
  /** Theme from server cookie — keeps first paint in sync without inline scripts */
  initialTheme?: Theme;
};

export function ThemeProvider({ children, initialTheme = 'light' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useLayoutEffect(() => {
    const stored = getStoredTheme();
    const resolved = resolveTheme(stored, getSystemTheme());
    setThemeState(resolved);
    applyThemeClass(resolved);
    if (stored) setThemeCookie(stored);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(THEME_COOKIE, t);
    setThemeCookie(t);
    applyThemeClass(t);
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) return { theme: 'light' as Theme, setTheme: () => {}, toggle: () => {} };
  return ctx;
}
