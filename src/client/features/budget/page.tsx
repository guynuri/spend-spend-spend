import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, CheckCircle2, ChevronLeft, ChevronRight, Eye, Pencil, Plus, Sparkles } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { put } from '../../api';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, Field, IconButton, PageHeader, ProgressBar, Segmented, Select, Spinner, type Tone } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText, useFormatDate } from '../../components/DateText';
import { AmountInput } from '../../components/AmountInput';
import { ExplainSheet } from '../../components/ExplainSheet';
import { Sheet } from '../../components/Sheet';
import { C, ChartBox, tooltipStyle, useCompactMoney, useMoneyFmt } from '../../components/charts';
import { useApiMutation } from '../../lib/mutate';
import { useCal, useCanWrite } from '../../lib/session';
import { formatPercent, minorToInput, parseMoneyInput, type Locale } from '../../../shared/money';
import { addMonths } from '../../../shared/dates';
import { PeriodLabel } from '../../components/PeriodLabel';
import { GENERAL_ID, type BudgetLine, type BudgetStatus, type OccasionalLine } from '../../../shared/domain/budget';
import { UnsplitCardBanner } from '../ledger/UnsplitCardBanner';
import { useBudget, type BudgetResponse } from './useBudget';
import { CategoryIcon } from '../../components/CategoryIcon';
import { SuggestButton, SuggestSheet } from './Suggest';
import { useCategoryMap } from '../../lib/queries';

/** Unicode isolate so amounts never reorder inside RTL sentences. */
const iso = (s: string) => `⁨${s}⁩`;
const TONE: Record<BudgetStatus, Tone> = { over: 'bad', watch: 'warn', on_pace: 'good' };
const ICON = { over: AlertOctagon, watch: Eye, on_pace: CheckCircle2 };
const RANK: Record<BudgetStatus, number> = { over: 0, watch: 1, on_pace: 2 };
/** Most relevant first: over budget, then to watch, then by how much of the limit is used. */
const byRelevance = (a: BudgetLine, b: BudgetLine) => (a.status ? RANK[a.status] : 3) - (b.status ? RANK[b.status] : 3) || (b.utilization ?? 0) - (a.utilization ?? 0);

