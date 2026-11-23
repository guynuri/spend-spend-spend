import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as Tabs from '@radix-ui/react-tabs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../../api';
import { Badge, Card, CardTitle, cx, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, ProgressBar, Select, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { useFormatDate } from '../../components/DateText';
import { CategorySelect } from '../../components/CategorySelect';
import { C, ChartBox, tooltipStyle, useCompactMoney, useMoneyFmt } from '../../components/charts';
import { useCategoryMap } from '../../lib/queries';
import { CategoryIcon } from '../../components/CategoryIcon';
import { Donut } from '../../components/Donut';
import { donutItems } from '../../components/donutItems';
import type { Category } from '../../../shared/schemas/ledger';
import { useMe, useStatsCal } from '../../lib/session';
import { addDays, dayOf, isValidDate, isValidMonth, MAX_RANGE_DAYS } from '../../../shared/dates';
import { PeriodLabel } from '../../components/PeriodLabel';
import { clampRange, parseStored, presetOf, presetRange, PRESETS, shiftRange, validRange, type Preset, type Range } from './range';
import { formatPercent, type Locale } from '../../../shared/money';
import { GENERAL_ID } from '../../../shared/domain/budget';

type Part = { categoryId: string; spentMinor: number; share: number };
type CatItem = { categoryId: string | null; spentMinor: number; share: number; occasional?: boolean; members?: (Part & { subs?: Part[] })[]; subs?: Part[] };

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
  const S = useStatsCal();
  const [fm, tm] = [S.of(from), S.of(to)];
  const whole = from === S.start(fm) && to === S.end(tm);
  if (whole && fm === tm) return <PeriodLabel month={fm} cal={S} />;
  const sameYear = fm.slice(0, 4) === tm.slice(0, 4);
  if (whole) return <>{`${fmt(`${fm}-01`, sameYear ? 'monthShort' : 'month')} – ${fmt(`${tm}-01`, 'month')}`}</>;
  return <>{`${fmt(from, sameYear ? 'dayMonth' : 'short')} – ${fmt(to, sameYear ? 'long' : 'short')}`}</>;
}

