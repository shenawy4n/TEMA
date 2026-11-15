import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemePreference } from '@/src/types/domain';

export interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setThemePreference: (pref: ThemePreference) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'tema_theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredPreference(): ThemePreference {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') return val;
  } catch {
    // Ignore storage access errors
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);

  const resolvedTheme: 'light' | 'dark' = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setThemePreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemePreference(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setThemePreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setThemePreference, toggleTheme }),
    [preference, resolvedTheme, setThemePreference, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
