import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { errorKey, get, put } from '../../api';
import { useToast } from '../../components/Toast';
import { Button, cx, IconButton } from '../../components/ui';
import { AmountInput } from '../../components/AmountInput';
import { CategorySelect } from '../../components/CategorySelect';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { minorToInput, parseMoneyInput } from '../../../shared/money';
import type { SplitLine, Tx } from '../../../shared/schemas/ledger';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT } from '../../lib/queries';

interface Line {
  categoryId: string | null;
  amount: string;
  note: string;
}
/** Lines are entered as positive numbers in the transaction's direction. */
const toLines = (ls: SplitLine[]): Line[] => ls.map((l) => ({ categoryId: l.categoryId, amount: minorToInput(Math.abs(l.amountMinor)), note: l.note ?? '' }));

export function SplitEditor({ tx, onDone }: { tx: Tx; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const sign = tx.amountMinor < 0 ? -1 : 1;
  const [lines, setLines] = useState<Line[]>(() => (tx.splits.length ? toLines(tx.splits) : [{ categoryId: null, amount: '', note: '' }, { categoryId: null, amount: '', note: '' }]));
  const [from, setFrom] = useState<string | null>(null);
  const [noPrev, setNoPrev] = useState(false);
  const parsed = lines.map((l) => parseMoneyInput(l.amount || '0'));
  const valid = parsed.every((p) => p !== null);
  const assigned = parsed.reduce<number>((a, p) => a + (p ?? 0), 0) * sign;
  const remaining = tx.amountMinor - assigned;
  const save = useApiMutation(
    (body: { lines: { categoryId: string | null; amountMinor: number; note?: string }[] }) => put(`/api/transactions/${tx.id}/splits`, body),
    { invalidate: [...LEDGER_DEPENDENT], onSuccess: onDone, successKey: 'ledger.saved' },
  );
  const same = async () => {
    try {
      const r = await get<{ suggestion: { fromDate: string; lines: SplitLine[] } | null }>(`/api/transactions/${tx.id}/split-suggestion`);
      if (!r.suggestion) return setNoPrev(true);
      setLines(toLines(r.suggestion.lines));
      setFrom(r.suggestion.fromDate);
    } catch (e) {
      toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' });
    }
  };
  // Pre-fill a new line only with what is still left to assign (never when already over).
  const leftToAssign = remaining * sign > 0 ? minorToInput(Math.abs(remaining)) : '';
  const upd = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="flex flex-col gap-3" data-testid="split-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="secondary" onClick={() => void same()} data-testid="split-same">
          <Copy className="size-4" aria-hidden />
          {t('split.sameAsLast')}
        </Button>
        {from && (
          <span className="text-xs text-muted">
            {t('split.fromLast')} 
            <DateText date={from} />
          </span>
        )}
        {noPrev && <span className="text-xs text-muted">{t('split.noPrevious')}</span>}
      </div>
      <ul className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2" data-testid="split-line">
            <CategorySelect className="min-w-0 flex-1" value={l.categoryId} onChange={(v) => upd(i, { categoryId: v })} aria-label={`${t('split.line')} ${i + 1}`} />
            <AmountInput className="w-28 shrink-0" value={l.amount} onChange={(e) => upd(i, { amount: e.target.value })} aria-label={t('ledger.amount')} placeholder="0.00" />
            <IconButton label={t('common.delete')} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length <= 2}>
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" className="self-start" onClick={() => setLines((ls) => [...ls, { categoryId: null, amount: leftToAssign, note: '' }])}>
        <Plus className="size-4" aria-hidden />
        {t('split.add')}
      </Button>
      <div className={cx('flex justify-between rounded-xl px-3 py-2 text-sm', remaining === 0 ? 'bg-good/10 text-good' : 'bg-warn/10 text-warn')} data-testid="split-remaining">
        <span>{t('split.remaining')}</span>
        <Money minor={remaining} />
      </div>
      {remaining !== 0 && <p className="text-xs text-muted">{t('split.mustMatch')}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {tx.hasSplits && (
          <Button variant="ghost" onClick={() => save.mutate({ lines: [] })}>
            {t('split.clear')}
          </Button>
        )}
        <Button
          disabled={!valid || remaining !== 0}
          busy={save.isPending}
          data-testid="split-save"
          onClick={() => save.mutate({ lines: lines.map((l, i) => ({ categoryId: l.categoryId, amountMinor: (parsed[i] ?? 0) * sign, ...(l.note ? { note: l.note } : {}) })) })}
        >
          {t('split.save')}
        </Button>
      </div>
    </div>
  );
}
