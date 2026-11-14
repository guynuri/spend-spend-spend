import { useCallback } from 'react';
import { patch } from '../api';
import { useMe } from './session';

/** Persists locale/theme to the user profile when signed in. */
export function useSavePrefs() {
  const me = useMe();
  return useCallback(
    (p: { locale?: 'en' | 'he'; theme?: 'light' | 'dark' | 'system' }) => {
      if (me) void patch('/api/me', p).catch(() => {});
    },
    [me],
  );
}
