import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck } from 'lucide-react';
import { post } from '../../api';
import { Button, Card } from '../../components/ui';
import { useFormatDate } from '../../components/DateText';
import { useApiMutation } from '../../lib/mutate';
import { useCanWrite, useMe } from '../../lib/session';

/** Overview call-to-action: a month ended and its review is ready (from /api/me badges, no extra fetch). */
export function ReviewDueCard() {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const month = useMe()?.badges.reviewDue;
  const canWrite = useCanWrite();
  const dismiss = useApiMutation((m: string) => post(`/api/reviews/${m}/dismiss`), { invalidate: [['me'], ['reviews']] });
  if (!month) return null;
  return (
    <Card data-testid="review-due">
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 size-6 shrink-0 text-accent" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <p className="font-semibold">{t('review.dueTitle', { month: fmt(month, 'month') })}</p>
            <p className="text-sm text-muted">{t('review.dueBody')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/review?month=${month}&step=0`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 font-medium text-accent-fg" data-testid="review-due-open">
              {t('review.dueOpen')}
            </Link>
            {canWrite && (
              <Button variant="ghost" busy={dismiss.isPending} onClick={() => dismiss.mutate(month)} data-testid="review-due-dismiss">
                {t('review.dueDismiss')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
