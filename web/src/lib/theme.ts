import type { ThemeMode } from './domain.js';

export function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';

  const stored = window.localStorage.getItem('saidy_theme');
  if (stored === 'light' || stored === 'dark') return stored;

  if (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) {
    return 'dark';
  }

  return 'light';
}

export function persistTheme(mode: ThemeMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('saidy_theme', mode);
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
}

