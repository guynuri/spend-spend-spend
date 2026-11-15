import { norm, normKey } from '../normalize';
import type { NormRow } from './types';

/** Assigns occ = 1, 2, … to identical (date, amount, reference, description) rows, in order (PLAN §9.1.6). */
export function assignOccurrences<T extends Omit<NormRow, 'occ'>>(rows: T[]): (T & { occ: number })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = `${r.date}|${r.amountMinor}|${norm(r.reference ?? '')}|${norm(r.description)}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...r, occ: n };
  });
}

/** v1|date|amount|norm(reference)|normKey(description)|occ (PLAN §9.4). */
export function dedupeKey(r: { date: string; amountMinor: number; reference?: string | null; description: string; occ: number }): string {
  return `v1|${r.date}|${r.amountMinor}|${norm(r.reference ?? '')}|${normKey(r.description)}|${r.occ}`;
}
