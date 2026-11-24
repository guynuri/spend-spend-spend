import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from '../../api';
import { Card, CardTitle, ProgressBar, Spinner, type Tone } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { CategoryIcon } from '../../components/CategoryIcon';
import { TxTitle } from '../../components/TxTitle';
import { useCategoryMap } from '../../lib/queries';
import { useBudget } from '../budget/useBudget';
import { GENERAL_ID, type BudgetStatus } from '../../../shared/domain/budget';
import type { TxList } from '../../../shared/schemas/ledger';

const TONE: Record<BudgetStatus, Tone> = { on_pace: 'good', watch: 'warn', over: 'bad' };

/** The budgets closest to (or past) their limit this period. */
export function BudgetsWidget() {
  const { t } = useTranslation();
  const cats = useCategoryMap();
  const q = useBudget(null);
  if (q.isPending) return <Card><Spinner /></Card>;
  if (q.error) return null;
  const lines = q.data.lines.filter((l) => l.limitMinor !== null && l.limitMinor > 0).sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0)).slice(0, 4);
  return (
    <Card data-testid="home-budgets">
      <CardTitle
        action={
          <Link to="/budget" className="text-sm text-accent">
            {t('dashboard.seeAll')}
          </Link>
        }
      >
        {t('home.widgets.budgets.title')}
      </CardTitle>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">{t('home.noBudgets')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.categoryId}>
              <div className="mb-1 flex items-center gap-2">
                <CategoryIcon cat={l.categoryId === GENERAL_ID ? { id: GENERAL_ID, color: 'cat-7', emoji: '🧺' } : cats.get(l.categoryId)} />
                <bdi className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</bdi>
                <span className="text-xs text-muted tabular">
                  <Money minor={Math.max(0, l.spentMinor)} decimals={0} /> / <Money minor={l.limitMinor!} decimals={0} />
                </span>
              </div>
              <ProgressBar value={l.utilization ?? 0} tone={l.status ? TONE[l.status] : 'accent'} label={l.name} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The newest few transactions of the period Home shows (the latest month with data, early in a month). */
export function RecentWidget({ period }: { period: { start: string; end: string } }) {
  const { t } = useTranslation();
  const cats = useCategoryMap();
  const q = useQuery({ queryKey: ['transactions', 'home-recent', period.start, period.end], queryFn: () => get<TxList>(`/api/transactions?from=${period.start}&to=${period.end}`) });
  if (q.isPending) return <Card><Spinner /></Card>;
  if (q.error) return null;
  const items = q.data.items.slice(0, 5);
  return (
    <Card data-testid="home-recent">
      <CardTitle
        action={
          <Link to="/transactions" className="text-sm text-accent">
            {t('dashboard.seeAll')}
          </Link>
        }
      >
        {t('home.widgets.recent.title')}
      </CardTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('home.noRecent')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((tx) => (
            <li key={tx.id} className="flex min-h-11 items-center gap-3">
              <CategoryIcon cat={tx.categoryId ? cats.get(tx.categoryId) : null} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <TxTitle tx={tx} />
                </p>
                <p className="text-xs text-muted">
                  <DateText date={tx.date} format="dayMonth" />
                </p>
              </div>
              <Money minor={tx.amountMinor} decimals={0} tone={cats.get(tx.categoryId ?? '')?.kind !== 'transfer'} className="text-sm font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
