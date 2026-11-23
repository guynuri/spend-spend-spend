import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LayoutGrid, Plus } from 'lucide-react';
import { post } from '../../api';
import { Sheet } from '../../components/Sheet';
import { Button, cx, Field, Input, Segmented, Select, Spinner, Textarea } from '../../components/ui';
import { AddCategorySheet } from '../../components/AddCategorySheet';
import { CategoryIcon } from '../../components/CategoryIcon';
import { useFormatDate } from '../../components/DateText';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useAccounts, useCategories } from '../../lib/queries';
import { useCanWrite, useCurrency, useMe } from '../../lib/session';
import { formatMoney, parseMoneyInput, type Locale } from '../../../shared/money';

const LS_ACCOUNT = 'mz_quick_account';
const LS_RECENT = 'mz_quick_recent';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};
const recentIds = (): string[] => {
  try {
    const v: unknown = JSON.parse(read(LS_RECENT) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
};

/** How many categories the quick grid shows before "More". */
const GRID = 7;

/**
 * Quick add (Buddy-style, D-R25): amount first, one tap on a category, save. Today and the last used
 * account are the defaults; date, account and notes sit behind "More details". The grid shows this
 * device's recently used categories first, then the household's in their usual order.
 */
export function AddTxSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const fmt = useFormatDate();
  const currency = useCurrency();
  const today = useMe()?.active?.today ?? '';
  const accQ = useAccounts();
  const catData = useCategories().data;
  const cats = useMemo(() => catData?.categories ?? [], [catData]);
  const accounts = (accQ.data?.accounts ?? []).filter((a) => !a.archived);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(() => read(LS_ACCOUNT) ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [details, setDetails] = useState(false);
  const [allCats, setAllCats] = useState(false);
  const [addingCat, setAddingCat] = useState(false);
  const canWrite = useCanWrite();
  // a sheet that stays mounted (the ledger page's) re-reads this device's last account and recent
  // categories each time it opens, so the category just used comes first
  const [opens, setOpens] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOpens((n) => n + 1);
      setAccountId(read(LS_ACCOUNT) ?? '');
    }
  }
  const minor = parseMoneyInput(amount);
  const acc = accounts.some((a) => a.id === accountId) ? accountId : (accounts[0]?.id ?? '');
  const kind = direction === 'out' ? 'expense' : 'income';
  // Recently used first (D-R29): this device's own picks, then the household's last use of each category,
  // then the usual order. Collapsed it shows GRID of them; "All" opens every one (and transfers) in place.
  const ordered = useMemo(() => {
    const usable = cats.filter((c) => (c.kind === kind || c.kind === 'transfer') && !c.archived && !c.systemKey);
    const mine = recentIds();
    const rank = (c: (typeof usable)[number]) => {
      const k = mine.indexOf(c.id);
      return k >= 0 ? k : mine.length;
    };
    return [...usable].sort(
      (x, y) =>
        Number(x.kind === 'transfer') - Number(y.kind === 'transfer') ||
        rank(x) - rank(y) ||
        (y.lastUsed ?? '').localeCompare(x.lastUsed ?? '') ||
        Number(!!x.parentId) - Number(!!y.parentId) ||
        x.sort - y.sort,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `opens` re-reads localStorage on each open
  }, [cats, kind, opens]);
  const grid = allCats ? ordered : ordered.filter((c) => c.kind === kind).slice(0, GRID);
  const picked = categoryId ? cats.find((c) => c.id === categoryId) : null;
  const create = useApiMutation(
    () => post('/api/transactions', { date, amountMinor: minor, direction, description: description.trim(), accountId: acc, categoryId, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    {
      invalidate: [...LEDGER_DEPENDENT],
      successKey: 'ledger.saved',
      onSuccess: () => {
        write(LS_ACCOUNT, acc);
        if (categoryId) write(LS_RECENT, JSON.stringify([categoryId, ...recentIds().filter((x) => x !== categoryId)].slice(0, 12)));
        setAmount('');
        setDescription('');
        setNotes('');
        setCategoryId(null);
        onOpenChange(false);
      },
    },
  );
  const ok = !!date && !!minor && minor > 0 && !!acc;
  const money = (m: number) => formatMoney(m, { currency, locale: i18n.language as Locale, decimals: m % 100 ? 2 : 0 });
  const accName = accounts.find((a) => a.id === acc)?.name ?? '';
  const symbol = formatMoney(0, { currency, locale: i18n.language as Locale, decimals: 0 }).replace(/[\d.,\s\u200e\u200f\u2066-\u2069-]/g, '');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('ledger.add')}
      testId="add-tx"
      footer={
        <Button className="w-full" disabled={!ok} busy={create.isPending} onClick={() => create.mutate(undefined)} data-testid="add-tx-save">
          {ok ? t(direction === 'out' ? 'quick.addExpense' : 'quick.addIncome', { amount: money(minor!) }) : t('common.save')}
        </Button>
      }
    >
      {accQ.isPending ? (
        <Spinner />
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted">{t('ledger.noAccounts')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center">
            <Segmented<'out' | 'in'>
              label={t('ledger.direction')}
              value={direction}
              onChange={(v) => {
                setDirection(v);
                setCategoryId(null);
              }}
              options={[
                { value: 'out', label: t('ledger.expense') },
                { value: 'in', label: t('ledger.income') },
              ]}
            />
          </div>
          {/* the amount, big and first (inline size: the global 16px input rule would otherwise win) */}
          <label className={cx('flex items-baseline justify-center gap-1', direction === 'in' ? 'text-good' : 'text-text')} dir="ltr">
            <span className="sr-only">{t('ledger.amount')}</span>
            <span className="text-3xl font-semibold text-muted" aria-hidden>
              {symbol}
            </span>
            <input
              id="add-amount"
              data-testid="add-amount"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              size={Math.max(1, amount.length)}
              style={{ fontSize: '3rem', lineHeight: 1.1 }}
              className="min-w-[1ch] max-w-full bg-transparent text-start font-bold tracking-tight tabular outline-none placeholder:text-border"
            />
          </label>
          <div>
            <p className="mb-2 text-sm font-medium text-muted">{t('ledger.category')}</p>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('ledger.category')} data-testid="quick-cats">
              {(picked && !grid.includes(picked) ? [picked, ...grid.slice(0, -1)] : grid).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={categoryId === c.id}
                  onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                  className={cx('flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl p-1 text-center transition', categoryId === c.id ? 'bg-accent/12 ring-2 ring-accent' : 'hover:bg-surface-2')}
                  data-testid="quick-cat"
                >
                  <CategoryIcon cat={c} />
                  <span className="line-clamp-2 text-[11px] leading-tight">{c.name}</span>
                  {c.parentId && <span className="line-clamp-1 text-[10px] leading-tight text-muted">{cats.find((p) => p.id === c.parentId)?.name}</span>}
                </button>
              ))}
              <button type="button" onClick={() => setAllCats((v) => !v)} className={cx('flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl p-1 text-center hover:bg-surface-2', allCats && 'bg-surface-2')} data-testid="quick-cat-more" aria-expanded={allCats}>
                <span className="flex size-9 items-center justify-center rounded-full bg-surface-2">
                  <LayoutGrid className="size-4 text-muted" aria-hidden />
                </span>
                <span className="text-[11px] leading-tight">{t(allCats ? 'quick.fewer' : 'quick.allCategories')}</span>
              </button>
              {allCats && canWrite && (
                <button type="button" onClick={() => setAddingCat(true)} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border p-1 text-center hover:bg-surface-2" data-testid="quick-cat-new">
                  <span className="flex size-9 items-center justify-center rounded-full bg-surface-2">
                    <Plus className="size-4 text-accent" aria-hidden />
                  </span>
                  <span className="text-[11px] leading-tight">{t('quick.newCategory')}</span>
                </button>
              )}
            </div>
          </div>
          <Input id="add-desc" dir="auto" data-testid="add-description" placeholder={t('quick.whatWasIt')} aria-label={t('ledger.description')} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          <button type="button" onClick={() => setDetails((v) => !v)} className="flex min-h-11 items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3 text-sm" aria-expanded={details} data-testid="add-details">
            <span className="min-w-0 truncate text-muted">
              {date === today ? t('common.today') : fmt(date, 'dayMonth')} · <bdi>{accName}</bdi>
            </span>
            <span className="flex shrink-0 items-center gap-1 font-medium text-accent">
              {t('quick.moreDetails')}
              <ChevronDown className={cx('size-4 transition', details && 'rotate-180')} aria-hidden />
            </span>
          </button>
          {details && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
                <Field label={t('ledger.date')} htmlFor="add-date">
                  <Input id="add-date" type="date" data-testid="add-date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label={t('ledger.account')} htmlFor="add-acc">
                  <Select id="add-acc" value={acc} onChange={(e) => setAccountId(e.target.value)} data-testid="add-account">
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={t('ledger.notes')} htmlFor="add-notes">
                <Textarea id="add-notes" dir="auto" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      )}
      {addingCat && <AddCategorySheet open onOpenChange={setAddingCat} kinds={[kind]} onAdded={(id) => setCategoryId(id)} />}
    </Sheet>
  );
}
