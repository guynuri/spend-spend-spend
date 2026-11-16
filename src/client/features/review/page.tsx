import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react';
import { get, post } from '../../api';
import { Badge, Button, Card, CardTitle, ErrorState, PageHeader, ProgressBar, Spinner } from '../../components/ui';
import { DateText, useFormatDate } from '../../components/DateText';
import { useToast } from '../../components/Toast';
import { useCanWrite } from '../../lib/session';
import { CHAPTERS, type ReviewSnapshot } from '../../../shared/domain/review';
import { ChapterView } from './Chapters';
import { AiInterpretation, AiReviewControls, type AiReview } from './AiControls';

interface ReviewResponse {
  status: 'draft' | 'completed';
  completedAt: string | null;
  snapshot: ReviewSnapshot;
  ai: AiReview | null;
}

function ReviewList({ onOpen }: { onOpen: (m: string) => void }) {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const q = useQuery({
    queryKey: ['reviews'],
    queryFn: () => get<{ defaultMonth: string; available: string[]; reviews: { month: string; healthScore: number | null; completedAt: string }[] }>('/api/reviews'),
  });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const done = new Set(q.data.reviews.map((r) => r.month));
  const open = q.data.available.filter((m) => !done.has(m) && m !== q.data.defaultMonth);
  return (
    <div className="flex flex-col gap-4">
      {!done.has(q.data.defaultMonth) && (
        <Card>
          <Button className="w-full" onClick={() => onOpen(q.data.defaultMonth)} data-testid="review-start" data-tour="review-start">
            <ClipboardCheck className="size-5" aria-hidden />
            {t('review.start', { month: fmt(q.data.defaultMonth, 'month') })}
          </Button>
        </Card>
      )}
      {open.length > 0 && (
        <Card>
          <CardTitle>{t('review.ready')}</CardTitle>
          <ul className="divide-y divide-border">
            {open.map((m) => (
              <li key={m}>
                <button type="button" onClick={() => onOpen(m)} className="flex min-h-12 w-full items-center justify-between gap-2 text-start" data-testid="review-available-item">
                  <DateText date={m} format="month" className="font-medium" />
                  <Badge>{t('review.notReviewed')}</Badge>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardTitle>{t('review.history')}</CardTitle>
        {q.data.reviews.length === 0 ? (
          <p className="text-sm text-muted">{t('review.none')}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="review-history">
            {q.data.reviews.map((r) => (
              <li key={r.month}>
                <button type="button" onClick={() => onOpen(r.month)} className="flex min-h-12 w-full items-center justify-between gap-2 text-start" data-testid="review-history-item">
                  <span className="font-medium">
                    <DateText date={r.month} format="month" />
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted">
                    {r.healthScore !== null && <Badge tone="accent">{r.healthScore}</Badge>}
                    <CheckCircle2 className="size-4 text-good" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReviewFlow({ month, step, setStep }: { month: string; step: number; setStep: (n: number) => void }) {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const toast = useToast();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const [aiRun, setAiRun] = useState(0);
  const q = useQuery({ queryKey: ['review', month], queryFn: () => get<ReviewResponse>(`/api/reviews/${month}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { snapshot: s, status, ai, completedAt } = q.data;
  const ch = CHAPTERS[step]!;
  const last = step === CHAPTERS.length - 1;
  const complete = async () => {
    await post(`/api/reviews/${month}/complete`);
    await qc.invalidateQueries({ queryKey: ['reviews'] });
    await qc.invalidateQueries({ queryKey: ['review', month] });
    await qc.invalidateQueries({ queryKey: ['me'] });
    toast({ title: t('review.completeDone'), tone: 'good' });
  };
  return (
    <div className="flex flex-col gap-4" data-testid="review-flow" data-status={status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted">{t('review.step', { n: step + 1, total: CHAPTERS.length })}</span>
        {status === 'completed' ? <Badge tone="good">{t('review.completed')}</Badge> : <Badge>{t('review.draft')}</Badge>}
      </div>
      <ProgressBar value={(step + 1) / CHAPTERS.length} label={t('review.title')} />
      <AiReviewControls month={month} ai={ai} onDone={() => setAiRun((n) => n + 1)} />
      <Card data-testid={`chapter-${ch}`}>
        <CardTitle>{t(`review.chapters.${ch}`)}</CardTitle>
        <ChapterView ch={ch} s={s} />
        <p className="mt-3 text-xs text-muted" data-tour="review-ai">{t('review.ruleBased')}</p>
        {ai && <AiInterpretation ai={ai} ch={ch} scrollKey={aiRun} />}
      </Card>
      {last &&
        (status === 'completed' ? (
          <p className="flex items-center justify-center gap-2 text-sm text-good" data-testid="review-completed-note">
            <CheckCircle2 className="size-4" aria-hidden />
            {completedAt ? t('review.completedOn', { date: fmt(completedAt.slice(0, 10), 'long') }) : t('review.completed')}
          </p>
        ) : (
          canWrite && (
            <Button className="w-full" onClick={() => void complete()} data-testid="review-complete">
              <CheckCircle2 className="size-5" aria-hidden />
              {t('review.complete')}
            </Button>
          )
        ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" disabled={step === 0} onClick={() => setStep(step - 1)} data-testid="review-back">
          <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {t('review.back')}
        </Button>
        {!last && (
          <Button variant="ghost" onClick={() => setStep(CHAPTERS.length - 1)} data-testid="review-skip">
            {t('review.toWrapup')}
          </Button>
        )}
        {!last && (
          <Button onClick={() => setStep(step + 1)} data-testid="review-next">
            {t('review.next')}
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

export function Component() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month');
  const step = Math.min(CHAPTERS.length - 1, Math.max(0, Number(sp.get('step') ?? 0) || 0));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('review.title')} subtitle={month ? <DateText date={month} format="month" /> : undefined} />
      {month ? <ReviewFlow month={month} step={step} setStep={(n) => setSp({ month, step: String(n) })} /> : <ReviewList onOpen={(m) => setSp({ month: m, step: '0' })} />}
    </div>
  );
}
