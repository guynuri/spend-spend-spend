import { otsarParser } from './otsar';
import { FORMAT_PARSERS } from './formats';
import type { BankParser, Grid } from './types';

export const PARSERS: BankParser[] = [otsarParser, ...FORMAT_PARSERS];

/** Highest-scoring parser with score ≥ 0.6, else null (→ generic mapper). */
export function pickParser(grid: Grid): BankParser | null {
  let best: { p: BankParser; s: number } | null = null;
  for (const p of PARSERS) {
    const s = p.detect(grid);
    if (s >= 0.6 && (!best || s > best.s)) best = { p, s };
  }
  return best?.p ?? null;
}
