import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreditCard, Tag, X } from 'lucide-react';
import { get } from '../../api';
import { IconButton } from '../../components/ui';
import { formatMoney, type Locale } from '../../../shared/money';
import { useCurrency } from '../../lib/session';
import type { TxList } from '../../../shared/schemas/ledger';
import { useBudget } from '../budget/useBudget';
import { AiSuggestButton } from '../ai/AiSuggest';
import { useLedgerFilters } from './filters';

const KEY = 'mz_todo_dismissed';
const readDismissed = (k: string): [number, number] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')[k];
    return Array.isArray(v) ? [v[0], v[1]] : [0, 0];
  } catch {
    return [0, 0];
  }
};

/**
 * "Needs attention" for the shown period: uncategorized transactions (+ AI categorize) and unsplit
 * card payments. Dismissal is per device and period, and lapses when either count grows.
 */
export function TodoCard() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const { f, set, period } = useLedgerFilters();
  const range = `from=${f.from}&to=${f.to}`;
  const uncat = useQuery({ queryKey: ['transactions', 'todo', range], queryFn: () => get<TxList>(`/api/transactions?${range}&uncategorized=1`) }).data?.summary.count ?? 0;
  // the budget period the range starts in (with a late pay day it is labelled by the next calendar month)
  const unsplit = useBudget(period).data?.unsplitCardMinor ?? 0;
  const [dismissed, setDismissed] = useState(() => readDismissed(range));
  const [dk, setDk] = useState(range);
  if (dk !== range) {
    setDk(range);
    setDismissed(readDismissed(range));
  }
  const dismiss = () => {
    const v: [number, number] = [uncat, unsplit];
    setDismissed(v);
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), [range]: v }));
    } catch {
      /* per-device convenience only */
    }
  };
  const hidden = uncat <= dismissed[0] && unsplit <= dismissed[1];
  if (!uncat && !unsplit) return null;
  // Dismissed, but the user is looking at uncategorized ones: keep the AI entry point reachable.
  if (hidden) return f.uncategorized ? <AiSuggestButton /> : null;
  const row = 'flex min-h-11 items-center gap-2';
  const action = 'min-h-11 shrink-0 rounded-lg px-2 font-semibold text-accent';
  return (
    <section className="flex flex-col gap-1 rounded-2xl border border-warn/30 bg-warn/5 p-3 text-sm" data-testid="todo-card" data-tour="todo">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t('ledger.todoTitle')}</h2>
        <IconButton className="-my-2 -me-2 size-9" label={t('ledger.todoDismiss')} onClick={dismiss} data-testid="todo-dismiss">
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
      {uncat > 0 && (
        <div className={row} data-testid="todo-uncat" data-count={uncat}>
          <Tag className="size-4 shrink-0 text-warn" aria-hidden />
          <span className="min-w-0 flex-1">{t('ledger.todoUncategorized', { count: uncat })}</span>
          {!f.uncategorized && (
            <button type="button" className={action} onClick={() => set({ uncategorized: true, category: '', kind: '' })} data-testid="todo-uncat-show">
              {t('ledger.todoShow')}
            </button>
          )}
        </div>
      )}
      {uncat > 0 && <AiSuggestButton />}
      {unsplit > 0 && (
        <div className={row} data-testid="unsplit-banner" data-tour="todo-unsplit" data-amount={unsplit}>
          <CreditCard className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1">{t('budget.unsplitBanner', { amount: formatMoney(unsplit, { currency, locale: i18n.language as Locale, decimals: 0 }) })}</span>
          {f.kind !== 'card_lump' && (
            <button type="button" className={action} onClick={() => set({ kind: 'card_lump', uncategorized: false })} data-testid="unsplit-cta">
              {t('budget.unsplitCta')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
