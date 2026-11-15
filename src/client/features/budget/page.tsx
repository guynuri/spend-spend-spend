import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, CheckCircle2, ChevronLeft, ChevronRight, Eye, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { put } from '../../api';
import { Badge, Button, Card, CardTitle, cx, EmptyState, ErrorState, IconButton, PageHeader, ProgressBar, Spinner, type Tone } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText, useFormatDate } from '../../components/DateText';
import { AmountInput } from '../../components/AmountInput';
import { ExplainSheet } from '../../components/ExplainSheet';
import { Sheet } from '../../components/Sheet';
import { C, ChartBox, tooltipStyle, useCompactMoney, useMoneyFmt } from '../../components/charts';
import { useApiMutation } from '../../lib/mutate';
import { useCanWrite } from '../../lib/session';
import { formatPercent, minorToInput, parseMoneyInput, type Locale } from '../../../shared/money';
import { addMonths, monthEnd, monthStart } from '../../../shared/dates';
import type { BudgetLine, BudgetStatus } from '../../../shared/domain/budget';
import { UnsplitCardBanner } from '../ledger/UnsplitCardBanner';
import { useBudget, type BudgetResponse } from './useBudget';

/** Unicode isolate so amounts never reorder inside RTL sentences. */
const iso = (s: string) => `\u2068${s}\u2069`;
const TONE: Record<BudgetStatus, Tone> = { over: 'bad', watch: 'warn', on_pace: 'good' };
const ICON = { over: AlertOctagon, watch: Eye, on_pace: CheckCircle2 };

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

function LimitEditor({ line, month }: { line: BudgetLine; month: string }) {
  const { t } = useTranslation();
  const canWrite = useCanWrite();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const save = useApiMutation((limitMinor: number | null) => put('/api/budgets', { month, items: [{ categoryId: line.categoryId, limitMinor }] }), {
    invalidate: [['budget'], ['me'], ['dashboard'], ['health']],
    onSuccess: () => setEditing(false),
  });
  if (!canWrite) return line.limitMinor === null ? <span className="text-xs text-muted">{t('budget.noLimit')}</span> : <Money minor={line.limitMinor} decimals={0} className="text-sm" />;
  if (!editing)
    return (
      <button
        type="button"
        className="min-h-11 rounded-lg px-2 text-sm font-medium text-accent"
        data-testid="limit-edit"
        onClick={() => {
          setValue(line.limitMinor === null ? '' : minorToInput(line.limitMinor).replace(/\.00$/, ''));
          setEditing(true);
        }}
      >
        {line.limitMinor === null ? t('budget.setBudget') : <Money minor={line.limitMinor} decimals={0} />}
      </button>
    );
  const minor = value.trim() === '' ? null : parseMoneyInput(value);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (minor !== null && minor >= 0) save.mutate(minor);
      }}
    >
      <AmountInput autoFocus className="w-24" value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('budget.limit')} data-testid="limit-input" />
      <Button size="sm" type="submit" busy={save.isPending} disabled={minor === null || minor < 0} data-testid="limit-save">
        {t('common.save')}
      </Button>
      {line.limitMinor !== null && (
        <Button size="sm" variant="ghost" onClick={() => save.mutate(null)} aria-label={t('budget.removeLimit')}>
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </form>
  );
}

