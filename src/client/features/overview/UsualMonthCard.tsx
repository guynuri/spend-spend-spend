import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Crown, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardTitle, cx } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { useParamFormatter } from '../../lib/format';
import { formatPercent, type Locale } from '../../../shared/money';
import type { UsualItem, UsualMonth } from '../../../shared/domain/usual';

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

/** This month's spending vs. the usual amount for the same share of the month (1 = on pace). */
const paceOf = (i: UsualItem, f: number) => (i.avgMinor > 0 && f > 0 ? i.thisMonthMinor / (i.avgMinor * f) : null);

/**
 * "A usual month": the usual total with its share of income, where the money goes (one segmented
 * bar), what stands out this month, and per category the usual amount next to this month so far.
 */
export function UsualMonthCard({ u, month, f }: { u: UsualMonth | null; month: string; f: number | null }) {
  const { t, i18n } = useTranslation();
  const pf = useParamFormatter();
  const [picked, setPicked] = useState<string | null>(null);
  const pct = (x: number) => formatPercent(x, i18n.language as Locale);
  if (!u || !u.items.length)
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

  // What stands out this month: the category furthest above, and furthest below, its usual pace.
  const fr = f ?? 1;
  // Only variable spending has a pace; nothing spent yet may just be timing, so it isn't "below".
  const paced = u.items
    .filter((i) => !i.fixed && i.thisMonthMinor > 0 && i.avgMinor >= 10_000)
    .map((i) => ({ i, p: paceOf(i, fr) }))
    .filter((x): x is { i: UsualItem; p: number } => x.p !== null);
  const hot = paced.filter((x) => x.p >= 1.2).sort((a, b) => b.p - a.p)[0];
  const cool = fr >= 0.25 ? paced.filter((x) => x.p <= 0.7).sort((a, b) => a.p - b.p)[0] : undefined;
  const biggest = u.items[0]!;
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
            {t('dashboard.usual.ofYourIncome', { pct: pct(u.spendShareOfIncome), ...pf({ incomeMinor: u.avgIncomeMinor }) })}
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

      {/* What stands out. */}
      <div className="mt-3 flex flex-wrap gap-2" data-testid="usual-highlights">
        <Chip icon={<Crown className="size-3.5" aria-hidden />} tone="accent">
          {t('dashboard.usual.biggest')} <bdi>{biggest.name}</bdi> ({pct(biggest.shareOfSpending)})
        </Chip>
        {hot && (
          <Chip icon={<TrendingUp className="size-3.5" aria-hidden />} tone="warn" testId="usual-hot">
            <bdi>{hot.i.name}</bdi>: {t(f !== null && f < 1 ? 'dashboard.usual.paceAbove' : 'dashboard.usual.above', { pct: pct(hot.p - 1) })}
          </Chip>
        )}
        {cool && (
          <Chip icon={<TrendingDown className="size-3.5" aria-hidden />} tone="good" testId="usual-cool">
            <bdi>{cool.i.name}</bdi>: {t(f !== null && f < 1 ? 'dashboard.usual.paceBelow' : 'dashboard.usual.below', { pct: pct(1 - cool.p) })}
          </Chip>
        )}
      </div>

      {/* Per category: usual amount, share of income, and this month so far against it. */}
      <ul className="mt-4 flex flex-col gap-3" data-testid="usual-items">
        {u.items.map((i, k) => (
          <li key={i.categoryId}>
            <Link to={`/transactions?category=${i.categoryId}`} className="block min-h-11 rounded-lg active:bg-surface-2" data-testid="usual-item">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: CAT[k % CAT.length] }} aria-hidden />
                  <bdi className="truncate font-medium">{i.name}</bdi>
                </span>
                <span className="shrink-0">
                  {t('dashboard.usual.perMonth', pf({ amountMinor: i.avgMinor }))}
                  <span className="text-muted"> · {t(i.shareOfIncome !== null ? 'dashboard.usual.ofIncome' : 'dashboard.usual.ofSpending', { pct: pct(i.shareOfIncome ?? i.shareOfSpending) })}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (i.thisMonthMinor / i.avgMinor) * 100)}%`, background: i.over ? 'var(--mz-warn)' : CAT[k % CAT.length] }} />
              </div>
              <p className={cx('mt-0.5 text-xs', i.over ? 'text-warn' : 'text-muted')} data-testid="usual-this-month">
                <DateText date={month} format="month" />: <Money minor={i.thisMonthMinor} decimals={0} />
                {i.over && <> · {t('dashboard.usual.over')}</>}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {u.unassignedMinor > 0.05 * u.avgExpensesMinor && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted" data-testid="usual-unassigned">
          <span className="mt-0.5 size-2.5 shrink-0 rounded-full" style={{ background: UNASSIGNED }} aria-hidden />
          {t('dashboard.usual.unassigned', pf({ amountMinor: u.unassignedMinor }))}
        </p>
      )}
    </Card>
  );
}

function Chip({ icon, tone, children, testId }: { icon: React.ReactNode; tone: 'accent' | 'warn' | 'good'; children: React.ReactNode; testId?: string }) {
  const cls = { accent: 'bg-accent/10 text-accent', warn: 'bg-warn/10 text-warn', good: 'bg-good/10 text-good' }[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', cls)} data-testid={testId}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
