import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { addMonths, isValidDate } from '../../../shared/dates';
import type { Cal } from '../../../shared/period';
import { useCal, useMe } from '../../lib/session';

export interface LedgerFilters {
  from: string;
  to: string;
  account: string;
  category: string;
  uncategorized: boolean;
  q: string;
  kind: string;
}

function read(sp: URLSearchParams, today: string, cal: Cal): LedgerFilters {
  const m = cal.of(today);
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  // Missing, empty or malformed dates fall back to the current budget period (e.g. `?from=&to=`).
  const valid = isValidDate(from) && isValidDate(to) && from <= to;
  return {
    from: valid ? from : cal.start(m),
    to: valid ? to : cal.end(m),
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
  const cal = useCal();
  const f = read(sp, today, cal);
  // Patches are applied to the URL as it is *now*, so a late (debounced) update never undoes a
  // filter or month change made in the meantime.
  const set = useCallback((patch: Partial<LedgerFilters>) => setSp((prev) => write({ ...read(prev, today, cal), ...patch }), { replace: true }), [setSp, today, cal]);
  // a whole budget period (a calendar month when the pay day is the 1st)
  const period = cal.of(f.from);
  const isMonth = f.from === cal.start(period) && f.to === cal.end(period);
  const shiftMonth = (n: number) => {
    const mm = addMonths(period, n);
    set({ from: cal.start(mm), to: cal.end(mm) });
  };
  const apiQuery = () => {
    const p = write(f);
    return p.toString();
  };
  return { f, set, isMonth, period, shiftMonth, apiQuery, activeCount: [f.account, f.category, f.uncategorized, f.kind].filter(Boolean).length };
}
