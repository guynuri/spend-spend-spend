import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { get, post } from '../../api';
import { Card } from '../../components/ui';
import { Money } from '../../components/Money';
import { CategoryIcon } from '../../components/CategoryIcon';
import { useFormatDate } from '../../components/DateText';
import { useApiMutation } from '../../lib/mutate';
import { useCategoryMap } from '../../lib/queries';
import { useParamFormatter } from '../../lib/format';
import type { WeekRecap } from '../../../shared/domain/alerts';
import { REMINDERS_QK, useReminders } from '../settings/Reminders';

/** The weekly recap on Home: shown once the recap reminder comes due, until dismissed (D-R27). */
export function RecapCard() {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const pf = useParamFormatter();
  const cats = useCategoryMap();
  const r = (useReminders().data?.reminders ?? []).find((x) => x.kind === 'recap' && x.due);
  const q = useQuery({ queryKey: ['dashboard', 'week'], queryFn: () => get<WeekRecap>('/api/dashboard/week'), enabled: !!r });
  const seen = useApiMutation((id: string) => post(`/api/reminders/${id}/seen`), { invalidate: [REMINDERS_QK] });
  if (!r || !q.data) return null;
  const w = q.data;
  const diff = w.spentMinor - w.prevSpentMinor;
  return (
    <Card data-testid="recap-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t('home.week.title')} 📅</h2>
          <p className="text-xs text-muted">{t('home.week.range', { from: fmt(w.from, 'dayMonth'), to: fmt(w.to, 'dayMonth') })}</p>
        </div>
        <button type="button" onClick={() => seen.mutate(r.id)} className="-m-2 inline-flex size-11 items-center justify-center rounded-xl text-muted" aria-label={t('common.dismiss')} data-testid="recap-dismiss">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-xs text-muted">{t('home.week.spent')}</p>
          <Money minor={w.spentMinor} decimals={0} className="text-xl font-bold" />
          {w.prevSpentMinor > 0 && diff !== 0 && (
            <p className={diff < 0 ? 'text-xs text-good' : 'text-xs text-warn'}>{t('home.week.vsPrev', { ...pf({ amountMinor: Math.abs(diff) }), dir: t(diff < 0 ? 'home.week.less' : 'home.week.more') })}</p>
          )}
        </div>
        {w.leftMinor !== null && (
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-xs text-muted">{t('home.week.left')}</p>
            <Money minor={w.leftMinor} decimals={0} tone className="text-xl font-bold" />
          </div>
        )}
      </div>
      {w.top.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-xs font-medium text-muted">{t('home.week.top')}</p>
          <ul className="flex flex-col gap-1">
            {w.top.map((x) => {
              const c = x.categoryId ? cats.get(x.categoryId) : null;
              return (
                <li key={x.categoryId ?? 'none'} className="flex items-center gap-3 text-sm">
                  <CategoryIcon cat={c ?? { id: 'none', color: 'cat-other', emoji: '❔' }} size="sm" />
                  <bdi className="min-w-0 flex-1 truncate">{c?.name ?? t('trends.uncategorized')}</bdi>
                  <Money minor={x.spentMinor} decimals={0} className="font-semibold" />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
