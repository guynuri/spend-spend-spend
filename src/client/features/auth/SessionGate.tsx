import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, get } from '../../api';
import { SessionCtx } from '../../lib/session';
import { setLocale } from '../../i18n';
import { applyTheme } from '../../theme';
import type { MeResponse } from '../../../shared/schemas/me';
import { ErrorState, Spinner } from '../../components/ui';
import { AuthLayout } from './AuthLayout';
import { NoHousehold } from './NoHousehold';

export const ME_KEY = ['me'] as const;

export function useMeQuery() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => get<MeResponse>('/api/me'), staleTime: 60_000 });
}

export function SessionGate() {
  const loc = useLocation();
  const { i18n } = useTranslation();
  const q = useMeQuery();
  const me = q.data;
  // Apply the profile's locale/theme when the profile value changes (not when the UI switches).
  useEffect(() => {
    if (me?.user.locale && me.user.locale !== i18n.language) void setLocale(me.user.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.user.locale]);
  useEffect(() => {
    if (me?.user.theme) {
      try {
        if (me.user.theme === 'system') localStorage.removeItem('mz_theme');
        else localStorage.setItem('mz_theme', me.user.theme);
      } catch {
        /* ignore */
      }
      applyTheme(me.user.theme);
    }
  }, [me?.user.theme]);

  if (q.isPending) return <Spinner className="min-h-dvh" />;
  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 401) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
    return (
      <AuthLayout>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </AuthLayout>
    );
  }
  const needsHousehold = !me!.active && !loc.pathname.startsWith('/admin');
  return (
    <SessionCtx.Provider value={me!}>
      {needsHousehold ? <NoHousehold /> : <Outlet />}
    </SessionCtx.Provider>
  );
}