function LineRow({ line, month, onOpen }: { line: BudgetLine; month: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const tone: Tone = line.status ? TONE[line.status] : 'accent';
  return (
    <li className="py-3" data-testid="budget-line" data-status={line.status ?? 'none'} data-category={line.categoryId}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-h-11 min-w-0 flex-1 text-start">
          <div className="truncate font-medium">
            <bdi>{line.name}</bdi>
          </div>
          <div className="text-xs text-muted">
            <Money minor={Math.max(0, line.spentMinor)} decimals={0} /> {line.limitMinor !== null && line.remainingMinor !== null && (line.remainingMinor >= 0 ? <>· {t('budget.remaining')} <Money minor={line.remainingMinor} decimals={0} /></> : <span className="text-bad">· {t('budget.over')} <Money minor={-line.remainingMinor} decimals={0} /></span>)}
          </div>
        </button>
        <StatusBadge status={line.status} />
        <LimitEditor line={line} month={month} />
      </div>
      {line.limitMinor !== null && <ProgressBar value={line.utilization ?? 0} tone={tone} label={line.name} />}
      <div className="mt-1 text-xs text-muted">
        {t('budget.avg3')}: <Money minor={line.avg3Minor} decimals={0} />
      </div>
    </li>
  );
}

function Charts({ data }: { data: BudgetResponse }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const money = useMoneyFmt();
  const compact = useCompactMoney();
  const rtl = i18n.dir() === 'rtl';
  const hist = data.history.map((h) => ({ ...h, label: fmt(h.month, 'monthShort') }));
  const dist = data.lines.filter((l) => l.spentMinor > 0).sort((a, b) => b.spentMinor - a.spentMinor).slice(0, 8);
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
      <Card>
        <CardTitle>{t('budget.distribution')}</CardTitle>
        <ul className="flex flex-col gap-2">
          {dist.map((l) => (
            <li key={l.categoryId}>
              <Link to={`/transactions?from=${monthStart(data.month)}&to=${monthEnd(data.month)}&category=${l.categoryId}`} className="block min-h-11">
                <div className="flex justify-between text-sm">
                  <bdi>{l.name}</bdi>
                  <span className="text-muted">
                    <Money minor={l.spentMinor} decimals={0} /> · {formatPercent(l.spentMinor / total, i18n.language as Locale)}
                  </span>
                </div>
                <ProgressBar value={l.spentMinor / total} label={l.name} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function CategorySheet({ line, data, onClose }: { line: BudgetLine | null; data: BudgetResponse; onClose: () => void }) {
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
          <p className="text-xs text-muted">{t('budget.appliesFrom', { month: fmt(data.month, 'month') })}</p>
          <Link to={`/transactions?from=${monthStart(data.month)}&to=${monthEnd(data.month)}&category=${line.categoryId}`} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-surface-2 px-4 font-medium">
            {t('budget.viewTransactions')}
          </Link>
        </div>
      )}
    </Sheet>
  );
}

export function Component() {
  const { t, i18n } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const q = useBudget(sp.get('month'));
  const money0 = useMoneyFmt(0);
  const [open, setOpen] = useState<BudgetLine | null>(null);
  const loc = i18n.language as Locale;
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const go = (n: number) => setSp({ month: addMonths(d.month, n) }, { replace: true });
  const budgeted = d.lines.filter((l) => l.limitMinor !== null);
  const unbudgeted = d.lines.filter((l) => l.limitMinor === null);
  const group = (g: 'fixed' | 'variable') => budgeted.filter((l) => (l.grp ?? 'variable') === g);
  const ex = d.totals;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('budget.title')} />
      <div className="flex items-center justify-between">
        <IconButton label={t('ledger.prevMonth')} onClick={() => go(-1)} data-testid="month-prev">
          <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <span className="font-semibold" data-testid="budget-month">
          <DateText date={d.month} format="month" />
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
            <p className="mt-3 text-xs text-muted">{t('budget.explainTotals')}</p>
            <p className="mt-2 text-xs text-muted">{t('budget.explainStatusBody')}</p>
          </ExplainSheet>
        </div>
      </Card>
      {d.lines.length === 0 && <EmptyState title={t('budget.empty')} />}
      {(['variable', 'fixed'] as const).map(
        (g) =>
          group(g).length > 0 && (
            <Card key={g}>
              <CardTitle>
                {t(`budget.${g}`)} · <Money minor={g === 'fixed' ? ex.fixed.spentMinor : ex.variable.spentMinor} decimals={0} className="text-muted" /> / <Money minor={g === 'fixed' ? ex.fixed.budgetedMinor : ex.variable.budgetedMinor} decimals={0} className="text-muted" />
              </CardTitle>
              <ul className="divide-y divide-border">
                {group(g).map((l) => (
                  <LineRow key={l.categoryId} line={l} month={d.month} onOpen={() => setOpen(l)} />
                ))}
              </ul>
            </Card>
          ),
      )}
      <Card>
        <CardTitle>
          {t('budget.unbudgeted')} · <Money minor={ex.unbudgetedSpentMinor} decimals={0} className="text-muted" />
        </CardTitle>
        <ul className={cx('divide-y divide-border')}>
          {unbudgeted.map((l) => (
            <LineRow key={l.categoryId} line={l} month={d.month} onOpen={() => setOpen(l)} />
          ))}
        </ul>
      </Card>
      <Charts data={d} />
      <CategorySheet line={open} data={d} onClose={() => setOpen(null)} />
    </div>
  );
}
