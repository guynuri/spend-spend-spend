import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { patch } from '../api';
import { useMe } from './session';
import type { MeResponse } from '../../shared/schemas/me';
import { parseNavTabs } from './nav';
import type { HomeWidgetId } from '../../shared/home';

/** Saves go one after another, so quick changes (e.g. several Home reorders) reach the server in order. */
let saving: Promise<unknown> = Promise.resolve();
let inflight = 0;
let failed = false;
/** What the saves still in flight will change, laid over any profile fetched meanwhile. */
let pending: Partial<MeResponse['user']> = {};

/**
 * A fetched profile with the unsaved changes on top: a refetch that lands while saves are still going
 * (another tab, a ledger write refreshing badges) must not undo what the user just did.
 */
export const withPendingPrefs = (d: MeResponse): MeResponse => (inflight ? { ...d, user: { ...d.user, ...pending } } : d);

/**
 * Persists locale/theme/Home layout to the user profile when signed in. The cached profile is updated first
 * (so the UI doesn't flip back); if a save fails, the profile is fetched again (the server's truth).
 */
export function useSavePrefs() {
  const me = useMe();
  const qc = useQueryClient();
  return useCallback(
    (p: { locale?: 'en' | 'he'; theme?: 'light' | 'dark' | 'system'; homeWidgets?: HomeWidgetId[] | null }) => {
      if (!me) return;
      inflight++;
      pending = { ...pending, ...p };
      qc.setQueryData<MeResponse>(['me'], (old) => (old ? { ...old, user: { ...old.user, ...p } } : old));
      saving = saving
        .catch(() => undefined)
        .then(() => patch('/api/me', p))
        .catch(() => {
          failed = true;
        })
        .finally(() => {
          if (--inflight > 0) return;
          pending = {};
          if (failed) {
            failed = false;
            void qc.invalidateQueries({ queryKey: ['me'] });
          }
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
