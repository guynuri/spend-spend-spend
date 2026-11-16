import { useContext } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Compass, Upload } from 'lucide-react';
import { get } from '../../api';
import { Badge, Button, Card, CardTitle, ErrorState, PageHeader, ProgressBar, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { TourCtx } from '../../lib/tour';
import { useIsOwner } from '../../lib/session';
import { useParamFormatter } from '../../lib/format';
import { formatPercent, type Locale } from '../../../shared/money';
import type { ForecastView } from '../../../shared/domain/forecast';
import type { BudgetView } from '../../../shared/domain/budget';
import type { GoalView, GoalsSummary } from '../../../shared/domain/goals';
import type { Insight } from '../../../shared/domain/insights';
import { ForecastChart, ForecastExplain } from '../forecast/ForecastCard';
import { HealthCard, type HealthData } from '../health/HealthCard';
import { InsightList } from './Insights';
import { UnsplitCardBanner } from '../ledger/UnsplitCardBanner';
import { ReviewDueCard } from '../review/DueCard';
import { ReminderCards } from './ReminderCards';

interface Dashboard {
  month: string;
  isLatestData: boolean;
  today: string;
  onboarding: boolean;
  pnl: { incomeMinor: number; expensesMinor: number; netMinor: number; expectedIncomeMinor: number | null; expectedExpensesMinor: number | null };
  forecast: ForecastView;
  budget: { month: string; f: number | null; totals: BudgetView['totals']; over: { categoryId: string; name: string; overMinor: number }[]; unsplitCardMinor: number };
  upcoming: ForecastView['events'];
  goals: { summary: GoalsSummary; items: GoalView[] };
  health: HealthData;
  insights: Insight[];
}

function Onboarding() {
  const { t } = useTranslation();
  const owner = useIsOwner();
  const tour = useContext(TourCtx);
  return (
    <Card data-testid="onboarding">
      <CardTitle>{t('onboarding.title')}</CardTitle>
      <p className="mb-4 text-sm text-muted">{t('onboarding.body')}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {owner && (
          <Link to="/import" className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-accent-fg" data-testid="onboarding-upload">
            <Upload className="size-5" aria-hidden />
            {t('onboarding.upload')}
          </Link>
        )}
        {tour && (
          <Button variant="secondary" className="flex-1" onClick={tour.startFull} data-testid="onboarding-tour">
            <Compass className="size-5" aria-hidden />
            {t('onboarding.tour')}
          </Button>
        )}
      </div>
      {!owner && <p className="mt-3 text-sm">{t('onboarding.needOwner')}</p>}
    </Card>
  );
}

function ForecastSummary({ f }: { f: ForecastView }) {
  const { t } = useTranslation();
  if (!f.hasForecastAccount)
    return (
      <Card data-testid="forecast-card">
        <CardTitle>{t('forecast.title')}</CardTitle>
        <p className="text-sm text-muted">{t('forecast.noAccount')}</p>
      </Card>
    );
  return (
    <Card data-testid="forecast-card">
      <CardTitle action={<Badge tone={f.confidence === 'high' ? 'good' : f.confidence === 'medium' ? 'warn' : 'bad'}>{t(`forecast.confidence.${f.confidence}`)}</Badge>}>
        <Link to="/forecast">{t('forecast.eom')}</Link>
      </CardTitle>
      <div data-tour="dash-forecast">
        <Money minor={f.eom?.balance ?? 0} decimals={0} className="text-3xl font-bold" />
        <span className="sr-only" data-testid="forecast-eom" data-minor={f.eom?.balance ?? 0} />
        {f.low && (
          <p className={f.low.balance < 0 ? 'mt-1 text-sm font-medium text-bad' : 'mt-1 text-sm text-muted'}>
            {t('forecast.low')}: <Money minor={f.low.balance} decimals={0} /> · <DateText date={f.low.date} format="dayMonth" />
          </p>
        )}
      </div>
      <div className="mt-2">
        <ForecastChart f={f} height={160} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {t('forecast.asOf')}
          <DateText date={f.asOf} />
        </span>
        <ForecastExplain f={f} />
      </div>
    </Card>
  );
}

export function Component() {
  const { t, i18n } = useTranslation();
  const pf = useParamFormatter();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/api/dashboard') });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (d.onboarding)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('dashboard.title')} />
        <Onboarding />
      </div>
    );
  const b = d.budget.totals;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('dashboard.title')} subtitle={<DateText date={d.month} format="month" />} />
      <ReviewDueCard />
      <ReminderCards />
      {d.isLatestData && (
        <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn" data-testid="latest-data-banner">
          {t('dashboard.latestData', pf({ month: d.month }))}
        </p>
      )}
      <ForecastSummary f={d.forecast} />
      <Card data-testid="pnl-card" data-tour="pnl">
        <CardTitle>{t('dashboard.pnl')}</CardTitle>
        <dl className="grid grid-cols-3 gap-2">
          {(
            [
              ['income', d.pnl.incomeMinor, d.pnl.expectedIncomeMinor],
              ['expenses', d.pnl.expensesMinor, d.pnl.expectedExpensesMinor],
              ['net', d.pnl.netMinor, d.pnl.expectedIncomeMinor !== null && d.pnl.expectedExpensesMinor !== null ? d.pnl.expectedIncomeMinor - d.pnl.expectedExpensesMinor : null],
            ] as const
          ).map(([k, actual, expected]) => (
            <div key={k} data-testid={`pnl-${k}`}>
              <dt className="text-xs text-muted">{t(`dashboard.${k}`)}</dt>
              <dd className="text-lg font-semibold">
                <Money minor={actual} decimals={0} tone={k === 'income' ? 'in' : k === 'expenses' ? 'out' : true} />
              </dd>
              {expected !== null && (
                <dd className="text-xs text-muted">
                  {t('dashboard.expected')}: <Money minor={expected} decimals={0} />
                </dd>
              )}
            </div>
          ))}
        </dl>
      </Card>
      <Card>
        <CardTitle>{t('dashboard.actions')}</CardTitle>
        <InsightList items={d.insights} />
      </Card>
      <Card data-testid="budget-card">
        <CardTitle
          action={
            <Link to="/budget" className="text-sm text-accent">
              {t('dashboard.seeAll')}
            </Link>
          }
        >
          {t('dashboard.budget')}
        </CardTitle>
        <div className="flex justify-between text-sm">
          <span>
            <Money minor={b.spentBudgetedMinor} decimals={0} /> / <Money minor={b.budgetedMinor} decimals={0} />
          </span>
          {b.pctSpent !== null && <span className="text-muted">{formatPercent(b.pctSpent, i18n.language as Locale)}</span>}
        </div>
        <ProgressBar value={b.pctSpent ?? 0} marker={d.budget.f ?? undefined} tone={b.counts.over > 0 ? 'warn' : 'accent'} label={t('dashboard.budget')} />
        <p className="mt-1 text-xs text-muted" data-testid="dash-budget-counts">
          {t('budget.counts', { over: b.counts.over, watch: b.counts.watch, onPace: b.counts.on_pace })}
        </p>
        <div className="mt-2">
          <UnsplitCardBanner month={d.budget.month} />
        </div>
      </Card>
      <Card>
        <CardTitle
          action={
            <Link to="/upcoming" className="text-sm text-accent">
              {t('dashboard.seeAll')}
            </Link>
          }
        >
          {t('dashboard.upcoming')}
        </CardTitle>
        {d.upcoming.length === 0 ? (
          <p className="text-sm text-muted">{t('dashboard.noUpcoming')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm" data-testid="dash-upcoming">
            {d.upcoming.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">
                  <DateText date={e.date} format="dayMonth" className="text-muted" /> · <bdi>{e.label}</bdi>
                </span>
                <Money minor={e.amountMinor} decimals={0} tone />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card data-testid="dash-goals">
        <CardTitle
          action={
            <Link to="/goals" className="text-sm text-accent">
              {t('dashboard.seeAll')}
            </Link>
          }
        >
          {t('dashboard.goals')}
        </CardTitle>
        {d.goals.summary.activeCount === 0 ? (
          <p className="text-sm text-muted">{t('dashboard.noGoals')}</p>
        ) : (
          <>
            <p className="text-sm">
              {t('dashboard.goalsSummary', pf({ savedMinor: d.goals.summary.totalSavedMinor, targetMinor: d.goals.summary.totalTargetMinor }))}
              {d.goals.summary.behindCount > 0 && <span className="text-warn"> · {t('dashboard.goalsBehind', { count: d.goals.summary.behindCount })}</span>}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {d.goals.items.map((g) => (
                <li key={g.id}>
                  <div className="flex justify-between text-sm">
                    <bdi>{g.name}</bdi>
                    <span className="text-muted">{formatPercent(g.progress, i18n.language as Locale)}</span>
                  </div>
                  <ProgressBar value={g.progress} tone={g.status === 'behind' ? 'warn' : 'accent'} label={g.name} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <HealthCard data={d.health} />
    </div>
  );
}