/** One period control for every chart on the page: presets, custom dates, and back/forward. */
function RangeControl({ range, today, onChange }: { range: Range; today: string; onChange: (r: Range) => void }) {
  const { t } = useTranslation();
  const S = useStatsCal();
  const [custom, setCustom] = useState(false);
  const sel = custom ? 'custom' : (presetOf(range, today, S) ?? 'custom');
  const max = MAX_RANGE_DAYS - 1;
  return (
    <div className="flex flex-col gap-2" data-testid="trend-range" data-tour="trend-range">
      <Select
        aria-label={t('trends.range')}
        value={sel}
        data-testid="trend-preset"
        onChange={(e) => {
          const v = e.target.value;
          setCustom(v === 'custom');
          if (v !== 'custom') onChange(presetRange(v as Preset, today, S));
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
            <Input id="trend-from" type="date" value={range.from} min={addDays(range.to, -max)} max={range.to} onChange={(e) => isValidDate(e.target.value) && onChange(clampRange({ from: e.target.value, to: range.to }, 'from'))} data-testid="trend-from" />
          </Field>
          <Field label={t('trends.to')} htmlFor="trend-to">
            <Input id="trend-to" type="date" value={range.to} min={range.from} max={addDays(range.from, max)} onChange={(e) => isValidDate(e.target.value) && onChange(clampRange({ from: range.from, to: e.target.value }, 'to'))} data-testid="trend-to" />
          </Field>
        </div>
      )}
      <div className="flex items-center justify-between">
        <IconButton label={t('trends.prevPeriod')} onClick={() => onChange(shiftRange(range, -1, S))} data-testid="month-prev">
          <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <span className="text-center font-semibold" data-testid="trend-range-label">
          <RangeLabel range={range} />
        </span>
        <IconButton label={t('trends.nextPeriod')} onClick={() => onChange(shiftRange(range, 1, S))} data-testid="month-next">
          <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

function CatRow({ name, cat, spentMinor, share, to, badge, small }: { name: string; cat?: Category | null; spentMinor: number; share: number; to?: string; badge?: string; small?: boolean }) {
  const { t, i18n } = useTranslation();
  const body = (
    <div className="flex items-center gap-3">
      <CategoryIcon cat={cat ?? null} size={small ? 'sm' : 'md'} />
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2 text-sm">
          <span className="flex min-w-0 items-center gap-1">
            <bdi className="truncate font-medium">{name}</bdi>
            {badge && <Badge tone="accent">{badge}</Badge>}
          </span>
          <span className="shrink-0 text-muted">
            <Money minor={spentMinor} decimals={0} /> · {formatPercent(share, i18n.language as Locale)}
          </span>
        </div>
        <ProgressBar value={share} label={t('trends.share')} />
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block min-h-11 rounded-2xl py-1 active:bg-surface-2" data-testid="trend-category">
      {body}
    </Link>
  ) : (
    <div className="min-h-11 py-1">{body}</div>
  );
}

/** A parent's subcategories under its row (its own lines listed as the parent). */
function SubRows({ subs, parentId, link }: { subs: Part[]; parentId: string; link: (cid: string) => string }) {
  const { t } = useTranslation();
  const cats = useCategoryMap();
  return (
    <ul className="ms-6 mt-1 flex flex-col gap-1 border-s border-border ps-3" data-testid="trend-subs">
      {subs.map((s) => (
        <li key={s.categoryId}>
          <CatRow small name={s.categoryId === parentId ? t('trends.directly', { name: cats.get(parentId)?.name ?? '' }) : (cats.get(s.categoryId)?.name ?? '')} cat={cats.get(s.categoryId)} spentMinor={s.spentMinor} share={s.share} to={link(s.categoryId)} />
        </li>
      ))}
    </ul>
  );
}

function ByCategory({ range: { from, to } }: { range: Range }) {
  const { t } = useTranslation();
  const cats = useCategoryMap();
  const nav = useNavigate();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const q = useQuery({ queryKey: ['trends', 'categories', from, to], queryFn: () => get<{ totalMinor: number; items: CatItem[] }>(`/api/trends/categories?from=${from}&to=${to}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.items.length) return <EmptyState title={t('trends.empty')} />;
  const link = (cid: string | null) => `/transactions?from=${from}&to=${to}${cid ? `&category=${cid}` : '&uncategorized=1'}`;
  const nameOf = (i: CatItem) => (i.categoryId === GENERAL_ID ? t('budget.general.name') : i.categoryId ? (cats.get(i.categoryId)?.name ?? '') : t('trends.uncategorized'));
  const donut = donutItems(q.data.items, cats, t);

  const expandBtn = (k: string, count: number) => (
    <button type="button" className="mt-0.5 ms-12 text-xs font-medium text-accent" aria-expanded={open.has(k)} onClick={() => toggle(k)} data-testid="trend-expand">
      {t(open.has(k) ? 'trends.hide' : 'trends.showCount', { count })}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="trend-donut-card">
        <CardTitle>{t('trends.whereItWent')}</CardTitle>
        <Donut items={donut} label={t('trends.whereItWent')} centerLabel={t('trends.total')} onOpen={(id) => (id === GENERAL_ID ? toggle(GENERAL_ID) : nav(link(id === 'none' ? null : id)))} testId="trend-donut" />
      </Card>
      <Card>
        <CardTitle>
          {t('trends.total')}: <Money minor={q.data.totalMinor} decimals={0} tone="out" />
        </CardTitle>
        <ul className="flex flex-col gap-1" data-testid="trend-categories">
          {q.data.items.map((i) =>
            i.categoryId === GENERAL_ID ? (
              <li key={GENERAL_ID} data-testid="trend-general">
                {/* general expenses: one row; tap to see the categories inside */}
                <button type="button" className="block w-full text-start" aria-expanded={open.has(GENERAL_ID)} onClick={() => toggle(GENERAL_ID)}>
                  <CatRow name={t('budget.general.name')} cat={{ id: GENERAL_ID, color: 'cat-7', emoji: '🧺' } as Category} spentMinor={i.spentMinor} share={i.share} badge={t(open.has(GENERAL_ID) ? 'trends.hide' : 'trends.showCount', { count: i.members?.length ?? 0 })} />
                </button>
                {open.has(GENERAL_ID) && (
                  <ul className="ms-6 mt-1 flex flex-col gap-1 border-s border-border ps-3">
                    {(i.members ?? []).map((m) => (
                      <li key={m.categoryId}>
                        <CatRow small name={cats.get(m.categoryId)?.name ?? ''} cat={cats.get(m.categoryId)} spentMinor={m.spentMinor} share={m.share} to={link(m.categoryId)} />
                        {m.subs && expandBtn(m.categoryId, m.subs.length)}
                        {m.subs && open.has(m.categoryId) && <SubRows subs={m.subs} parentId={m.categoryId} link={link} />}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={i.categoryId ?? 'none'}>
                <CatRow name={nameOf(i)} cat={i.categoryId ? cats.get(i.categoryId) : null} spentMinor={i.spentMinor} share={i.share} to={link(i.categoryId)} badge={i.occasional ? t('categories.mode.occasionalShort') : undefined} />
                {i.subs && i.categoryId && expandBtn(i.categoryId, i.subs.length)}
                {i.subs && i.categoryId && open.has(i.categoryId) && <SubRows subs={i.subs} parentId={i.categoryId} link={link} />}
              </li>
            ),
          )}
        </ul>
        {q.data.items.some((i) => i.occasional) && <p className="mt-3 text-xs text-muted">{t('trends.occasionalNote')}</p>}
      </Card>
    </div>
  );
}

/** Occasional categories by quarter, this year vs last year: lumpy spending reads better over quarters and years. */
function OccasionalByQuarter({ initialYear }: { initialYear: string }) {
  const { t, i18n } = useTranslation();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const [year, setYear] = useState(initialYear);
  type Resp = { year: string; prevYear: string; items: { categoryId: string; name: string; quarters: number[]; yearMinor: number; prevYearMinor: number }[]; quarters: { quarter: number; spentMinor: number; prevSpentMinor: number }[]; yearMinor: number; prevYearMinor: number };
  const q = useQuery({ queryKey: ['trends', 'occasional', year], queryFn: () => get<Resp>(`/api/trends/occasional?year=${year}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d.items.length) return null;
  const data = d.quarters.map((x) => ({ ...x, label: t('trends.quarter', { n: x.quarter }) }));
  return (
    <Card data-testid="trend-occasional">
      <CardTitle>{t('trends.occasionalTitle')}</CardTitle>
      <div className="flex items-center justify-between">
        <IconButton label={t('trends.prevPeriod')} onClick={() => setYear(String(Number(year) - 1))} data-testid="occ-prev">
          <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <span className="font-semibold">{year}</span>
        <IconButton label={t('trends.nextPeriod')} onClick={() => setYear(String(Number(year) + 1))} data-testid="occ-next">
          <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
      </div>
      <p className="mb-2 text-sm">
        <Money minor={d.yearMinor} decimals={0} className="font-semibold" /> <span className="text-muted">{t('trends.occasionalVsPrev', { year: d.prevYear, amount: money(d.prevYearMinor) })}</span>
      </p>
      {(d.yearMinor !== 0 || d.prevYearMinor !== 0) && (
        <ChartBox label={t('trends.occasionalTitle')} height={200}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
              <Legend wrapperStyle={{ direction: i18n.dir() }} />
              <Bar dataKey="prevSpentMinor" name={d.prevYear} fill={C.muted} radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar dataKey="spentMinor" name={d.year} fill={C.warn} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      )}
      <ul className="mt-2 divide-y divide-border text-sm" data-testid="trend-occasional-items">
        {d.items.map((i) => (
          <li key={i.categoryId} className="flex min-h-11 items-center justify-between gap-2">
            <Link to={`/transactions?from=${year}-01-01&to=${year}-12-31&category=${i.categoryId}`} className="min-w-0 truncate">
              <bdi>{i.name}</bdi>
            </Link>
            <span className="shrink-0 text-muted">
              <Money minor={i.yearMinor} decimals={0} className="text-text" /> · {d.prevYear}: <Money minor={i.prevYearMinor} decimals={0} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type DayPoint = { start: string; partial: boolean; spentMinor: number; cumulativeMinor: number | null; prevCumulativeMinor: number };

function ByDay({ range: { from, to }, yoy }: { range: Range; yoy: boolean }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const S = useStatsCal();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const q = useQuery({ queryKey: ['trends', 'daily', from, to, yoy], queryFn: () => get<{ granularity: 'day' | 'week' | 'month'; points: DayPoint[] }>(`/api/trends/daily?from=${from}&to=${to}${yoy ? '&compare=yoy' : ''}`) });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const g = q.data.granularity;
  if (!q.data.points.some((p) => p.spentMinor || p.prevCumulativeMinor)) return <EmptyState title={t('trends.empty')} />;
  // day numbers alone only read well inside one calendar month
  const oneMonth = from.slice(0, 7) === to.slice(0, 7);
  const data = q.data.points.map((p) => ({ ...p, label: g === 'month' ? fmt(`${S.of(p.start)}-01`, 'monthShortYear') : g === 'day' && oneMonth ? String(dayOf(p.start)) : fmt(p.start, 'dayMonth') }));
  const title = t(g === 'day' ? 'trends.perDay' : g === 'week' ? 'trends.perWeek' : 'trends.perMonth');
  const tip = {
    formatter: (v: unknown) => money(Number(v)),
    labelFormatter: (_: unknown, p: readonly { payload?: DayPoint }[]) => (p[0]?.payload ? `${fmt(p[0].payload.start, g === 'month' ? 'month' : 'long')}${p[0].payload.partial ? ` ${t('trends.partial')}` : ''}` : ''),
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
              <Bar dataKey="spentMinor" name={title} fill={C.bad} radius={[4, 4, 0, 0]} maxBarSize={24}>
                {data.map((p) => (
                  <Cell key={p.start} fillOpacity={p.partial ? 0.45 : 1} />
                ))}
              </Bar>
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
              <Line dataKey="prevCumulativeMinor" name={t(yoy ? 'trends.prevYearCumulative' : 'trends.prevCumulative')} stroke={C.text} strokeWidth={2} strokeDasharray="4 4" dot={false} />
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
    queryFn: () =>
      get<{ points: { month: string; partial: boolean; incomeMinor?: number; expensesMinor?: number; everydayMinor?: number; occasionalMinor?: number; netMinor?: number; spentMinor?: number }[] }>(
        `/api/trends/monthly?from=${from}&to=${to}${cat ? `&category=${cat}` : ''}`,
      ),
  });
  const hasOccasional = (q.data?.points ?? []).some((p) => p.occasionalMinor);
  const data = (q.data?.points ?? []).map((p) => ({ ...p, label: fmt(p.month, 'monthShortYear') }));
  const partialLabel = (l: unknown, p: readonly { payload?: { partial?: boolean } }[]) => `${String(l)}${p[0]?.payload?.partial ? ` ${t('trends.partial')}` : ''}`;
  return (
    <Card>
      <div className="mb-3">
        <CategorySelect value={cat} onChange={setCat} emptyLabel={t('trends.allCategories')} extra={[{ value: GENERAL_ID, label: t('budget.general.name') }]} aria-label={t('trends.category')} data-testid="trend-category-select" />
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
                <Tooltip formatter={(v) => money(Number(v))} labelFormatter={partialLabel} {...tooltipStyle(i18n.dir() === 'rtl')} />
                <Bar dataKey="spentMinor" name={t('budget.spent')} fill={C.bad} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            ) : (
              <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} minTickGap={8} />
                <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} labelFormatter={partialLabel} {...tooltipStyle(i18n.dir() === 'rtl')} />
                <Legend wrapperStyle={{ direction: i18n.dir() }} />
                <Bar dataKey="incomeMinor" name={t('trends.income')} fill={C.good} radius={[4, 4, 0, 0]} maxBarSize={24} />
                {hasOccasional ? (
                  <>
                    {/* everyday spending, with occasional spending (trips, gifts) stacked on top */}
                    <Bar dataKey="everydayMinor" stackId="exp" name={t('trends.everyday')} fill={C.bad} maxBarSize={24} />
                    <Bar dataKey="occasionalMinor" stackId="exp" name={t('trends.occasional')} fill={C.warn} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </>
                ) : (
                  <Bar dataKey="expensesMinor" name={t('trends.expenses')} fill={C.bad} radius={[4, 4, 0, 0]} maxBarSize={24} />
                )}
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
  const S = useStatsCal();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'category';
  const month = sp.get('month');
  // URL (from/to, or a legacy ?month=) wins; else this device's last choice; else this period
  const range =
    parseStored(`${sp.get('from')}..${sp.get('to')}`, today, S) ??
    (month && isValidMonth(month) ? { from: S.start(month), to: S.end(month) } : null) ??
    parseStored(load(), today, S) ??
    presetRange('month', today, S);
  const setRange = (r: Range) => {
    if (!validRange(r)) return;
    setSp({ tab, from: r.from, to: r.to }, { replace: true });
    store(presetOf(r, today, S) ?? `${r.from}..${r.to}`);
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
          {/* "This year" compares with the same months last year; everything else with the period before */}
          <ByDay range={range} yoy={presetOf(range, today, S) === 'year'} />
        </Tabs.Content>
        <Tabs.Content value="months" className="flex flex-col gap-4">
          <OverMonths range={range} />
          <OccasionalByQuarter key={range.to.slice(0, 4)} initialYear={range.to.slice(0, 4)} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
