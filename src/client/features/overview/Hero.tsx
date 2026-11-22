import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { daysBetween } from '../../../shared/dates';
import { Money } from '../../components/Money';
import { cx } from '../../components/ui';
import { useParamFormatter } from '../../lib/format';

export interface HeroData {
  month: string;
  today: string;
  isCurrent: boolean;
  period: { start: string; end: string };
  budgetedMinor: number;
  spentBudgetedMinor: number;
  expensesMinor: number;
  incomeMinor: number;
  /** Elapsed share of the period (budget pace marker); null = no data yet this period. */
  f: number | null;
  overCount: number;
}

/** Days from today to the period's last day, today included; 0 outside the period. */
export const daysLeftIn = (today: string, period: { start: string; end: string }) => (today >= period.start && today <= period.end ? daysBetween(today, period.end) + 1 : 0);

/**
 * The first thing on Home: what's left to spend this period (all monthly budgets together), what that is
 * per remaining day, and how spending is pacing. Without budgets it shows spending so far and points to
 * the Budget page.
 */
export function Hero({ d }: { d: HeroData }) {
  const { t } = useTranslation();
  const pf = useParamFormatter();
  const has = d.budgetedMinor > 0;
  const left = d.budgetedMinor - d.spentBudgetedMinor;
  const days = d.isCurrent ? daysLeftIn(d.today, d.period) : 0;
  const perDay = days > 0 && left > 0 ? Math.floor(left / days) : null;
  const used = has ? Math.min(1, Math.max(0, d.spentBudgetedMinor / d.budgetedMinor)) : 0;
  return (
    <section className="relative overflow-hidden rounded-3xl bg-accent p-5 text-accent-fg shadow-[var(--mz-shadow)]" data-testid="hero-card" data-tour="pnl">
      {/* soft decorative circles: the friendly look, no data in them */}
      <span className="pointer-events-none absolute -end-10 -top-10 size-40 rounded-full bg-white/10" aria-hidden />
      <span className="pointer-events-none absolute -bottom-14 end-16 size-32 rounded-full bg-white/5" aria-hidden />
      <div className="relative">
        {has ? (
          <>
            <p className="text-sm font-medium opacity-90">{left >= 0 ? t('home.leftToSpend') : t('home.overBudget')}</p>
            <p className="mt-1 text-4xl font-bold tracking-tight" data-testid="hero-left" data-minor={left}>
              <Money minor={Math.abs(left)} decimals={0} />
            </p>
            <p className="mt-1 text-sm opacity-90" data-testid="hero-per-day">
              {perDay !== null ? t('home.perDay', { ...pf({ amountMinor: perDay }), count: days }) : left < 0 ? t('home.overHint') : d.isCurrent ? t('home.lastDay') : t('home.inMonth', pf({ month: d.month }))}
            </p>
            <div className="relative mt-4 h-3 w-full overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label={t('home.spentOfBudget')}>
              <div className={cx('h-full rounded-full bg-white transition-[width]', left < 0 && 'opacity-70')} style={{ width: `${used * 100}%` }} />
              {d.f !== null && d.isCurrent && <div className="absolute top-0 h-full w-0.5 bg-accent-fg/70" style={{ insetInlineStart: `${Math.min(1, d.f) * 100}%` }} aria-hidden />}
            </div>
            <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs opacity-90">
              <span>{t('home.spentOf', pf({ spentMinor: d.spentBudgetedMinor, budgetMinor: d.budgetedMinor }))}</span>
              {d.overCount > 0 && <span className="font-semibold">{t('home.overCount', { count: d.overCount })}</span>}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium opacity-90">{t('home.spentSoFar')}</p>
            <p className="mt-1 text-4xl font-bold tracking-tight" data-testid="hero-spent">
              <Money minor={d.expensesMinor} decimals={0} />
            </p>
            <Link to="/budget" className="mt-3 inline-flex min-h-11 items-center rounded-2xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25" data-testid="hero-set-budget">
              {t('home.setBudget')}
            </Link>
          </>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-3 text-sm" data-testid="pnl-card">
          <div data-testid="pnl-income">
            <p className="text-xs opacity-80">{t('dashboard.income')}</p>
            <p className="font-semibold">
              <Money minor={d.incomeMinor} decimals={0} />
            </p>
          </div>
          <div data-testid="pnl-expenses">
            <p className="text-xs opacity-80">{t('dashboard.expenses')}</p>
            <p className="font-semibold">
              <Money minor={d.expensesMinor} decimals={0} />
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