function StatusBadge({ status }: { status: BudgetStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;
  const I = ICON[status];
  return (
    <Badge tone={TONE[status]}>
      <I className="size-3" aria-hidden />
      {t(`budget.status.${status}`)}
    </Badge>
  );
}

type Mode = 'every' | 'once';

/** Add / edit / remove a category budget: every month (carries forward) or this month only. */
function BudgetForm({ line, lines, month, onDone }: { line: BudgetLine | null; lines: BudgetLine[]; month: string; onDone: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormatDate();
  const [categoryId, setCategoryId] = useState(line?.categoryId ?? '');
  const [value, setValue] = useState(line?.limitMinor == null ? '' : minorToInput(line.limitMinor).replace(/\.00$/, ''));
  const [mode, setMode] = useState<Mode>(line?.oneTime ? 'once' : 'every');
  const save = useApiMutation((item: { limitMinor: number | null; oneTime: boolean }) => put('/api/budgets', { month, items: [categoryId === GENERAL_ID ? { general: true, ...item } : { categoryId, ...item }] }), {
    invalidate: [['budget'], ['me'], ['dashboard'], ['health']],
    onSuccess: onDone,
  });
  const minor = value.trim() === '' ? null : parseMoneyInput(value);
  const monthName = fmt(month, 'month');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (categoryId && minor !== null && minor >= 0) save.mutate({ limitMinor: minor, oneTime: mode === 'once' });
      }}
    >
      <Field label={t('budget.category')} htmlFor="bg-cat">
        <Select id="bg-cat" value={categoryId} disabled={!!line} onChange={(e) => setCategoryId(e.target.value)} data-testid="budget-category">
          <option value="" disabled>
            {t('budget.pickCategory')}
          </option>
          {lines.map((l) => (
            <option key={l.categoryId} value={l.categoryId}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('budget.amount')} htmlFor="bg-amt">
        <AmountInput id="bg-amt" autoFocus={!!line} value={value} onChange={(e) => setValue(e.target.value)} data-testid="limit-input" placeholder="0" />
      </Field>
      <Segmented<Mode>
        label={t('budget.when')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'every', label: t('budget.every') },
          { value: 'once', label: <span data-testid="budget-once">{t('budget.once', { month: monthName })}</span> },
        ]}
      />
      <p className="text-xs text-muted">{mode === 'once' ? t('budget.onceHint', { month: monthName }) : t('budget.appliesFrom', { month: monthName })}</p>
      <div className="flex flex-wrap justify-between gap-2">
        {line?.limitMinor != null ? (
          <Button variant="ghost" className="text-bad" busy={save.isPending} onClick={() => save.mutate({ limitMinor: null, oneTime: line.oneTime })} data-testid="limit-remove">
            {t(line.oneTime ? 'budget.removeOneTime' : 'budget.removeLimit')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" busy={save.isPending} disabled={!categoryId || minor === null || minor < 0} data-testid="limit-save">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function LineRow({ line, onOpen, onEdit }: { line: BudgetLine; onOpen: () => void; onEdit: () => void }) {
  const { t } = useTranslation();
  const cats = useCategoryMap();
  const canWrite = useCanWrite();
  const tone: Tone = line.status ? TONE[line.status] : 'accent';
  const limit = line.limitMinor === null ? <span className="text-xs text-muted">{t('budget.noLimit')}</span> : <Money minor={line.limitMinor} decimals={0} className="text-sm" />;
  return (
    <li className="py-3" data-testid="budget-line" data-status={line.status ?? 'none'} data-category={line.categoryId} data-one-time={line.oneTime}>
      <div className="flex items-center justify-between gap-2">
        <CategoryIcon cat={line.categoryId === GENERAL_ID ? { id: GENERAL_ID, color: 'cat-7', emoji: '🧺' } : cats.get(line.categoryId)} />
        <button type="button" onClick={onOpen} className="min-h-11 min-w-0 flex-1 text-start">
          <div className="flex min-w-0 items-center gap-1">
            <bdi className="truncate font-medium">{line.name}</bdi>
            {line.limitMinor !== null && line.oneTime && <Badge tone="accent">{t('budget.oneTime')}</Badge>}
          </div>
          {line.members && line.members.length > 0 && (
            <div className="truncate text-xs text-muted" data-testid="general-members">
              <bdi>{line.members.map((m) => m.name).join(' · ')}</bdi>
            </div>
          )}
          <div className="text-xs text-muted">
            <Money minor={Math.max(0, line.spentMinor)} decimals={0} /> {line.limitMinor !== null && line.remainingMinor !== null && (line.remainingMinor >= 0 ? <>· {t('budget.remaining')} <Money minor={line.remainingMinor} decimals={0} /></> : <span className="text-bad">· {t('budget.over')} <Money minor={-line.remainingMinor} decimals={0} /></span>)}
          </div>
        </button>
        <StatusBadge status={line.status} />
        {canWrite ? (
          <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent" data-testid="limit-edit" onClick={onEdit}>
            {line.limitMinor === null ? (
              t('budget.setBudget')
            ) : (
              <>
                <Money minor={line.limitMinor} decimals={0} />
                <Pencil className="size-3.5" aria-label={t('budget.edit')} />
              </>
            )}
          </button>
        ) : (
          limit
        )}
      </div>
      {line.limitMinor !== null && <ProgressBar value={line.utilization ?? 0} tone={tone} label={line.name} />}
      <div className="mt-1 text-xs text-muted">
        {t('budget.avg3')}: <Money minor={line.avg3Minor} decimals={0} />
      </div>
    </li>
  );
}

/** A card with the top 3 rows; "see all (N)" opens the full list in a sheet (URL ?list=, so Back closes it). */
function TopList<T>({ id, title, items, render, ulClass = 'divide-y divide-border' }: { id: string; title: ReactNode; items: T[]; render: (x: T) => ReactNode; ulClass?: string }) {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const close = () => {
    if ((window.history.state as { idx?: number } | null)?.idx) return void navigate(-1);
    const n = new URLSearchParams(sp);
    n.delete('list');
    setSp(n, { replace: true });
  };
  return (
    <Card data-testid={`budget-list-${id}`}>
      <div data-tour="budget-top">
        <CardTitle
          action={
            items.length > 3 && (
              <button
                type="button"
                className="min-h-11 shrink-0 rounded-lg px-2 text-sm font-medium text-accent"
                onClick={() => {
                  const n = new URLSearchParams(sp);
                  n.set('list', id);
                  setSp(n);
                }}
                data-testid="see-all"
              >
                {t('budget.seeAll', { count: items.length })}
              </button>
            )
          }
        >
          {title}
        </CardTitle>
      </div>
      <ul className={ulClass}>{items.slice(0, 3).map(render)}</ul>
      <Sheet open={sp.get('list') === id} onOpenChange={(o) => !o && close()} title={title} testId="budget-list-sheet" wide>
        <ul className={ulClass}>{items.map(render)}</ul>
      </Sheet>
    </Card>
  );
}

function Charts({ data, onOpen }: { data: BudgetResponse; onOpen: (l: BudgetLine) => void }) {
  const cal = useCal();
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const rtl = i18n.dir() === 'rtl';
  const hist = data.history.map((h) => ({ ...h, label: fmt(h.month, 'monthShort') }));
  const dist = data.lines.filter((l) => l.spentMinor > 0).sort((a, b) => b.spentMinor - a.spentMinor);
  const total = dist.reduce((a, l) => a + l.spentMinor, 0) || 1;
  return (
    <>
      <Card>
        <CardTitle>{t('budget.history')}</CardTitle>
        <ChartBox label={t('budget.history')}>
          <ResponsiveContainer>
            <BarChart data={hist} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(rtl)} />
              <Bar dataKey="budgetedMinor" name={t('budget.budgeted')} fill={C.muted} radius={[4, 4, 0, 0]} />
              <Bar dataKey="spentBudgetedMinor" name={t('budget.spent')} fill={C.accent} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBox>
      </Card>
      {dist.length > 0 && (
        <TopList
          id="distribution"
          title={t('budget.distribution')}
          items={dist}
          ulClass="flex flex-col gap-2"
          render={(l) => {
            const inner = (
              <>
                <div className="flex justify-between text-sm">
                  <bdi>{l.name}</bdi>
                  <span className="text-muted">
                    <Money minor={l.spentMinor} decimals={0} /> · {formatPercent(l.spentMinor / total, i18n.language as Locale)}
                  </span>
                </div>
                <ProgressBar value={l.spentMinor / total} label={l.name} />
              </>
            );
            return (
              <li key={l.categoryId}>
                {l.members ? (
                  <button type="button" className="block min-h-11 w-full text-start" onClick={() => onOpen(l)}>
                    {inner}
                  </button>
                ) : (
                  <Link to={`/transactions?from=${cal.start(data.month)}&to=${cal.end(data.month)}&category=${l.categoryId}`} className="block min-h-11">
                    {inner}
                  </Link>
                )}
              </li>
            );
          }}
        />
      )}
    </>
  );
}

/** What the category sheet shows: a monthly line, the general pool (with its categories), or an occasional category. */
type SheetLine = Pick<BudgetLine, 'categoryId' | 'name' | 'members'> & { limitMinor?: number | null; oneTime?: boolean; occasional?: boolean };

function CategorySheet({ line, data, onClose }: { line: SheetLine | null; data: BudgetResponse; onClose: () => void }) {
  const cal = useCal();
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const series = line ? (data.categoryHistory[line.categoryId] ?? []).map((p) => ({ ...p, label: fmt(p.month, 'monthShort') })) : [];
  return (
    <Sheet open={!!line} onOpenChange={(o) => !o && onClose()} title={line?.name ?? ''} testId="budget-category-sheet">
      {line && (
        <div className="flex flex-col gap-3">
          <ChartBox label={line.name} height={200}>
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.text }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={compact} tick={{ fill: C.text }} width={56} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle(i18n.dir() === 'rtl')} />
                <Bar dataKey="spentMinor" name={t('budget.spent')} fill={C.accent} radius={[4, 4, 0, 0]} />
                <Line dataKey="limitMinor" name={t('budget.limit')} stroke={C.bad} strokeDasharray="4 4" dot={false} type="stepAfter" />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBox>
          {line.occasional && <p className="text-xs text-muted">{t('budget.occasional.sheetHint')}</p>}
          {line.limitMinor != null && <p className="text-xs text-muted">{line.oneTime ? t('budget.onceHint', { month: fmt(data.month, 'month') }) : t('budget.appliesFrom', { month: fmt(data.month, 'month') })}</p>}
          {line.members ? (
            <>
              <p className="text-xs text-muted">{t('budget.general.hint')}</p>
              <ul className="divide-y divide-border" data-testid="general-breakdown">
                {line.members.map((m) => (
                  <li key={m.categoryId}>
                    <Link to={`/transactions?from=${cal.start(data.month)}&to=${cal.end(data.month)}&category=${m.categoryId}`} className="flex min-h-11 items-center justify-between gap-2 text-sm">
                      <bdi className="truncate">{m.name}</bdi>
                      <span className="shrink-0 text-muted">
                        <Money minor={m.spentMinor} decimals={0} /> · {t('budget.avg3')} <Money minor={m.avg3Minor} decimals={0} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Link
              to={line.occasional ? `/transactions?from=${cal.start(addMonths(data.month, -11))}&to=${cal.end(data.month)}&category=${line.categoryId}` : `/transactions?from=${cal.start(data.month)}&to=${cal.end(data.month)}&category=${line.categoryId}`}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-surface-2 px-4 font-medium"
            >
              {t('budget.viewTransactions')}
            </Link>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Yearly limit of an occasional category: applies to this year and later years until changed. */
function YearlyForm({ line, year, month, onDone }: { line: OccasionalLine; year: string; month: string; onDone: () => void }) {
  const { t } = useTranslation();
  const money0 = useMoneyFmt(0);
  const [value, setValue] = useState(line.yearLimitMinor == null ? '' : minorToInput(line.yearLimitMinor).replace(/\.00$/, ''));
  const save = useApiMutation((limitMinor: number | null) => put('/api/budgets', { month, items: [{ categoryId: line.categoryId, limitMinor, yearly: true }] }), {
    invalidate: [['budget'], ['me'], ['dashboard'], ['health']],
    onSuccess: onDone,
  });
  const minor = value.trim() === '' ? null : parseMoneyInput(value);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (minor !== null && minor >= 0) save.mutate(minor);
      }}
    >
      <Field label={t('budget.occasional.yearAmount', { year })} htmlFor="yb-amt">
        <AmountInput id="yb-amt" autoFocus value={value} onChange={(e) => setValue(e.target.value)} data-testid="yearly-input" placeholder="0" />
      </Field>
      <p className="text-xs text-muted">{t('budget.occasional.appliesFrom', { year })}</p>
      {line.last12Minor > 0 && <p className="text-xs text-muted">{t('budget.occasional.last12Hint', { amount: iso(money0(line.last12Minor)) })}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        {line.yearLimitMinor != null ? (
          <Button variant="ghost" className="text-bad" busy={save.isPending} onClick={() => save.mutate(null)} data-testid="yearly-remove">
            {t('budget.removeLimit')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" busy={save.isPending} disabled={minor === null || minor < 0} data-testid="yearly-save">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

/** Occasional spending (vacations, gifts): year to date against a yearly budget, never month by month. */
function OccasionalCard({ data, onOpen }: { data: BudgetResponse; onOpen: (l: OccasionalLine) => void }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const [editing, setEditing] = useState<OccasionalLine | null>(null);
  const o = data.occasional;
  if (!o.lines.length) return null;
  return (
    <Card data-testid="budget-occasional">
      <CardTitle>
        {t('budget.occasional.title', { year: o.year })} · <Money minor={o.totals.ytdMinor} decimals={0} className="text-muted" />
        {o.totals.yearBudgetedMinor > 0 && (
          <>
            {' / '}
            <Money minor={o.totals.yearBudgetedMinor} decimals={0} className="text-muted" />
          </>
        )}
      </CardTitle>
      <p className="text-xs text-muted">{t('budget.occasional.hint')}</p>
      <ul className="divide-y divide-border">
        {o.lines.map((l) => (
          <li key={l.categoryId} className="py-3" data-testid="occasional-line" data-status={l.status ?? 'none'}>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => onOpen(l)} className="min-h-11 min-w-0 flex-1 text-start">
                <bdi className="block truncate font-medium">{l.name}</bdi>
                <div className="text-xs text-muted">
                  {t('budget.occasional.ytd', { year: o.year })} <Money minor={Math.max(0, l.ytdMinor)} decimals={0} />
                  {l.remainingMinor !== null &&
                    (l.remainingMinor >= 0 ? (
                      <>
                        {' '}
                        · {t('budget.remaining')} <Money minor={l.remainingMinor} decimals={0} />
                      </>
                    ) : (
                      <span className="text-bad">
                        {' '}
                        · {t('budget.over')} <Money minor={-l.remainingMinor} decimals={0} />
                      </span>
                    ))}
                </div>
              </button>
              <StatusBadge status={l.status} />
              {canWrite ? (
                <button type="button" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent" data-testid="yearly-edit" onClick={() => setEditing(l)}>
                  {l.yearLimitMinor === null ? (
                    t('budget.occasional.setYearly')
                  ) : (
                    <>
                      <Money minor={l.yearLimitMinor} decimals={0} />
                      {t('budget.occasional.perYear')}
                      <Pencil className="size-3.5" aria-label={t('budget.edit')} />
                    </>
                  )}
                </button>
              ) : (
                l.yearLimitMinor !== null && <Money minor={l.yearLimitMinor} decimals={0} className="text-sm" />
              )}
            </div>
            {l.yearLimitMinor !== null && <ProgressBar value={l.utilization ?? 0} tone={l.status ? TONE[l.status] : 'accent'} label={l.name} />}
            <div className="mt-1 text-xs text-muted">
              {t('budget.occasional.thisMonth')} <Money minor={l.monthMinor} decimals={0} /> · {t('budget.occasional.last12')} <Money minor={l.last12Minor} decimals={0} /> ({t('budget.occasional.aboutPerMonth')}{' '}
              <Money minor={Math.round(l.last12Minor / 12)} decimals={0} />)
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={!!editing} onOpenChange={(v) => !v && setEditing(null)} title={editing?.name ?? ''} testId="yearly-sheet">
        {editing && <YearlyForm line={editing} year={o.year} month={data.month} onDone={() => setEditing(null)} />}
      </Sheet>
    </Card>
  );
}

export function Component() {
  const cal = useCal();
  const { t, i18n } = useTranslation();
  const canWrite = useCanWrite();
  const [sp, setSp] = useSearchParams();
  const q = useBudget(sp.get('month'));
  const money0 = useMoneyFmt(0);
  const [open, setOpen] = useState<SheetLine | null>(null);
  const [editing, setEditing] = useState<BudgetLine | 'new' | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const loc = i18n.language as Locale;
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const go = (n: number) => setSp({ month: addMonths(d.month, n) }, { replace: true });
  const budgeted = d.lines.filter((l) => l.limitMinor !== null).sort(byRelevance);
  const unbudgeted = d.lines.filter((l) => l.limitMinor === null).sort((a, b) => b.spentMinor - a.spentMinor);
  const group = (g: 'fixed' | 'variable') => budgeted.filter((l) => (l.grp ?? 'variable') === g);
  const row = (l: BudgetLine) => <LineRow key={l.categoryId} line={l} onOpen={() => setOpen(l)} onEdit={() => setEditing(l)} />;
  const ex = d.totals;
  const addButton = canWrite && (
    <Button onClick={() => setEditing('new')} data-testid="budget-add" data-tour="budget-add">
      <Plus className="size-5" aria-hidden />
      {t('budget.add')}
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('budget.title')} actions={budgeted.length > 0 && canWrite && (<>{addButton}<SuggestButton onClick={() => setSuggesting(true)} /></>)} />
      <div className="flex items-center justify-between">
        <IconButton label={t('ledger.prevMonth')} onClick={() => go(-1)} data-testid="month-prev">
          <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <span className="text-center font-semibold" data-testid="budget-month">
          <PeriodLabel month={d.month} cal={cal} />
        </span>
        <IconButton label={t('ledger.nextMonth')} onClick={() => go(1)} data-testid="month-next">
          <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
      </div>
      <UnsplitCardBanner month={d.month} />
      <Card data-testid="budget-summary">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted">{t('budget.budgeted')}</div>
            <Money minor={ex.budgetedMinor} decimals={0} className="text-xl font-bold" />
          </div>
          <div>
            <div className="text-xs text-muted">{t('budget.spent')}</div>
            <Money minor={ex.spentBudgetedMinor} decimals={0} className="text-xl font-bold" tone="out" />
          </div>
        </div>
        {d.f === null ? (
          <p className="mt-3 text-sm text-muted">{t('budget.noDataYet')}</p>
        ) : (
          <div className="mt-3 flex flex-col gap-1">
            <ProgressBar value={ex.pctSpent ?? 0} tone={ex.pace === 'ahead' ? 'warn' : 'accent'} marker={d.f} label={t('budget.spent')} />
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted">
              <span>{t('budget.pctSpent', { spent: formatPercent(ex.pctSpent ?? 0, loc) })}</span>
              <span>{t('budget.pctMonth', { elapsed: formatPercent(d.f, loc) })}</span>
            </div>
            {ex.pace && <p className="text-sm font-medium" data-testid="budget-pace">{t(`budget.pace.${ex.pace}`)}</p>}
          </div>
        )}
        <p className="mt-2 text-sm text-muted" data-testid="budget-counts">
          {t('budget.counts', { over: ex.counts.over, watch: ex.counts.watch, onPace: ex.counts.on_pace })}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm">
          <span>
            {t('budget.allocation')}:{' '}
            {d.allocation.avgIncomeMinor > 0 ? (
              <span data-testid="allocation">{t('budget.allocationLine', { budgeted: iso(money0(d.allocation.budgetedMinor)), income: iso(money0(d.allocation.avgIncomeMinor)) })}</span>
            ) : (
              <span className="text-muted">{t('budget.allocationNoIncome')}</span>
            )}
          </span>
          <ExplainSheet
            title={t('budget.allocation')}
            formula={t('budget.allocationHelp')}
            testId="explain-allocation"
            rows={[
              { label: t('budget.budgeted'), value: <Money minor={d.allocation.budgetedMinor} /> },
              ...d.allocation.months.map((m) => ({ label: <DateText date={m} format="month" />, value: '' })),
              { label: t('trends.income'), value: <Money minor={d.allocation.avgIncomeMinor} tone="in" /> },
            ]}
          >
            <p className="mt-3 text-xs text-muted">{t('budget.howItWorks')}</p>
            <p className="mt-2 text-xs text-muted">{t('budget.explainTotals')}</p>
            <p className="mt-2 text-xs text-muted">{t('budget.explainStatusBody')}</p>
          </ExplainSheet>
        </div>
      </Card>
      {d.lines.length === 0 && <EmptyState title={t('budget.empty')} />}
      {d.lines.length > 0 && budgeted.length === 0 && (
        <EmptyState
          title={t('budget.noBudgets')}
          body={t('budget.howItWorks')}
          action={
            canWrite && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setSuggesting(true)} data-testid="suggest-open-empty">
                  <Sparkles className="size-4" aria-hidden />
                  {t('budget.suggest.open')}
                </Button>
                {addButton}
              </div>
            )
          }
        />
      )}
      {suggesting && <SuggestSheet open onOpenChange={setSuggesting} />}
      {(['variable', 'fixed'] as const).map(
        (g) =>
          group(g).length > 0 && (
            <TopList
              key={g}
              id={g}
              title={
                <>
                  {t(`budget.${g}`)} · <Money minor={g === 'fixed' ? ex.fixed.spentMinor : ex.variable.spentMinor} decimals={0} className="text-muted" /> / <Money minor={g === 'fixed' ? ex.fixed.budgetedMinor : ex.variable.budgetedMinor} decimals={0} className="text-muted" />
                </>
              }
              items={group(g)}
              render={row}
            />
          ),
      )}
      {unbudgeted.length > 0 && (
        <TopList
          id="unbudgeted"
          title={
            <>
              {t('budget.unbudgeted')} · <Money minor={ex.unbudgetedSpentMinor} decimals={0} className="text-muted" />
            </>
          }
          items={unbudgeted}
          render={row}
        />
      )}
      <OccasionalCard data={d} onOpen={(l) => setOpen({ categoryId: l.categoryId, name: l.name, occasional: true })} />
      <Charts data={d} onOpen={setOpen} />
      <CategorySheet line={open} data={d} onClose={() => setOpen(null)} />
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' || editing?.limitMinor == null ? t('budget.add') : t('budget.edit')} testId="budget-sheet">
        {editing && <BudgetForm key={editing === 'new' ? 'new' : editing.categoryId} line={editing === 'new' ? null : editing} lines={d.lines} month={d.month} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
