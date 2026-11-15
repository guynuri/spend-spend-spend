import { useSearchParams } from 'react-router';
import { addMonths, monthEnd, monthOf, monthStart } from '../../../shared/dates';
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

/** Ledger filters live in the URL query string (AC3.4). */
export function useLedgerFilters() {
  const [sp, setSp] = useSearchParams();
  const today = useMe()?.active?.today ?? new Date().toISOString().slice(0, 10);
  const m = monthOf(today);
  const f: LedgerFilters = {
    from: sp.get('from') ?? monthStart(m),
    to: sp.get('to') ?? monthEnd(m),
    account: sp.get('account') ?? '',
    category: sp.get('category') ?? '',
    uncategorized: sp.get('uncategorized') === '1',
    q: sp.get('q') ?? '',
    kind: sp.get('kind') ?? '',
  };
  const set = (patch: Partial<LedgerFilters>) => {
    const next = { ...f, ...patch };
    const p = new URLSearchParams();
    p.set('from', next.from);
    p.set('to', next.to);
    if (next.account) p.set('account', next.account);
    if (next.category) p.set('category', next.category);
    if (next.uncategorized) p.set('uncategorized', '1');
    if (next.q) p.set('q', next.q);
    if (next.kind) p.set('kind', next.kind);
    setSp(p, { replace: true });
  };
  const isMonth = f.from.slice(8) === '01' && f.to === monthEnd(monthOf(f.from));
  const shiftMonth = (n: number) => {
    const mm = addMonths(monthOf(f.from), n);
    set({ from: monthStart(mm), to: monthEnd(mm) });
  };
  const apiQuery = () => {
    const p = new URLSearchParams({ from: f.from, to: f.to });
    if (f.account) p.set('account', f.account);
    if (f.category) p.set('category', f.category);
    if (f.uncategorized) p.set('uncategorized', '1');
    if (f.q) p.set('q', f.q);
    if (f.kind) p.set('kind', f.kind);
    return p.toString();
  };
  return { f, set, isMonth, shiftMonth, apiQuery, activeCount: [f.account, f.category, f.uncategorized, f.kind].filter(Boolean).length };
}
