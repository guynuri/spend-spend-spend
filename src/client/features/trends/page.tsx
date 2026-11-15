import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Tabs from '@radix-ui/react-tabs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../../api';
import { Card, CardTitle, cx, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, ProgressBar, Select, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText, useFormatDate } from '../../components/DateText';
import { CategorySelect } from '../../components/CategorySelect';
import { C, ChartBox, tooltipStyle, useCompactMoney, useMoneyFmt } from '../../components/charts';
import { useCategoryMap } from '../../lib/queries';
import { useMe } from '../../lib/session';
import { dayOf, isValidMonth, monthEnd, monthOf, monthStart } from '../../../shared/dates';
import { parseStored, presetOf, presetRange, PRESETS, shiftRange, type Preset, type Range } from './range';
import { formatPercent, type Locale } from '../../../shared/money';

const LS_KEY = 'mz_trends_range';
const load = () => {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
};
const store = (v: string) => {
  try {
    localStorage.setItem(LS_KEY, v);
  } catch {
    /* storage unavailable */
  }
};

function RangeLabel({ range: { from, to } }: { range: Range }) {
  const fmt = useFormatDate();
  const whole = from === monthStart(monthOf(from)) && to === monthEnd(monthOf(to));
  if (whole && monthOf(from) === monthOf(to)) return <DateText date={from} format="month" />;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (whole) return <>{`${fmt(from, sameYear ? 'monthShort' : 'month')} – ${fmt(to, 'month')}`}</>;
  return <>{`${fmt(from, sameYear ? 'dayMonth' : 'short')} – ${fmt(to, sameYear ? 'long' : 'short')}`}</>;
}

