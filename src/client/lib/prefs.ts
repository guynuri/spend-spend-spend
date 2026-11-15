import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { patch } from '../api';
import { useMe } from './session';
import type { MeResponse } from '../../shared/schemas/me';
import { parseNavTabs } from './nav';

/**
 * Persists locale/theme to the user profile when signed in. The cached profile is updated first
 * (so the UI doesn't flip back) and restored if the save fails.
 */
export function useSavePrefs() {
  const me = useMe();
  const qc = useQueryClient();
  return useCallback(
    (p: { locale?: 'en' | 'he'; theme?: 'light' | 'dark' | 'system' }) => {
      if (!me) return;
      const before = qc.getQueryData<MeResponse>(['me']);
      qc.setQueryData<MeResponse>(['me'], (old) => (old ? { ...old, user: { ...old.user, ...p } } : old));
      void patch('/api/me', p).catch(() => {
        if (before) qc.setQueryData(['me'], before);
      });
    },
    [me, qc],
  );
}

// Bottom-bar pages: a per-device preference (localStorage), like the theme.
const NAV_KEY = 'mz_nav_tabs';
const navListeners = new Set<() => void>();
const readRaw = () => {
  try {
    return localStorage.getItem(NAV_KEY);
  } catch {
    return null;
  }
};

/** The paths shown in the bottom bar, in order, plus a setter (null resets to default). */
export function useNavTabs() {
  const raw = useSyncExternalStore(
    (cb) => (navListeners.add(cb), () => navListeners.delete(cb)),
    readRaw,
    () => null,
  );
  const tabs = useMemo(() => parseNavTabs(raw), [raw]);
  const setTabs = useCallback((next: string[] | null) => {
    try {
      if (next) localStorage.setItem(NAV_KEY, JSON.stringify(next));
      else localStorage.removeItem(NAV_KEY);
    } catch {
      /* storage unavailable: keep the default */
    }
    navListeners.forEach((l) => l());
  }, []);
  return [tabs, setTabs] as const;
}
