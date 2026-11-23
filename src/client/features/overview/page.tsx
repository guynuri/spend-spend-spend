import { useContext, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Compass, FlaskConical, Upload } from 'lucide-react';
import { get, post } from '../../api';
import { Badge, Button, Card, CardTitle, ErrorState, PageHeader, ProgressBar, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT } from '../../lib/queries';
import { TourCtx } from '../../lib/tour';
import { useCal, useIsOwner, useMe } from '../../lib/session';
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
import { RecapCard } from './RecapCard';
import { WhoPaid } from './WhoPaid';
import { UsualMonthCard } from './UsualMonthCard';
import { Hero } from './Hero';
import { Donut } from '../../components/Donut';
import { useCategoryMap } from '../../lib/queries';
import { colorSlotOf, OTHER_SLOT } from '../../../shared/categoryLook';
import { GENERAL_ID } from '../../../shared/domain/budget';
import { PeriodLabel } from '../../components/PeriodLabel';
import type { UsualMonth } from '../../../shared/domain/usual';

interface Dashboard {
  month: string;
  period: { start: string; end: string; startDay: number };
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
  usual: UsualMonth | null;
}

function Onboarding() {
  const { t } = useTranslation();
  const owner = useIsOwner();
  const tour = useContext(TourCtx);
  const load = useApiMutation(() => post('/api/household/sample-data'), { invalidate: [...LEDGER_DEPENDENT, ['categories'], ['planned']] });
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
        {owner && (
          <Button variant="secondary" className="flex-1" busy={load.isPending} onClick={() => load.mutate(undefined)} data-testid="onboarding-sample">
            <FlaskConical className="size-5" aria-hidden />
            {t('onboarding.sample')}
          </Button>
        )}
        {tour && (
          <Button variant="secondary" className="flex-1" onClick={tour.startFull} data-testid="onboarding-tour">
            <Compass className="size-5" aria-hidden />
            {t('onboarding.tour')}
          </Button>
        )}
      </div>
      {!owner && <p className="mt-3 text-sm">{t('onboarding.needOwner')}</p>}
      {owner && <p className="mt-2 text-xs text-muted">{t('onboarding.sampleBody')}</p>}
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
        <Link to="/forecast">{t('home.monthEnd')}</Link>
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
        <ForecastChart f={f} height={120} />
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

/** Spending by category this period, as the ring; a row opens that category's transactions. */
function SpendingDonut({ period }: { period: { start: string; end: string } }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const cats = useCategoryMap();
  const q = useQuery({
    queryKey: ['trends', 'categories', period.start, period.end],
    queryFn: () => get<{ items: { categoryId: string | null; spentMinor: number }[] }>(`/api/trends/categories?from=${period.start}&to=${period.end}`),
  });
  if (q.isPending) return <Card><Spinner /></Card>;
  if (q.error) return null;
  const link = (id: string) => `/transactions?from=${period.start}&to=${period.end}${id === 'none' ? '&uncategorized=1' : id === GENERAL_ID ? '' : `&category=${id}`}`;
  const items = q.data.items.map((i) => {
    const c = i.categoryId && i.categoryId !== GENERAL_ID ? cats.get(i.categoryId) : null;
    return {
      id: i.categoryId ?? 'none',
      label: i.categoryId === GENERAL_ID ? t('budget.general.name') : c ? c.name : t('trends.uncategorized'),
      valueMinor: i.spentMinor,
      slot: c ? colorSlotOf(c) : i.categoryId === GENERAL_ID ? 'cat-7' : OTHER_SLOT,
      emoji: c?.emoji ?? (i.categoryId === GENERAL_ID ? '🧺' : null),
    };
  });
  return (
    <Card data-testid="home-donut">
      <CardTitle
        action={
          <Link to="/trends" className="text-sm text-accent">
            {t('dashboard.seeAll')}
          </Link>
        }
      >
        {t('home.whereItGoes')}
      </CardTitle>
      {items.some((i) => i.valueMinor > 0) ? <Donut items={items} label={t('home.whereItGoes')} centerLabel={t('dashboard.expenses')} onOpen={(id) => nav(link(id))} /> : <p className="text-sm text-muted">{t('home.noSpending')}</p>}
    </Card>
  );
}

/** The top items that need attention; the rest one tap away. */
function Attention({ items }: { items: Insight[] }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  return (
    <Card>
      <CardTitle>{t('home.attention')}</CardTitle>
      <InsightList items={all ? items : items.slice(0, 3)} />
      {items.length > 3 && !all && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 min-h-11 text-sm font-medium text-accent" data-testid="insights-more">
          {t('home.showAll', { count: items.length })}
        </button>
      )}
    </Card>
  );
}

