import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { put } from '../../api';
import { Button } from '../../components/ui';
import { AmountInput } from '../../components/AmountInput';
import { Money } from '../../components/Money';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useCategories } from '../../lib/queries';
import { minorToInput, parseMoneyInput } from '../../../shared/money';
import type { Tx } from '../../../shared/schemas/ledger';

/** The "Owed to me" system category (D-R30). */
export function useOwedCategory() {
  return (useCategories().data?.categories ?? []).find((c) => c.systemKey === 'owed') ?? null;
}

/**
 * On a purchase: "someone will pay me back" — how much of it is theirs. That part moves to "Owed to me",
 * so only your share counts as spending; their repayment goes in the same category.
 */
export function OwedBox({ tx, onSaved }: { tx: Tx; onSaved: (t: Tx) => void }) {
  const { t } = useTranslation();
  const owedCat = useOwedCategory();
  const current = tx.hasSplits && owedCat ? -(tx.splits.find((s) => s.categoryId === owedCat.id)?.amountMinor ?? 0) : 0;
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => minorToInput(current || Math.round(-tx.amountMinor / 2)));
  const minor = parseMoneyInput(value);
  const save = useApiMutation((owedMinor: number) => put<Tx>(`/api/transactions/${tx.id}/owed`, { owedMinor }), {
    invalidate: [...LEDGER_DEPENDENT],
    successKey: 'ledger.saved',
    onSuccess: (r) => {
      setOpen(false);
      onSaved(r);
    },
  });
  if (!owedCat || tx.amountMinor >= 0) return null;
  // an unrelated split is edited in the split editor instead
  if (tx.hasSplits && !current) return null;
  if (!open)
    return current ? (
      <div className="flex items-center justify-between gap-2 rounded-2xl bg-good/10 p-3 text-sm" data-testid="owed-set">
        <span>
          🤝 {t('owed.theyOwe')} <Money minor={current} decimals={0} className="font-semibold" />
        </span>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            {t('common.edit')}
          </Button>
          <Button size="sm" variant="ghost" busy={save.isPending} onClick={() => save.mutate(0)} data-testid="owed-remove">
            {t('owed.remove')}
          </Button>
        </span>
      </div>
    ) : (
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="owed-open">
        🤝 {t('owed.someonePays')}
      </Button>
    );
  const ok = !!minor && minor > 0 && minor < -tx.amountMinor;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3" data-testid="owed-form">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{t('owed.howMuch')}</span>
        <AmountInput value={value} onChange={(e) => setValue(e.target.value)} className="w-32" data-testid="owed-amount" />
      </label>
      <p className="text-xs text-muted">{t('owed.hint')}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" disabled={!ok} busy={save.isPending} onClick={() => save.mutate(minor!)} data-testid="owed-save">
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
