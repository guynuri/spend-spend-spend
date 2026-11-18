import { useEffect, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cx } from './ui';

/**
 * A thin line at the top of the screen while anything is being saved or deleted, so every action
 * shows it is working (also the ones without a spinner of their own). Appears after 150 ms, so instant
 * saves don't flicker; sits above sheets (z-50).
 */
export function MutationProgress() {
  const { t } = useTranslation();
  // Paused mutations (offline) aren't saving: they'd keep the line running until back online.
  const n = useIsMutating({ predicate: (m) => !m.state.isPaused });
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!n) return setShow(false);
    const id = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(id);
  }, [n]);
  return (
    <div
      role="progressbar"
      aria-label={t('common.saving')}
      aria-hidden={!show}
      data-testid="mutation-progress"
      data-active={show}
      className={cx('pointer-events-none fixed inset-x-0 z-[60] h-[3px] overflow-hidden transition-opacity duration-200', show ? 'opacity-100' : 'opacity-0')}
      style={{ top: 'env(safe-area-inset-top)' }}
    >
      {/* Animated only while shown: no hidden animation running on every page. */}
      {show && <div className="h-full w-1/3 rounded-full bg-accent animate-[progress-slide_1.1s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:animate-pulse" />}
    </div>
  );
}
