import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileSpreadsheet, Plus, Sparkles, Trash2 } from 'lucide-react';
import { errorKey, get, post, put } from '../../api';
import { useToast } from '../../components/Toast';
import { Badge, Button, Checkbox, cx, IconButton } from '../../components/ui';
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
import { useAiStatus } from '../ai/useAi';
import { useMe } from '../../lib/session';
import { normKey } from '../../../shared/normalize';

interface Loaded {
  lines: Line[];
  count: number;
  skipped: number;
  card: boolean;
  /** AI suggested a category for this many lines. */
  ai: number;
  /** PDF: rows don't add up to the statement's printed total. */
  totalMismatch: boolean;
}

/**
 * Card statement → split lines (input text in the transaction's direction). Rules categorize what
 * they can; with AI on, the remaining businesses get a suggested category the user can change.
 */
// AI answers per household + business for this session: re-uploading a statement (fixing lines,
// another card) does not spend the small daily AI quota again.
const aiAnswers = new Map<string, string>();
const aiKey = (hh: string, merchant: string, minor: number) => `${hh}|${minor < 0 ? 'out' : 'in'}|${normKey(merchant)}`;

async function loadStatement(file: File, total: number, otherNote: (n: number) => string, aiFor: Promise<string | null>): Promise<Loaded> {
  const { rows, errors, card, totalMinor } = await readStatement(file);
  if (!rows.length) throw new FileError('no_rows');
  const flip = statementFlip(rows, total);
  const { categoryIds } = await post<{ categoryIds: (string | null)[] }>('/api/rules/match', { items: rows.map((r) => ({ description: r.description.slice(0, 300), amountMinor: r.amountMinor * flip })) });
  const sign = total < 0 ? -1 : 1;
  const st = statementLines(rows, total, categoryIds, otherNote);
  const lines: Line[] = st.map((l) => ({ categoryId: l.categoryId, note: l.note, amount: minorToInput(l.minor * sign), merchant: l.merchant, count: l.count, minor: l.minor }));
  let ai = 0;
  const open = lines.filter((l) => !l.categoryId && l.merchant);
  // Household id when AI is on for it (null otherwise); only awaited when a business needs a category.
  const hh = open.length ? await aiFor : null;
  if (hh) {
    const setAi = (l: Line, categoryId: string) => {
      l.categoryId = categoryId;
      l.aiCategoryId = categoryId;
      ai++;
    };
    const ask: Line[] = [];
    for (const l of open) {
      const known = aiAnswers.get(aiKey(hh, l.merchant!, l.minor!));
      if (known) setAi(l, known);
      else ask.push(l);
    }
    if (ask.length) {
      try {
        const r = await post<{ suggestions: { index: number; categoryId: string }[] }>('/api/ai/categorize-items', { items: ask.slice(0, 40).map((l) => ({ description: l.merchant!, amountMinor: l.minor! })) });
        for (const s of r.suggestions) {
          const l = ask[s.index];
          if (!l || l.categoryId) continue;
          aiAnswers.set(aiKey(hh, l.merchant!, l.minor!), s.categoryId);
          setAi(l, s.categoryId);
        }
      } catch {
        // AI is a convenience: limits, outages or a turned-off household leave the lines uncategorized.
      }
    }
  }
  const rowSum = rows.reduce((a, r) => a + r.amountMinor, 0);
  const totalMismatch = totalMinor !== null && totalMinor !== undefined && Math.abs(rowSum) !== Math.abs(totalMinor);
  return { lines, count: rows.length, skipped: errors.length, card, ai, totalMismatch };
}

