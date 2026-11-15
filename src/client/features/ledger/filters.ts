import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { addMonths, isValidDate, monthEnd, monthOf, monthStart } from '../../../shared/dates';
import { useMe } from '../../lib/session';

export interface LedgerFilters {
  from: string;
  to: string;
  account: string;
  category: string;
  uncategorized: boolean;
  q: string;
  kind: string;
}

function read(sp: URLSearchParams, today: string): LedgerFilters {
  const m = monthOf(today);
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  // Missing, empty or malformed dates fall back to the current month (e.g. `?from=&to=`).
  const valid = isValidDate(from) && isValidDate(to) && from <= to;
  return {
    from: valid ? from : monthStart(m),
    to: valid ? to : monthEnd(m),
    account: sp.get('account') ?? '',
    category: sp.get('category') ?? '',
    uncategorized: sp.get('uncategorized') === '1',
    q: sp.get('q') ?? '',
    kind: sp.get('kind') ?? '',
  };
}

function write(f: LedgerFilters) {
  const p = new URLSearchParams();
  p.set('from', f.from);
  p.set('to', f.to);
  if (f.account) p.set('account', f.account);
  if (f.category) p.set('category', f.category);
  if (f.uncategorized) p.set('uncategorized', '1');
  if (f.q) p.set('q', f.q);
  if (f.kind) p.set('kind', f.kind);
  return p;
}

/** Ledger filters live in the URL query string (AC3.4). */
export function useLedgerFilters() {
  const [sp, setSp] = useSearchParams();
  const today = useMe()?.active?.today ?? new Date().toISOString().slice(0, 10);
  const f = read(sp, today);
  // Patches are applied to the URL as it is *now*, so a late (debounced) update never undoes a
  // filter or month change made in the meantime.
  const set = useCallback((patch: Partial<LedgerFilters>) => setSp((prev) => write({ ...read(prev, today), ...patch }), { replace: true }), [setSp, today]);
  const isMonth = f.from.slice(8) === '01' && f.to === monthEnd(monthOf(f.from));
  const shiftMonth = (n: number) => {
    const mm = addMonths(monthOf(f.from), n);
    set({ from: monthStart(mm), to: monthEnd(mm) });
  };
  const apiQuery = () => {
    const p = write(f);
    return p.toString();
  };
  return { f, set, isMonth, shiftMonth, apiQuery, activeCount: [f.account, f.category, f.uncategorized, f.kind].filter(Boolean).length };
}
