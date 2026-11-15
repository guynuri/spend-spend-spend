import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckSquare, ChevronLeft, ChevronRight, Download, Plus, Search, SlidersHorizontal, Upload } from 'lucide-react';
import { get, post } from '../../api';
import { Badge, Button, Checkbox, cx, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText, useFormatDate } from '../../components/DateText';
import { CategorySelect } from '../../components/CategorySelect';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useAccounts, useCategoryMap } from '../../lib/queries';
import { useCanWrite } from '../../lib/session';
import type { Tx, TxList } from '../../../shared/schemas/ledger';
import { useLedgerFilters } from './filters';
import { TxSheet } from './TxSheet';
import { AddTxSheet } from './AddTxSheet';
import { TxTitle } from '../../components/TxTitle';
import { UnsplitCardBanner } from './UnsplitCardBanner';
import { AiSuggestButton } from '../ai/AiSuggest';

function CategoryLabel({ tx }: { tx: Tx }) {
  const { t } = useTranslation();
  const cats = useCategoryMap();
  if (tx.hasSplits) return <Badge tone="accent">{t('ledger.splitBadge')}</Badge>;
  if (!tx.categoryId) return <Badge tone="warn">{t('ledger.uncategorized')}</Badge>;
  return <span className="truncate text-xs text-muted">{cats.get(tx.categoryId)?.name}</span>;
}

function FiltersSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const { f, set } = useLedgerFilters();
  const accounts = useAccounts().data?.accounts ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('ledger.filters')} testId="filters-sheet">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('ledger.from')} htmlFor="f-from">
            <Input id="f-from" type="date" value={f.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          </Field>
          <Field label={t('ledger.to')} htmlFor="f-to">
            <Input id="f-to" type="date" value={f.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </Field>
        </div>
        <Field label={t('ledger.account')} htmlFor="f-acc">
          <Select id="f-acc" data-testid="filter-account" value={f.account} onChange={(e) => set({ account: e.target.value })}>
            <option value="">{t('ledger.allAccounts')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('ledger.category')} htmlFor="f-cat">
          <CategorySelect id="f-cat" data-testid="filter-category" emptyLabel={t('ledger.allCategories')} value={f.category || null} onChange={(v) => set({ category: v ?? '', uncategorized: false })} />
        </Field>
        <Checkbox label={t('ledger.uncategorizedOnly')} checked={f.uncategorized} onChange={(v) => set({ uncategorized: v, category: v ? '' : f.category })} testId="filter-uncategorized" />
        <Button variant="ghost" onClick={() => set({ account: '', category: '', uncategorized: false, q: '', kind: '' })}>
          {t('ledger.clearFilters')}
        </Button>
      </div>
    </Sheet>
  );
}

