import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { errorKey, get, post, put } from '../../api';
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
import { FileError } from '../import/parseFile';
import { readStatement, statementFlip, statementLines } from './statement';

/** Card statement → split lines (input text in the transaction's direction) + skipped row count. */
async function loadStatement(file: File, total: number, otherNote: (n: number) => string): Promise<{ lines: Line[]; count: number; skipped: number; card: boolean }> {
  const { rows, errors, card } = await readStatement(file);
  if (!rows.length) throw new FileError('no_rows');
  const flip = statementFlip(rows, total);
  const { categoryIds } = await post<{ categoryIds: (string | null)[] }>('/api/rules/match', { items: rows.map((r) => ({ description: r.description.slice(0, 300), amountMinor: r.amountMinor * flip })) });
  const sign = total < 0 ? -1 : 1;
  const lines = statementLines(rows, total, categoryIds, otherNote).map((l) => ({ categoryId: l.categoryId, note: l.note, amount: minorToInput(l.minor * sign) }));
  return { lines, count: rows.length, skipped: errors.length, card };
}

interface Line {
  categoryId: string | null;
  amount: string;
  note: string;
}
/** Lines are entered in the transaction's direction (a refund line is negative). */
const toLines = (ls: SplitLine[], sign: number): Line[] => ls.map((l) => ({ categoryId: l.categoryId, amount: minorToInput(l.amountMinor * sign), note: l.note ?? '' }));

export function SplitEditor({ tx, onDone }: { tx: Tx; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const sign = tx.amountMinor < 0 ? -1 : 1;
  const [lines, setLines] = useState<Line[]>(() => (tx.splits.length ? toLines(tx.splits, sign) : [{ categoryId: null, amount: '', note: '' }, { categoryId: null, amount: '', note: '' }]));
  const [from, setFrom] = useState<string | null>(null);
  const [noPrev, setNoPrev] = useState(false);
  const [loaded, setLoaded] = useState<{ count: number; skipped: number; card: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
      setLines(toLines(r.suggestion.lines, sign));
      setFrom(r.suggestion.fromDate);
    } catch (e) {
      toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' });
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await loadStatement(file, tx.amountMinor, (count) => t('split.otherRows', { count }));
      setLines(r.lines);
      setLoaded(r);
      setFrom(null);
    } catch (e) {
      const k = e instanceof FileError ? `import.fileErrors.${e.code}` : errorKey(e);
      toast({ title: t(k, { defaultValue: t('errors.unknown') }), tone: 'bad' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
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
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} data-testid="split-upload">
          <FileSpreadsheet className="size-4" aria-hidden />
          {t('split.upload')}
        </Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.html,.htm" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} data-testid="split-file" />
        {from && (
          <span className="text-xs text-muted">
            {t('split.fromLast')} 
            <DateText date={from} />
          </span>
        )}
        {noPrev && <span className="text-xs text-muted">{t('split.noPrevious')}</span>}
      </div>
      <p className="text-xs text-muted" data-testid="split-loaded" data-card={loaded?.card}>
        {loaded ? t('split.statementLoaded', { count: loaded.count }) : t('split.uploadHint')}
      </p>
      {!!loaded?.skipped && (
        <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn" role="alert" data-testid="split-skipped">
          {t('split.statementSkipped', { count: loaded.skipped })}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {lines.map((l, i) => (
          <li key={i} className="flex flex-col gap-1" data-testid="split-line">
            <div className="flex items-center gap-2">
              <CategorySelect className="min-w-0 flex-1" value={l.categoryId} onChange={(v) => upd(i, { categoryId: v })} aria-label={`${t('split.line')} ${i + 1}`} />
              {/* Input is w-full: the wrapper sets the width so the row fits a phone. */}
              <div className="w-28 shrink-0">
                <AmountInput value={l.amount} onChange={(e) => upd(i, { amount: e.target.value })} aria-label={t('ledger.amount')} placeholder="0.00" />
              </div>
              <IconButton className="shrink-0" label={t('common.delete')} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length <= 2}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </div>
            {l.note && (
              <span className="truncate px-1 text-xs text-muted" dir="auto">
                {l.note}
              </span>
            )}
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
      {remaining !== 0 && valid && (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => setLines((ls) => [...ls, { categoryId: null, amount: minorToInput(remaining * sign), note: t('split.unassigned') }])} data-testid="split-keep-remainder">
          {t('split.keepRemainder')}
        </Button>
      )}
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
