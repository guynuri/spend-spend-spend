import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Repeat } from 'lucide-react';
import { get } from '../../api';
import { Card, CardTitle, PageHeader } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { ForecastCard, useForecast } from './ForecastCard';
import { PlannedList } from '../recurring/Planned';
import type { RecurringDto } from '../../../shared/schemas/plan';

/** Recurring payments are managed only on /recurring; here they are read-only (next 3 due). */
function RecurringReadOnly() {
  const { t } = useTranslation();
  const items = (useQuery({ queryKey: ['recurring'], queryFn: () => get<{ items: RecurringDto[] }>('/api/recurring') }).data?.items ?? []).filter((r) => r.status === 'active' && r.next).sort((a, b) => a.next!.due.localeCompare(b.next!.due));
  return (
    <Card data-testid="forecast-recurring">
      <CardTitle
        action={
          <Link to="/recurring" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent" data-testid="forecast-manage-recurring">
            <Repeat className="size-4" aria-hidden />
            {t('forecast.manageRecurring')}
          </Link>
        }
      >
        {t('forecast.recurringTitle')}
      </CardTitle>
      <p className="mb-2 text-xs text-muted" data-testid="forecast-recurring-hint">{items.length === 0 ? t('forecast.recurringEmpty') : t('forecast.recurringHint', { count: items.length })}</p>
      <ul className="divide-y divide-border text-sm">
        {items.slice(0, 3).map((r) => (
          <li key={r.id} className="flex justify-between gap-2 py-2">
            <span className="min-w-0 truncate">
              <bdi>{r.name}</bdi> · <DateText date={r.next!.due} format="dayMonth" />
            </span>
            <Money minor={r.next!.amountMinor} tone />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Component() {
  const { t } = useTranslation();
  const q = useForecast();
  const f = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('forecast.title')} />
      <ForecastCard link={false} />
      {f && f.missed.length > 0 && (
        <Card>
          <CardTitle>{t('forecast.missed')}</CardTitle>
          <ul className="divide-y divide-border text-sm" data-testid="forecast-missed">
            {f.missed.map((m) => (
              <li key={`${m.itemId}${m.due}`} className="flex justify-between gap-2 py-2">
                <span>
                  <bdi>{m.label}</bdi> · <DateText date={m.due} format="dayMonth" />
                </span>
                <Money minor={m.amountMinor} tone />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {f && f.overdue.length > 0 && (
        <Card>
          <CardTitle>{t('forecast.overdue')}</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {f.overdue.map((m) => (
              <li key={m.plannedId} className="flex justify-between gap-2 py-2">
                <span>
                  <bdi>{m.label}</bdi> · <DateText date={m.date} format="dayMonth" />
                </span>
                <Money minor={m.amountMinor} tone />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <RecurringReadOnly />
      <PlannedList />
    </div>
  );
}
