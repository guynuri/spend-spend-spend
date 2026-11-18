import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardTitle, cx } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { useParamFormatter } from '../../lib/format';
import { formatPercent, type Locale } from '../../../shared/money';
import { monthEnd, monthStart } from '../../../shared/dates';
import type { UsualMonth } from '../../../shared/domain/usual';

/** Fixed categorical order (styles.css --mz-cat-*): color follows the category's rank in the usual month. */
const CAT = ['var(--mz-cat-1)', 'var(--mz-cat-2)', 'var(--mz-cat-3)', 'var(--mz-cat-4)', 'var(--mz-cat-5)', 'var(--mz-cat-6)'];
const OTHER = 'var(--mz-chart-2)';
// Not categorized yet: neutral with a diagonal texture, so it never reads as one more category.
const UNASSIGNED = 'repeating-linear-gradient(135deg, var(--mz-border) 0 3px, var(--mz-surface-2) 3px 6px)';

interface Segment {
  key: string;
  label: string;
  minor: number;
  fill: string;
}

/**
 * "A usual month": the usual total with its share of income, where the money goes (one segmented
 * bar), and per category the usual amount (bars against the biggest), with this month in one line.
 */
export function UsualMonthCard({ u, month, current }: { u: UsualMonth | null; month: string; current: boolean }) {
  const { t, i18n } = useTranslation();
  const pf = useParamFormatter();
  const [picked, setPicked] = useState<string | null>(null);
  const pct = (x: number) => formatPercent(x, i18n.language as Locale);
  if (!u)
    return (
      <Card data-testid="usual-card">
        <CardTitle>{t('dashboard.usual.title')}</CardTitle>
        <p className="text-sm text-muted">{t('dashboard.usual.notYet')}</p>
      </Card>
    );

  const segments: Segment[] = [
    ...u.items.map((i, k) => ({ key: i.categoryId, label: i.name, minor: i.avgMinor, fill: CAT[k % CAT.length]! })),
    ...(u.otherMinor > 0 ? [{ key: 'other', label: t('dashboard.usual.other'), minor: u.otherMinor, fill: OTHER }] : []),
    ...(u.unassignedMinor > 0 ? [{ key: 'unassigned', label: t('dashboard.usual.notCategorized'), minor: u.unassignedMinor, fill: UNASSIGNED }] : []),
  ];
  const total = segments.reduce((a, s) => a + s.minor, 0) || 1;
  const sel = segments.find((s) => s.key === picked) ?? null;

  const top = u.items[0]?.avgMinor || 1;
  const from = monthStart(month);
  const to = monthEnd(month);
  const first = u.months[0]!;
  const last = u.months[u.months.length - 1]!;

  return (
    <Card data-testid="usual-card">
      <CardTitle>{t('dashboard.usual.title')}</CardTitle>

      {/* Headline: the usual total, and what share of income it is. */}
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <p className="flex items-baseline gap-1.5" data-testid="usual-summary">
          <Money minor={u.avgExpensesMinor} decimals={0} className="text-3xl font-bold tracking-tight" />
          <span className="text-sm text-muted">{t('dashboard.usual.aMonth')}</span>
        </p>
        {u.spendShareOfIncome !== null && (
          <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', u.spendShareOfIncome > 1 ? 'bg-bad/10 text-bad' : u.spendShareOfIncome > 0.9 ? 'bg-warn/10 text-warn' : 'bg-good/10 text-good')} data-testid="usual-income-share">
            {t('dashboard.usual.ofYourIncome', pf({ pct: u.spendShareOfIncome, incomeMinor: u.avgIncomeMinor }))}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted" data-testid="usual-basis">
        {t('dashboard.usual.basis', { count: u.months.length })} <DateText date={first} format="month" />
        {first !== last && (
          <>
            {' – '}
            <DateText date={last} format="month" />
          </>
        )}
        {u.months.length < 3 && <> · {t('dashboard.usual.moreData')}</>}
      </p>

      {/* Where the money goes: one segmented bar; tap a segment to name it. */}
      <div className="mt-4 flex h-4 w-full gap-[2px] overflow-hidden rounded-full" role="list" aria-label={t('dashboard.usual.whereItGoes')} data-testid="usual-bar">
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            role="listitem"
            aria-label={`${s.label}: ${pct(s.minor / total)}`}
            aria-pressed={picked === s.key}
            title={s.label}
            onClick={() => setPicked(picked === s.key ? null : s.key)}
            className={cx('h-full min-w-[3px] transition-opacity', picked && picked !== s.key && 'opacity-40')}
            style={{ width: `${(s.minor / total) * 100}%`, background: s.fill }}
          />
        ))}
      </div>
      <p className="mt-1.5 min-h-4 text-xs text-muted" aria-live="polite" data-testid="usual-bar-label">
        {sel ? (
          <>
            <span className="font-medium text-text">{sel.label}</span> · <Money minor={sel.minor} decimals={0} /> {t('dashboard.usual.aMonth')} · {pct(sel.minor / total)}
          </>
        ) : (
          t('dashboard.usual.whereItGoes')
        )}
      </p>

      {/* Per category: what a usual month holds (bars against the biggest), and this month in one line. */}
      <ul className="mt-4 flex flex-col gap-3.5" data-testid="usual-items">
        {u.items.map((i, k) => (
          <li key={i.categoryId}>
            <Link to={`/transactions?from=${from}&to=${to}&category=${i.categoryId}`} className="block min-h-11 rounded-lg active:bg-surface-2" data-testid="usual-item">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: CAT[k % CAT.length] }} aria-hidden />
                  <bdi className="truncate font-medium">{i.name}</bdi>
                </span>
                <span className="shrink-0 text-base font-semibold" data-testid="usual-amount">
                  {t('dashboard.usual.perMonth', pf({ amountMinor: i.avgMinor }))}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, (i.avgMinor / top) * 100)}%`, background: CAT[k % CAT.length] }} />
              </div>
              <p className="mt-1 text-xs text-muted" data-testid="usual-this-month">
                {t(i.shareOfIncome !== null ? 'dashboard.usual.ofIncome' : 'dashboard.usual.ofSpending', pf({ pct: i.shareOfIncome ?? i.shareOfSpending }))}
                {' · '}
                <span className={cx(i.over && 'text-warn')}>
                  {t(current ? 'dashboard.usual.soFar' : 'dashboard.usual.inMonth', pf({ month, amountMinor: i.thisMonthMinor }))}
                  {i.over && <> · {t('dashboard.usual.over')}</>}
                </span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {(u.unassignedMinor > 0.05 * u.avgExpensesMinor || (!u.items.length && u.unassignedMinor > 0)) && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted" data-testid="usual-unassigned">
          <span className="mt-0.5 size-2.5 shrink-0 rounded-full" style={{ background: UNASSIGNED }} aria-hidden />
          {t('dashboard.usual.unassigned', pf({ amountMinor: u.unassignedMinor }))}
        </p>
      )}
    </Card>
  );
}
