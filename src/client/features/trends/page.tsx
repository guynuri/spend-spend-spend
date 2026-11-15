import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Tabs from '@radix-ui/react-tabs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../../api';
import { Card, CardTitle, cx, EmptyState, ErrorState, IconButton, PageHeader, ProgressBar, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText, useFormatDate } from '../../components/DateText';
import { CategorySelect } from '../../components/CategorySelect';
import { C, ChartBox, tooltipStyle, useCompactMoney, useMoneyFmt } from '../../components/charts';
import { useCategoryMap } from '../../lib/queries';
import { useMe } from '../../lib/session';
import { addMonths, monthEnd, monthStart } from '../../../shared/dates';
import { formatPercent, type Locale } from '../../../shared/money';

function MonthNav({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <IconButton label={t('ledger.prevMonth')} onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
      </IconButton>
      <span className="font-semibold">
        <DateText date={month} format="month" />
      </span>
      <IconButton label={t('ledger.nextMonth')} onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
      </IconButton>
    </div>
  );
}

function ByCategory({ month }: { month: string }) {
  const { t, i18n } = useTranslation();
  const cats = useCategoryMap();
  const q = useQuery({ queryKey: ['trends', 'categories', month], queryFn: () => get<{ month: string; totalMinor: number; items: { categoryId: string | null; spentMinor: number; share: number }[] }>(`/api/trends/categories?month=${month}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.items.length) return <EmptyState title={t('trends.empty')} />;
  return (
    <Card>
      <CardTitle>
        {t('trends.total')}: <Money minor={q.data.totalMinor} decimals={0} />
      </CardTitle>
      <ul className="flex flex-col gap-2" data-testid="trend-categories">
        {q.data.items.map((i) => (
          <li key={i.categoryId ?? 'none'}>
            <Link
              to={`/transactions?from=${monthStart(month)}&to=${monthEnd(month)}${i.categoryId ? `&category=${i.categoryId}` : '&uncategorized=1'}`}
              className="block min-h-11 rounded-lg active:bg-surface-2"
              data-testid="trend-category"
            >
              <div className="flex justify-between gap-2 text-sm">
                <bdi className="truncate">{i.categoryId ? cats.get(i.categoryId)?.name : t('trends.uncategorized')}</bdi>
                <span className="shrink-0 text-muted">
                  <Money minor={i.spentMinor} decimals={0} /> · {formatPercent(i.share, i18n.language as Locale)}
                </span>
              </div>
              <ProgressBar value={i.share} label={t('trends.share')} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ByDay({ month }: { month: string }) {
  const { t, i18n } = useTranslation();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const q = useQuery({ queryKey: ['trends', 'daily', month], queryFn: () => get<{ days: { day: number; spentMinor: number; cumulativeMinor: number | null; prevCumulativeMinor: number }[] }>(`/api/trends/daily?month=${month}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Card>
      <CardTitle>{t('trends.daily')}</CardTitle>
      <ChartBox label={t('trends.daily')} height={260}>
        <ResponsiveContainer>
          <ComposedChart data={q.data.days} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="day" tick={{ fill: C.text }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
            <Legend wrapperStyle={{ direction: i18n.dir() }} />
            <Bar dataKey="spentMinor" name={t('trends.daily')} fill={C.muted} radius={[3, 3, 0, 0]} />
            <Line dataKey="cumulativeMinor" name={t('trends.cumulative')} stroke={C.accent} strokeWidth={2} dot={false} connectNulls={false} />
            <Line dataKey="prevCumulativeMinor" name={t('trends.prevCumulative')} stroke={C.text} strokeDasharray="4 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartBox>
    </Card>
  );
}

function OverMonths() {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const [cat, setCat] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['trends', 'monthly', cat],
    queryFn: () => get<{ points: { month: string; incomeMinor?: number; expensesMinor?: number; netMinor?: number; spentMinor?: number }[] }>(`/api/trends/monthly?months=12${cat ? `&category=${cat}` : ''}`),
  });
  const data = (q.data?.points ?? []).map((p) => ({ ...p, label: fmt(p.month, 'monthShortYear') }));
  return (
    <Card>
      <div className="mb-3">
        <CategorySelect value={cat} onChange={setCat} emptyLabel={t('trends.allCategories')} aria-label={t('trends.category')} data-testid="trend-category-select" />
      </div>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ChartBox label={t('trends.overMonths')} height={280}>
          <ResponsiveContainer>
            {cat ? (
              <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} interval={1} />
                <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
                <Bar dataKey="spentMinor" name={t('budget.spent')} fill={C.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} interval={1} />
                <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
                <Legend wrapperStyle={{ direction: i18n.dir() }} />
                <Bar dataKey="incomeMinor" name={t('trends.income')} fill={C.good} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expensesMinor" name={t('trends.expenses')} fill={C.muted} radius={[4, 4, 0, 0]} />
                <Line dataKey="netMinor" name={t('trends.net')} stroke={C.accent} strokeWidth={2} />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </ChartBox>
      )}
    </Card>
  );
}

export function Component() {
  const { t } = useTranslation();
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') ?? (me?.active?.today ?? '').slice(0, 7);
  const tab = sp.get('tab') ?? 'category';
  const setP = (p: Record<string, string>) => setSp({ month, tab, ...p }, { replace: true });
  const trig = (_v: string) => cx('min-h-11 flex-1 rounded-lg px-3 text-sm font-medium data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm', 'text-muted');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('trends.title')} />
      <Tabs.Root value={tab} onValueChange={(v) => setP({ tab: v })} className="flex flex-col gap-4">
        <Tabs.List className="flex rounded-xl border border-border bg-surface-2 p-1" aria-label={t('trends.title')}>
          <Tabs.Trigger value="category" className={trig('category')} data-testid="tab-trend-category">
            {t('trends.byCategory')}
          </Tabs.Trigger>
          <Tabs.Trigger value="day" className={trig('day')} data-testid="tab-trend-day">
            {t('trends.byDay')}
          </Tabs.Trigger>
          <Tabs.Trigger value="months" className={trig('months')} data-testid="tab-trend-months">
            {t('trends.overMonths')}
          </Tabs.Trigger>
        </Tabs.List>
        {tab !== 'months' && <MonthNav month={month} onChange={(m) => setP({ month: m })} />}
        <Tabs.Content value="category">
          <ByCategory month={month} />
        </Tabs.Content>
        <Tabs.Content value="day">
          <ByDay month={month} />
        </Tabs.Content>
        <Tabs.Content value="months">
          <OverMonths />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
