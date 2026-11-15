import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ADMIN_ITEM, SIDEBAR_ITEMS } from '../lib/nav';
import { useCanWrite, useMe } from '../lib/session';
import { TourCtx, tourSlug } from '../lib/tour';
import { Sheet } from './Sheet';
import { Button } from './ui';

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

type State = { mode: 'full'; i: number } | { mode: 'page'; path: string } | null;

function Points({ k }: { k: string }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm">
      {t(k).split('\n').map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

function PageText({ path }: { path: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const s = tourSlug(path);
  return (
    <div data-testid={`tour-page-${s}`}>
      <p className="text-sm">{t(`tour.pages.${s}.body`)}</p>
      <Points k={`tour.pages.${s}.points`} />
      {!canWrite && path !== '/admin' && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-muted">{t('tour.viewerNote')}</p>}
    </div>
  );
}

/**
 * App tour in the current UI language (the one picked at sign-in). Runs once automatically
 * (step −1 is the welcome); the info icon in each PageHeader reopens that page's entry.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const me = useMe();
  // Without an active household only the admin page works (SessionGate lets /admin through).
  const steps = !me?.active ? [ADMIN_ITEM] : me.user.isSuperAdmin ? [...SIDEBAR_ITEMS, ADMIN_ITEM] : SIDEBAR_ITEMS;
  const [state, setState] = useState<State>(() => (seen() ? null : { mode: 'full', i: -1 }));
  const tourPath = useRef(pathname);

  const close = () => {
    markSeen();
    setState(null);
  };
  const go = (i: number) => {
    if (i >= steps.length) return close();
    if (i >= 0) {
      tourPath.current = steps[i]!.to;
      nav(steps[i]!.to, { replace: true });
    }
    setState({ mode: 'full', i });
  };
  // Leaving the page the tour put you on (Back, a link) ends the tour.
  useEffect(() => {
    if (pathname === tourPath.current) return;
    tourPath.current = pathname;
    setState((s) => {
      if (s?.mode !== 'full') return s;
      markSeen();
      return null;
    });
  }, [pathname]);

  let title: ReactNode = null;
  let body: ReactNode = null;
  let footer: ReactNode = null;
  if (state?.mode === 'page') {
    const item = [...SIDEBAR_ITEMS, ADMIN_ITEM].find((s) => s.to === state.path);
    title = item ? t(item.key) : t('nav.more');
    body = <PageText path={state.path} />;
    footer = (
      <>
        <Button variant="secondary" data-testid="tour-full" onClick={() => go(-1)}>
          {t('tour.fullTour')}
        </Button>
        <Button data-testid="tour-done" onClick={close}>
          {t('tour.gotIt')}
        </Button>
      </>
    );
  } else if (state?.mode === 'full') {
    const step = steps[state.i];
    const last = state.i === steps.length - 1;
    title = step ? t(step.key) : t('tour.welcomeTitle');
    body = step ? (
      <PageText path={step.to} />
    ) : (
      <div data-testid="tour-welcome">
        <p className="text-sm">{t('tour.welcomeBody')}</p>
        <Points k="tour.welcomePoints" />
      </div>
    );
    footer = (
      <>
        <span className="me-auto self-center text-sm text-muted">{step && t('tour.progress', { n: state.i + 1, total: steps.length })}</span>
        {state.i < 0 ? (
          <Button variant="ghost" data-testid="tour-skip" onClick={close}>
            {t('tour.skip')}
          </Button>
        ) : (
          <Button variant="secondary" data-testid="tour-back" onClick={() => go(state.i - 1)}>
            {t('tour.back')}
          </Button>
        )}
        <Button data-testid="tour-next" onClick={() => go(state.i + 1)}>
          {last ? t('tour.finish') : state.i < 0 ? t('tour.start') : t('tour.next')}
        </Button>
      </>
    );
  }

  return (
    <TourCtx.Provider value={(path) => setState({ mode: 'page', path })}>
      {children}
      <Sheet open={state !== null} onOpenChange={(o) => !o && close()} title={title} footer={footer} testId="tour">
        {body}
      </Sheet>
    </TourCtx.Provider>
  );
}