/** One period control for every chart on the page: presets, custom dates, and back/forward. */
function RangeControl({ range, today, onChange }: { range: Range; today: string; onChange: (r: Range) => void }) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(false);
  const sel = custom ? 'custom' : (presetOf(range, today) ?? 'custom');
  const set = (r: Range) => onChange(r.from <= r.to ? r : { from: r.from, to: r.from });
  return (
    <div className="flex flex-col gap-2" data-testid="trend-range">
      <Select
        aria-label={t('trends.range')}
        value={sel}
        data-testid="trend-preset"
        onChange={(e) => {
          const v = e.target.value;
          setCustom(v === 'custom');
          if (v !== 'custom') onChange(presetRange(v as Preset, today));
        }}
      >
        {[...PRESETS, 'custom'].map((p) => (
          <option key={p} value={p}>
            {t(`trends.presets.${p}`)}
          </option>
        ))}
      </Select>
      {sel === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('trends.from')} htmlFor="trend-from">
            <Input id="trend-from" type="date" value={range.from} onChange={(e) => e.target.value && set({ from: e.target.value, to: range.to })} data-testid="trend-from" />
          </Field>
          <Field label={t('trends.to')} htmlFor="trend-to">
            <Input id="trend-to" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && set({ from: range.from, to: e.target.value })} data-testid="trend-to" />
          </Field>
        </div>
      )}
      <div className="flex items-center justify-between">
        <IconButton label={t('trends.prevPeriod')} onClick={() => onChange(shiftRange(range, -1))} data-testid="month-prev">
          <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <span className="text-center font-semibold" data-testid="trend-range-label">
          <RangeLabel range={range} />
        </span>
        <IconButton label={t('trends.nextPeriod')} onClick={() => onChange(shiftRange(range, 1))} data-testid="month-next">
          <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function ByCategory({ range: { from, to } }: { range: Range }) {
  const { t, i18n } = useTranslation();
  const cats = useCategoryMap();
  const q = useQuery({ queryKey: ['trends', 'categories', from, to], queryFn: () => get<{ totalMinor: number; items: { categoryId: string | null; spentMinor: number; share: number }[] }>(`/api/trends/categories?from=${from}&to=${to}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.items.length) return <EmptyState title={t('trends.empty')} />;
  return (
    <Card>
      <CardTitle>
        {t('trends.total')}: <Money minor={q.data.totalMinor} decimals={0} tone="out" />
      </CardTitle>
      <ul className="flex flex-col gap-2" data-testid="trend-categories">
        {q.data.items.map((i) => (
          <li key={i.categoryId ?? 'none'}>
            <Link
              to={`/transactions?from=${from}&to=${to}${i.categoryId ? `&category=${i.categoryId}` : '&uncategorized=1'}`}
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

type DayPoint = { start: string; spentMinor: number; cumulativeMinor: number | null; prevCumulativeMinor: number };

function ByDay({ range: { from, to } }: { range: Range }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const q = useQuery({ queryKey: ['trends', 'daily', from, to], queryFn: () => get<{ granularity: 'day' | 'week' | 'month'; points: DayPoint[] }>(`/api/trends/daily?from=${from}&to=${to}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const g = q.data.granularity;
  if (!q.data.points.some((p) => p.spentMinor || p.prevCumulativeMinor)) return <EmptyState title={t('trends.empty')} />;
  const oneMonth = monthOf(from) === monthOf(to);
  const data = q.data.points.map((p) => ({ ...p, label: g === 'month' ? fmt(p.start, 'monthShortYear') : g === 'day' && oneMonth ? String(dayOf(p.start)) : fmt(p.start, 'dayMonth') }));
  const title = t(g === 'day' ? 'trends.perDay' : g === 'week' ? 'trends.perWeek' : 'trends.perMonth');
  const tip = {
    formatter: (v: unknown) => money(Number(v)),
    labelFormatter: (_: unknown, p: readonly { payload?: DayPoint }[]) => (p[0]?.payload ? fmt(p[0].payload.start, g === 'month' ? 'month' : 'long') : ''),
    ...tooltipStyle(i18n.dir() === 'rtl'),
  };
  const axes = [
    <CartesianGrid key="g" stroke={C.grid} vertical={false} />,
    <XAxis key="x" dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={{ stroke: C.grid }} minTickGap={8} />,
    <YAxis key="y" tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />,
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle>{title}</CardTitle>
        <ChartBox label={title} height={220}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              {axes}
              <Tooltip {...tip} cursor={{ fill: C.grid, opacity: 0.4 }} />
              <Bar dataKey="spentMinor" name={title} fill={C.bad} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </Card>
      <Card>
        <CardTitle>{t('trends.cumulativeTitle')}</CardTitle>
        <ChartBox label={t('trends.cumulativeTitle')} height={240}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              {axes}
              <Tooltip {...tip} />
              <Legend wrapperStyle={{ direction: i18n.dir() }} />
              <Line dataKey="cumulativeMinor" name={t('trends.cumulative')} stroke={C.bad} strokeWidth={2} dot={false} connectNulls={false} />
              <Line dataKey="prevCumulativeMinor" name={t('trends.prevCumulative')} stroke={C.text} strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartBox>
      </Card>
    </div>
  );
}

function OverMonths({ range: { from, to } }: { range: Range }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const [cat, setCat] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['trends', 'monthly', from, to, cat],
    queryFn: () => get<{ points: { month: string; incomeMinor?: number; expensesMinor?: number; netMinor?: number; spentMinor?: number }[] }>(`/api/trends/monthly?from=${from}&to=${to}${cat ? `&category=${cat}` : ''}`),
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
                <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} minTickGap={8} />
                <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
                <Bar dataKey="spentMinor" name={t('budget.spent')} fill={C.bad} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            ) : (
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} minTickGap={8} />
                <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
                <Legend wrapperStyle={{ direction: i18n.dir() }} />
                <Bar dataKey="incomeMinor" name={t('trends.income')} fill={C.good} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <Bar dataKey="expensesMinor" name={t('trends.expenses')} fill={C.bad} radius={[4, 4, 0, 0]} maxBarSize={24} />
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
  const { t, i18n } = useTranslation();
  const me = useMe();
  const today = me?.active?.today ?? new Date().toISOString().slice(0, 10);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'category';
  const month = sp.get('month');
  // URL (from/to, or a legacy ?month=) wins; else this device's last choice; else this month
  const range =
    parseStored(`${sp.get('from')}..${sp.get('to')}`, today) ??
    (month && isValidMonth(month) ? { from: monthStart(month), to: monthEnd(month) } : null) ??
    parseStored(load(), today) ??
    presetRange('month', today);
  const setRange = (r: Range) => {
    setSp({ tab, from: r.from, to: r.to }, { replace: true });
    store(presetOf(r, today) ?? `${r.from}..${r.to}`);
  };
  const trig = (_v: string) => cx('min-h-11 flex-1 rounded-lg px-3 text-sm font-medium data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm', 'text-muted');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('trends.title')} />
      <RangeControl range={range} today={today} onChange={setRange} />
      {/* Radix Tabs default to dir="ltr" (it flipped the tab order and the month arrows in Hebrew) */}
      <Tabs.Root dir={i18n.dir()} value={tab} onValueChange={(v) => setSp({ tab: v, from: range.from, to: range.to }, { replace: true })} className="flex flex-col gap-4">
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
        <Tabs.Content value="category">
          <ByCategory range={range} />
        </Tabs.Content>
        <Tabs.Content value="day">
          <ByDay range={range} />
        </Tabs.Content>
        <Tabs.Content value="months">
          <OverMonths range={range} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