export function Component() {
  const { t } = useTranslation();
  const toast = useToast();
  const canWrite = useCanWrite();
  const fmt = useFormatDate();
  const { f, set, isMonth, shiftMonth, apiQuery, activeCount } = useLedgerFilters();
  const accounts = useAccounts();
  const accMap = new Map((accounts.data?.accounts ?? []).map((a) => [a.id, a.name]));
  const [search, setSearch] = useState(f.q);
  const [open, setOpen] = useState<Tx | null>(null);
  const [adding, setAdding] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string | null>(null);
  // Debounced: only the q param is patched, on top of whatever the URL holds by then.
  useEffect(() => {
    const h = setTimeout(() => search.trim() !== f.q && set({ q: search.trim() }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // Keep the box in step with the URL when q changes elsewhere (Clear filters, back button).
  useEffect(() => {
    setSearch((cur) => (cur.trim() === f.q ? cur : f.q));
  }, [f.q]);

  const qs = apiQuery();
  const q = useInfiniteQuery({
    queryKey: ['transactions', qs],
    queryFn: ({ pageParam }) => get<TxList>(`/api/transactions?${qs}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const summary = q.data?.pages[0]?.summary;
  const groups = useMemo(() => {
    const m = new Map<string, Tx[]>();
    for (const tx of items) m.set(tx.date, [...(m.get(tx.date) ?? []), tx]);
    return [...m.entries()];
  }, [items]);
  const bulk = useApiMutation((v: { ids: string[]; categoryId: string | null }) => post<{ updated: number }>('/api/transactions/bulk', v), {
    invalidate: [...LEDGER_DEPENDENT],
    onSuccess: (r) => {
      toast({ title: t('ledger.bulkDone', { count: r.updated }), tone: 'good' });
      setSelected(new Set());
      setSelecting(false);
    },
  });
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const onRow = (tx: Tx) => (selecting ? toggle(tx.id) : setOpen(tx));
  const noAccounts = accounts.data && accounts.data.accounts.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('ledger.title')}
        actions={
          <>
            <IconButton label={t('ledger.export')} onClick={() => window.open(`/api/transactions/export.csv?${qs}`, '_blank')} data-testid="ledger-export">
              <Download className="size-5" aria-hidden />
            </IconButton>
            {canWrite && (
              <IconButton label={selecting ? t('ledger.cancelSelect') : t('ledger.select')} onClick={() => (setSelecting(!selecting), setSelected(new Set()))} data-testid="ledger-select">
                <CheckSquare className={cx('size-5', selecting && 'text-accent')} aria-hidden />
              </IconButton>
            )}
            {canWrite && (
              <Button onClick={() => setAdding(true)} data-testid="ledger-add" aria-label={t('ledger.add')}>
                <Plus className="size-5" aria-hidden />
                <span className="hidden sm:inline">{t('ledger.add')}</span>
              </Button>
            )}
          </>
        }
      />
      <div className="flex items-center justify-between gap-2">
        <IconButton label={t('ledger.prevMonth')} onClick={() => shiftMonth(-1)} data-testid="month-prev">
          <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <div className="text-center font-semibold" data-testid="ledger-range">
          {isMonth ? <DateText date={f.from.slice(0, 7)} format="month" /> : `${fmt(f.from)} – ${fmt(f.to)}`}
        </div>
        <IconButton label={t('ledger.nextMonth')} onClick={() => shiftMonth(1)} data-testid="month-next">
          <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
        </IconButton>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" dir="auto" className="ps-9" placeholder={t('ledger.searchPlaceholder')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="ledger-search" />
        </div>
        <Button variant="secondary" onClick={() => setFiltersOpen(true)} data-testid="ledger-filters" aria-label={t('ledger.filters')}>
          <SlidersHorizontal className="size-5" aria-hidden />
          {activeCount > 0 && <span className="rounded-full bg-accent px-1.5 text-xs text-accent-fg">{activeCount}</span>}
        </Button>
      </div>
      {f.uncategorized && (
        <div className="flex items-center gap-2">
          <Badge tone="warn">{t('ledger.uncategorizedOnly')}</Badge>
          <button type="button" className="min-h-11 text-sm text-accent" onClick={() => set({ uncategorized: false })}>
            {t('ledger.clearFilters')}
          </button>
        </div>
      )}
      <UnsplitCardBanner month={f.from.slice(0, 7)} />
      {f.uncategorized && <AiSuggestButton />}
      {summary && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted" data-testid="ledger-summary">
          <span data-count={summary.count}>{t('ledger.summary', { count: summary.count })}</span>
          <span className="flex gap-3">
            <span>
              {t('ledger.in')} <Money minor={summary.inMinor} className="text-good" />
            </span>
            <span>
              {t('ledger.out')} <Money minor={-summary.outMinor} className="text-text" />
            </span>
          </span>
        </div>
      )}
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('ledger.empty')}
          body={noAccounts ? t('ledger.noAccounts') : t('ledger.emptyBody')}
          action={
            <Link to={noAccounts ? '/accounts' : '/import'} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 font-medium text-accent-fg">
              <Upload className="size-4" aria-hidden />
              {noAccounts ? t('ledger.goAccounts') : t('ledger.importCta')}
            </Link>
          }
        />
      ) : (
        <>
          {/* phones: card list grouped by date */}
          <div className="flex flex-col gap-3 md:hidden" data-testid="ledger-list">
            {groups.map(([date, txs]) => (
              <section key={date}>
                <h3 className="mb-1 px-1 text-xs font-semibold text-muted">
                  <DateText date={date} format="weekday" />
                </h3>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                  {txs.map((tx) => (
                    <li key={tx.id}>
                      <button type="button" onClick={() => onRow(tx)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start active:bg-surface-2" data-testid="tx-row" data-tx={tx.id}>
                        {selecting && <input type="checkbox" readOnly checked={selected.has(tx.id)} className="size-5 shrink-0" aria-label={tx.description} />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            <TxTitle tx={tx} />
                          </div>
                          <div className="flex min-w-0 items-center gap-2">
                            <CategoryLabel tx={tx} />
                          </div>
                        </div>
                        <Money minor={tx.amountMinor} className={cx('text-sm font-semibold', tx.amountMinor > 0 && 'text-good')} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {/* ≥ 768 px: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface md:block">
            <table className="w-full text-sm" data-testid="ledger-table">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  {selecting && <th className="w-10" />}
                  <th className="px-3 py-2 text-start font-medium">{t('ledger.date')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ledger.description')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ledger.category')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ledger.account')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('ledger.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((tx) => (
                  <tr key={tx.id} onClick={() => onRow(tx)} className="cursor-pointer hover:bg-surface-2">
                    {selecting && (
                      <td className="px-3">
                        <input type="checkbox" readOnly checked={selected.has(tx.id)} className="size-4" aria-label={tx.description} />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2">
                      <DateText date={tx.date} />
                    </td>
                    <td className="max-w-80 truncate px-3 py-2">
                      <TxTitle tx={tx} />
                    </td>
                    <td className="px-3 py-2">
                      <CategoryLabel tx={tx} />
                    </td>
                    <td className="truncate px-3 py-2 text-muted">{accMap.get(tx.accountId)}</td>
                    <td className="px-3 py-2 text-end">
                      <Money minor={tx.amountMinor} className={cx('font-medium', tx.amountMinor > 0 && 'text-good')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.hasNextPage && (
            <Button variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} data-testid="ledger-more">
              {t('ledger.loadMore')}
            </Button>
          )}
        </>
      )}
      {selecting && selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-xl items-center gap-2 border-t border-border bg-surface p-3 shadow-lg lg:bottom-0" data-testid="bulk-bar">
          <span className="shrink-0 text-sm font-medium">{t('ledger.selected', { count: selected.size })}</span>
          <CategorySelect className="min-w-0 flex-1" value={bulkCat} onChange={setBulkCat} aria-label={t('ledger.setCategory')} data-testid="bulk-category" />
          <Button size="sm" busy={bulk.isPending} onClick={() => bulk.mutate({ ids: [...selected], categoryId: bulkCat })} data-testid="bulk-apply">
            {t('common.save')}
          </Button>
        </div>
      )}
      <TxSheet tx={open} onClose={() => setOpen(null)} />
      <AddTxSheet open={adding} onOpenChange={setAdding} />
      <FiltersSheet open={filtersOpen} onOpenChange={setFiltersOpen} />
    </div>
  );
}
