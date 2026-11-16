import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { ApiError, post } from '../../api';
import { Button } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useCanWrite, useIsOwner } from '../../lib/session';
import { useAiStatus } from '../ai/useAi';
import type { Chapter } from '../../../shared/domain/review';

export interface AiReview {
  headline: string;
  commentary: Record<string, string>;
  model?: string;
}

/**
 * AC12.3 / AC13.4: AI button when enabled; owner hint when off; hidden for others.
 * The result is never swapped into the rule-based text: it renders as its own labelled block (AiInterpretation).
 */
export function AiReviewControls({ month, ai, onDone }: { month: string; ai: AiReview | null; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const owner = useIsOwner();
  const canWrite = useCanWrite();
  const s = useAiStatus();
  const [busy, setBusy] = useState(false);
  const enabled = !!s.data?.available && !!s.data?.enabled;
  if (enabled && canWrite)
    return (
      <Button
        variant="secondary"
        busy={busy}
        data-testid="ai-write"
        onClick={async () => {
          setBusy(true);
          try {
            await post(`/api/ai/review/${month}`);
            await qc.invalidateQueries({ queryKey: ['review', month] });
            onDone();
          } catch (e) {
            const code = e instanceof ApiError && e.code.startsWith('ai_') ? e.code : null;
            toast({ title: code ? t(`errors.${code}`) : t('ai.failed'), tone: 'bad' });
          } finally {
            setBusy(false);
            await qc.invalidateQueries({ queryKey: ['ai-status'] });
          }
        }}
      >
        <Sparkles className="size-4" aria-hidden />
        {busy ? t('ai.writing') : ai ? t('ai.rewriteReview') : t('ai.writeReview')}
      </Button>
    );
  if (s.data?.available && owner)
    return (
      <p className="text-sm text-muted" data-testid="ai-enable-hint">
        {t('ai.enableHint')}{' '}
        <Link to="/settings" className="font-medium text-accent">
          {t('ai.enableHintLink')}
        </Link>
      </p>
    );
  return null;
}

/** The AI interpretation for one chapter, visually distinct from the rule-based text; scrolls into view after a fresh run. */
export function AiInterpretation({ ai, ch, scrollKey }: { ai: AiReview; ch: Chapter; scrollKey: number }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (scrollKey) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollKey]);
  const text = ai.commentary[ch];
  return (
    <section ref={ref} className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3" aria-label={t('ai.interpretation')} data-testid="ai-interpretation">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-accent">
        <Sparkles className="size-4" aria-hidden />
        {t('ai.interpretation')}
      </h3>
      {(ch === 'summary' || ch === 'wrapup') && (
        <p className="font-semibold" data-testid="ai-headline">
          {ai.headline}
        </p>
      )}
      {text && (
        <p className="text-sm" data-testid="ai-text">
          {text}
        </p>
      )}
      <p className="mt-2 text-xs text-muted" data-testid="ai-written">
        {t('ai.disclaimer')}
      </p>
    </section>
  );
}