interface Line {
  categoryId: string | null;
  amount: string;
  note: string;
  /** From a statement: the business (rules are learned for it) and how many charges it covers. */
  merchant?: string;
  count?: number;
  /** Amount in the payment's sign when loaded (for rule direction / AI). */
  minor?: number;
  /** The category AI suggested; while unchanged the line shows an AI mark and learns an `ai` rule. */
  aiCategoryId?: string;
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
  const [loaded, setLoaded] = useState<Omit<Loaded, 'lines'> | null>(null);
  const [learn, setLearn] = useState(true);
  const aiStatus = useAiStatus();
  const me = useMe();
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = lines.map((l) => parseMoneyInput(l.amount || '0'));
  const valid = parsed.every((p) => p !== null);
  const assigned = parsed.reduce<number>((a, p) => a + (p ?? 0), 0) * sign;
  const remaining = tx.amountMinor - assigned;
  // Businesses from the statement the user (or AI) gave a category: remembered as rules on save.
  const learnable = lines.filter((l) => l.merchant && l.categoryId && l.minor);
  const save = useApiMutation(
    async (body: { lines: { categoryId: string | null; amountMinor: number; note?: string }[] }) => {
      const r = await put(`/api/transactions/${tx.id}/splits`, body);
      if (learn && learnable.length && body.lines.length) {
        const items = learnable.slice(0, 30).map((l) => ({ description: l.merchant!, amountMinor: l.minor!, categoryId: l.categoryId!, source: l.categoryId === l.aiCategoryId ? ('ai' as const) : ('learned' as const) }));
        try {
          const res = await post<{ learned: number }>('/api/rules/learn', { items });
          if (res.learned) toast({ title: t('split.learned', { count: res.learned }) });
        } catch {
          // The split is saved; a failed rule write only means no rules this time.
        }
      }
      return r;
    },
    { invalidate: [...LEDGER_DEPENDENT, ['rules']], onSuccess: onDone, successKey: 'ledger.saved' },
  );
  const same = async () => {
    try {
      const r = await get<{ suggestion: { fromDate: string; lines: SplitLine[] } | null }>(`/api/transactions/${tx.id}/split-suggestion`);
      if (!r.suggestion) return setNoPrev(true);
      setLines(toLines(r.suggestion.lines, sign));
      setFrom(r.suggestion.fromDate);
      setLoaded(null);
    } catch (e) {
      toast({ title: t(errorKey(e), { defaultValue: t('errors.unknown') }), tone: 'bad' });
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      // Fresh status (AI may have been switched on since it was cached), fetched while the file is read.
      const hh = me?.active?.id ?? null;
      const aiFor = aiStatus.refetch().then(
        (q) => (q.data?.available && q.data.enabled ? hh : null),
        () => null,
      );
      const r = await loadStatement(file, tx.amountMinor, (count) => t('split.otherRows', { count }), aiFor);
      setLines(r.lines);
      setLoaded(r);
      setFrom(null);
    } catch (e) {
      const k = e instanceof FileError ? `import.fileErrors.${e.code}` : errorKey(e);
      toast({ title: t(k, { defaultValue: t('errors.unknown') }), description: e instanceof FileError && e.detail ? <span dir="ltr" className="block text-xs" data-testid="split-error-detail">{e.detail}</span> : undefined, tone: 'bad' });
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
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.html,.htm,.pdf,application/pdf" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} data-testid="split-file" />
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
      {!!loaded?.ai && (
        <p className="text-xs text-muted" data-testid="split-ai">
          {t('split.aiFilled', { count: loaded.ai })}
        </p>
      )}
      {loaded?.totalMismatch && (
        <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn" role="alert" data-testid="split-total-mismatch">
          {t('split.totalMismatch')}
        </p>
      )}
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
              {l.aiCategoryId && l.categoryId === l.aiCategoryId && (
                <Badge tone="accent" className="shrink-0">
                  <Sparkles className="size-3" aria-hidden />
                  AI
                </Badge>
              )}
              {/* Input is w-full: the wrapper sets the width so the row fits a phone. */}
              <div className="w-28 shrink-0">
                <AmountInput value={l.amount} onChange={(e) => upd(i, { amount: e.target.value })} aria-label={t('ledger.amount')} placeholder="0.00" />
              </div>
              <IconButton className="shrink-0" label={t('common.delete')} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length <= 2}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </div>
            {l.note && (
              <span className="truncate px-1 text-xs text-muted">
                <bdi>{l.note}</bdi>
                {(l.count ?? 0) > 1 && <span data-testid="split-line-count"> · {t('split.charges', { count: l.count })}</span>}
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
      {learnable.length > 0 && <Checkbox label={t('split.learn')} checked={learn} onChange={setLearn} testId="split-learn" />}
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
