import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { findTarget, placePopover, type Box, type TourStep } from '../lib/tour';
import { Button } from './ui';

/** How long a step waits for its target (page + demo data loading) before it is skipped. */
const WAIT_MS = 4000;
const PAD = 6;

/**
 * One tour step: dims the app, cuts a ringed hole around the target and puts the popover beside it.
 * The page behind is inert (Tour.tsx); clicks on the dim layer do nothing; Esc ends the tour.
 */
export default function TourOverlay({ step, n, total, onNext, onBack, onClose, onMissing }: { step: TourStep; n: number; total: number; onNext: () => void; onBack?: () => void; onClose: () => void; onMissing: () => void }) {
  const { t, i18n } = useTranslation();
  const [box, setBox] = useState<Box | null>(null);
  const [found, setFound] = useState(step.target === null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const next = useRef<HTMLButtonElement>(null);
  const missing = useRef(onMissing);
  missing.current = onMissing;
  const close = useRef(onClose);
  close.current = onClose;

  // Find the target (it may still be loading), scroll it into view, then follow it every frame.
  useEffect(() => {
    if (!step.target) return;
    const t0 = Date.now();
    let el: HTMLElement | null = null;
    let raf = 0;
    const tick = () => {
      if (!el?.isConnected) {
        el = findTarget(document, step.target!);
        if (!el) {
          if (Date.now() - t0 > WAIT_MS) return missing.current();
          raf = requestAnimationFrame(tick);
          return;
        }
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        setFound(true);
      }
      const r = el.getBoundingClientRect();
      setBox((b) => (b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height ? b : { top: r.top, left: r.left, width: r.width, height: r.height }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step.target]);

  useLayoutEffect(() => {
    if (!found || !pop.current) return;
    const hole = box && { top: box.top - PAD, left: box.left - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD };
    const p = placePopover(hole, pop.current.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, i18n.dir() === 'rtl');
    // A tall target centred on screen leaves no room either side: move it up under the header, once.
    if (hole && !p.fits && !scrolled.current) {
      scrolled.current = true;
      window.scrollBy(0, hole.top - 64);
      return;
    }
    setPos((o) => (o && o.top === p.top && o.left === p.left ? o : { top: p.top, left: p.left }));
  }, [found, box, i18n]);

  useEffect(() => {
    if (pos) next.current?.focus({ preventScroll: true });
  }, [!!pos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const last = n === total;
  return createPortal(
    <div className="fixed inset-0 z-[60]" data-testid="tour" dir={i18n.dir()}>
      {/* swallows taps on the page so nothing behind the tour changes */}
      <div className={box ? 'absolute inset-0' : 'absolute inset-0 bg-black/55'} aria-hidden />
      {box && (
        <div
          className="pointer-events-none fixed rounded-xl ring-4 ring-accent"
          style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
          data-testid="tour-hole"
          aria-hidden
        />
      )}
      {found && (
        <div
          ref={pop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          data-testid="tour-popover"
          data-step={step.id}
          className="fixed w-[min(22rem,calc(100vw-1rem))] rounded-2xl border border-border bg-surface p-4 text-text shadow-xl"
          style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
        >
          <span className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-warn px-2.5 py-0.5 text-xs font-bold text-white" data-testid="demo-badge">
            <FlaskConical className="size-3.5" aria-hidden />
            {t('tour.demoBadge')}
          </span>
          <div aria-live="polite" aria-atomic="true">
            <h2 id="tour-title" className="font-semibold">
              {t(`tour.steps.${step.id}.title`)}
            </h2>
            <p id="tour-body" className="mt-1 text-sm text-muted" data-testid="tour-text">
              {t(`tour.steps.${step.id}.body`)}
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="me-auto text-sm text-muted" data-testid="tour-progress" aria-label={t('tour.progress', { n, total })}>
              {n}/{total}
            </span>
            {!last && (
              <Button variant="ghost" size="sm" onClick={onClose} data-testid="tour-skip">
                {t('tour.skip')}
              </Button>
            )}
            {onBack && (
              <Button variant="secondary" size="sm" onClick={onBack} data-testid="tour-back">
                {t('tour.back')}
              </Button>
            )}
            <Button ref={next} size="sm" onClick={onNext} data-testid="tour-next">
              {last ? t('tour.finish') : t('tour.next')}
            </Button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