function ComingUp({ events }: { events: Dashboard['upcoming'] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardTitle
        action={
          <Link to="/upcoming" className="text-sm text-accent">
            {t('dashboard.seeAll')}
          </Link>
        }
      >
        {t('home.comingUp')}
      </CardTitle>
      {events.length === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noUpcoming')}</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="dash-upcoming">
          {events.slice(0, 3).map((e, i) => (
            <li key={i} className="flex min-h-11 items-center gap-3">
              <span className="flex w-11 shrink-0 flex-col items-center rounded-2xl bg-surface-2 py-1 text-xs leading-tight">
                <DateText date={e.date} format="dayMonth" />
              </span>
              <bdi className="min-w-0 flex-1 truncate text-sm">{e.label}</bdi>
              <Money minor={e.amountMinor} decimals={0} tone className="text-sm font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GoalsMini({ goals }: { goals: Dashboard['goals'] }) {
  const { t, i18n } = useTranslation();
  const pf = useParamFormatter();
  return (
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
      {goals.summary.activeCount === 0 ? (
        <p className="text-sm text-muted">{t('dashboard.noGoals')}</p>
      ) : (
        <>
          <p className="text-sm">
            {t('dashboard.goalsSummary', pf({ savedMinor: goals.summary.totalSavedMinor, targetMinor: goals.summary.totalTargetMinor }))}
            {goals.summary.behindCount > 0 && <span className="text-warn"> · {t('dashboard.goalsBehind', { count: goals.summary.behindCount })}</span>}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {goals.items.map((g) => (
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
  );
}

/**
 * Home is a list of widgets (D-R24). The order below is the default; it is kept as data so a later
 * "customize Home" (pick, drop and reorder widgets) only has to store another list.
 */
type WidgetId = 'hero' | 'donut' | 'who' | 'attention' | 'upcoming' | 'forecast' | 'goals' | 'health' | 'usual';
export const DEFAULT_HOME: WidgetId[] = ['hero', 'donut', 'who', 'attention', 'upcoming', 'forecast', 'goals', 'health', 'usual'];

export function Component() {
  const { t } = useTranslation();
  const pf = useParamFormatter();
  const cal = useCal();
  const me = useMe();
  const first = me?.user.displayName.trim().split(/\s+/)[0] ?? '';
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
  const isCurrent = !d.isLatestData;
  const widgets: Record<WidgetId, () => ReactNode> = {
    hero: () => (
      <Hero
        d={{ month: d.month, today: d.today, isCurrent, period: d.period, budgetedMinor: b.budgetedMinor, spentBudgetedMinor: b.spentBudgetedMinor, expensesMinor: d.pnl.expensesMinor, incomeMinor: d.pnl.incomeMinor, f: d.budget.f, overCount: b.counts.over }}
      />
    ),
    donut: () => <SpendingDonut period={d.period} />,
    who: () => <WhoPaid />,
    attention: () => <Attention items={d.insights} />,
    upcoming: () => <ComingUp events={d.upcoming} />,
    forecast: () => <ForecastSummary f={d.forecast} />,
    goals: () => <GoalsMini goals={d.goals} />,
    health: () => <HealthCard data={d.health} />,
    usual: () => <UsualMonthCard u={d.usual} month={d.month} current={isCurrent} />,
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={first ? t('home.hello', { name: first }) : t('dashboard.title')} subtitle={<PeriodLabel month={d.month} cal={cal} />} />
      <ReviewDueCard />
      <ReminderCards />
      <RecapCard />
      {d.isLatestData && (
        <p className="rounded-2xl bg-warn/10 p-3 text-sm text-warn" data-testid="latest-data-banner">
          {t('dashboard.latestData', pf({ month: d.month }))}
        </p>
      )}
      {d.budget.unsplitCardMinor > 0 && <UnsplitCardBanner month={d.budget.month} />}
      {DEFAULT_HOME.map((id) => (
        <div key={id} data-widget={id}>
          {widgets[id]()}
        </div>
      ))}
    </div>
  );
}
