import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { errorKey, post, setDemo } from '../api';
import { SessionCtx, useCanWrite, useMe } from '../lib/session';
import { pathOf, TourCtx, tourSteps, type TourApi, type TourStep } from '../lib/tour';
import type { MeResponse } from '../../shared/schemas/me';
import { useToast } from './Toast';

const TourOverlay = lazy(() => import('./TourOverlay'));

const LS_KEY = 'mz_tour_done';
const seen = () => {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return true; // no storage: don't nag on every load
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(LS_KEY, '1');
  } catch {
    /* storage unavailable */
  }
};

interface Run {
  steps: TourStep[];
  i: number;
  dir: 1 | -1;
  /** A throwaway cache for demo responses: the real cache is never touched while the tour runs. */
  client: QueryClient;
  badges: MeResponse['badges'];
}

/**
 * Spotlight tour over generated demo data. While it runs, every GET reads the shared read-only demo
 * household (api.ts setDemo) through a separate QueryClient, so real and demo data never share a screen;
 * leaving the tour remounts the app on the real cache and refreshes it. Runs once automatically; the ⓘ
 * in a page header runs that page's steps.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const me = useMe();
  const canWrite = useCanWrite();
  const qc = useQueryClient();
  const toast = useToast();
  const [run, setRun] = useState<Run | null>(null);
  const expected = useRef(pathname);
  const starting = useRef(false);

  const close = () => {
    setDemo(null);
    setRun(null);
    markSeen();
    void qc.invalidateQueries();
  };
  const go = (r: Run, i: number, dir: 1 | -1) => {
    if (i >= r.steps.length) return close();
    const step = r.steps[Math.max(0, i)]!;
    expected.current = pathOf(step.path);
    if (pathname + window.location.search !== step.path) nav(step.path, { replace: true });
    setRun({ ...r, i: Math.max(0, i), dir });
  };
  const start = async (page?: string) => {
    if (!me?.active || starting.current || run) return;
    starting.current = true;
    const locale = i18n.language === 'he' ? 'he' : 'en';
    try {
      const d = await post<{ badges: MeResponse['badges']; reviewMonth: string; cardMonth: string }>('/api/demo', { locale });
      const steps = tourSteps({ canWrite, page, month: d.reviewMonth, cardMonth: d.cardMonth });
      if (!steps.length) return;
      setDemo(locale);
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } });
      go({ steps, i: 0, dir: 1, client, badges: me.role === 'viewer' ? { ...d.badges, reviewDue: null } : d.badges }, 0, 1);
    } catch (e) {
      toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' });
    } finally {
      starting.current = false;
    }
  };

  // First visit: the full tour, once the profile's language has been applied (so it runs in that language).
  const auto = useRef(false);
  const settled = !me?.user.locale || me.user.locale === i18n.language;
  useEffect(() => {
    if (auto.current || !settled || !me?.active || seen()) return;
    auto.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, me?.active]);

  // Leaving the page the tour put you on (browser Back) ends the tour.
  useEffect(() => {
    if (pathname === expected.current) return;
    expected.current = pathname;
    if (run) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // The page behind the spotlight is inert: focus and screen readers stay in the tour.
  useEffect(() => {
    document.getElementById('root')?.toggleAttribute('inert', !!run);
  }, [run]);
  useEffect(() => () => setDemo(null), []);

  const api: TourApi = { startPage: (p) => void start(p), startFull: () => void start() };
  const demoMe = run && me ? { ...me, active: me.active && { ...me.active, hasSampleData: false }, badges: run.badges } : null;
  const step = run?.steps[run.i];

  return (
    <TourCtx.Provider value={api}>
      {run && demoMe ? (
        <QueryClientProvider client={run.client}>
          <SessionCtx.Provider value={demoMe}>{children}</SessionCtx.Provider>
        </QueryClientProvider>
      ) : (
        children
      )}
      {run && step && (
        <Suspense fallback={null}>
          <TourOverlay
            key={step.id}
            step={step}
            n={run.i + 1}
            total={run.steps.length}
            onNext={() => go(run, run.i + 1, 1)}
            onBack={run.i > 0 ? () => go(run, run.i - 1, -1) : undefined}
            onMissing={() => (run.dir === -1 && run.i === 0 ? go(run, 1, 1) : go(run, run.i + run.dir, run.dir))}
            onClose={close}
          />
        </Suspense>
      )}
    </TourCtx.Provider>
  );
}
