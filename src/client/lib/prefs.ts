import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { patch } from '../api';
import { useMe } from './session';
import type { MeResponse } from '../../shared/schemas/me';

/** Persists locale/theme to the user profile when signed in (and keeps the cached profile in step). */
export function useSavePrefs() {
  const me = useMe();
  const qc = useQueryClient();
  return useCallback(
    (p: { locale?: 'en' | 'he'; theme?: 'light' | 'dark' | 'system' }) => {
      if (!me) return;
      qc.setQueryData<MeResponse>(['me'], (old) => (old ? { ...old, user: { ...old.user, ...p } } : old));
      void patch('/api/me', p).catch(() => {});
    },
    [me, qc],
  );
}
