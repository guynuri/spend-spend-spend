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
import { FileError, parseFile } from '../import/parseFile';

const MAX_LINES = 29; // splitsPut allows 30: one is left for an unassigned remainder

/**
 * Card statement rows → split lines in the transaction's direction: rows with a rule category are
 * summed per category, the rest stay one line each (note = description); overflow is merged.
 */
async function statementLines(file: File, total: number, otherNote: (n: number) => string): Promise<{ lines: Line[]; count: number }> {
  const p = await parseFile(file);
  let rows = p.result?.rows;
  if (!rows) {
    const g = await import('../../../shared/import/generic');
    if (!p.guess || !g.mappingValid(p.guess)) throw new FileError('unsupported_file');
    rows = g.parseWithMapping(p.grid, p.guess).rows;
  }
  if (!rows.length) throw new FileError('no_rows');
  const sum = rows.reduce((a, r) => a + r.amountMinor, 0);
  // Card exports show charges as positive or negative depending on the issuer: align to the payment.
  const flip = sum !== 0 && (sum < 0) !== (total < 0) ? -1 : 1;
  const { categoryIds } = await post<{ categoryIds: (string | null)[] }>('/api/rules/match', { items: rows.map((r) => ({ description: r.description.slice(0, 300), amountMinor: r.amountMinor * flip })) });
  const byCat = new Map<string, number>();
  const free: { minor: number; note: string }[] = [];
  rows.forEach((r, i) => {
    const c = categoryIds[i];
    if (c) byCat.set(c, (byCat.get(c) ?? 0) + r.amountMinor * flip);
    else free.push({ minor: r.amountMinor * flip, note: r.description.slice(0, 120) });
  });
  const sign = total < 0 ? -1 : 1;
  const out: (Line & { minor: number })[] = [...[...byCat].map(([categoryId, minor]) => ({ categoryId, minor, note: '' })), ...free.map((f) => ({ categoryId: null, ...f }))].map((l) => ({ ...l, amount: '' }));
  if (out.length > MAX_LINES) {
    const rest = out.splice(MAX_LINES - 1);
    out.push({ categoryId: null, minor: rest.reduce((a, l) => a + l.minor, 0), note: otherNote(rest.length), amount: '' });
  }
  return { lines: out.map(({ minor, ...l }) => ({ ...l, amount: minorToInput(minor * sign) })), count: rows.length };
}

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
  const [loaded, setLoaded] = useState<number | null>(null);
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
      setLines(toLines(r.suggestion.lines));
      setFrom(r.suggestion.fromDate);
    } catch (e) {
      toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' });
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await statementLines(file, tx.amountMinor, (count) => t('split.otherRows', { count }));
      setLines(r.lines);
      setLoaded(r.count);
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
      <p className="text-xs text-muted" data-testid="split-loaded">
        {loaded !== null ? t('split.statementLoaded', { count: loaded }) : t('split.uploadHint')}
      </p>
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
