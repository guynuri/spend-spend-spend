import { z } from 'zod';
import { isValidDate } from '../dates';
import { dateStr, id, text } from './common';
import type { NormRow } from '../import/types';
import { PARSER_IDS } from '../import/formats';

export interface WireRow {
  row: number;
  date: string;
  valueDate: string | null;
  amountMinor: number;
  description: string;
  reference: string | null;
  operationType: string | null;
  balanceMinor: number | null;
  occ: number;
}

export const toWire = (r: NormRow): WireRow => ({
  row: r.row,
  date: r.date,
  valueDate: r.valueDate ?? null,
  amountMinor: r.amountMinor,
  description: r.description.slice(0, 300),
  reference: r.reference ? r.reference.slice(0, 60) : null,
  operationType: r.operationType ? r.operationType.slice(0, 60) : null,
  balanceMinor: r.balanceMinor ?? null,
  occ: r.occ,
});

/**
 * Fast structural validation of import rows (PLAN §9.4): a hand-written loop, not zod per row.
 * Returns the cleaned rows or the index of the first bad row.
 */
export function validateRows(input: unknown, max = 250): { ok: true; rows: WireRow[] } | { ok: false; index: number; reason: string } {
  if (!Array.isArray(input)) return { ok: false, index: -1, reason: 'rows_not_array' };
  if (input.length > max) return { ok: false, index: max, reason: 'too_many_rows' };
  const out: WireRow[] = [];
  const isInt = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
  const optStr = (v: unknown, n: number) => v === null || v === undefined || (typeof v === 'string' && v.length <= n);
  for (let i = 0; i < input.length; i++) {
    const r = input[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object') return { ok: false, index: i, reason: 'row' };
    if (!isInt(r.row) || (r.row as number) < 1 || (r.row as number) > 100000) return { ok: false, index: i, reason: 'row' };
    if (typeof r.date !== 'string' || !isValidDate(r.date)) return { ok: false, index: i, reason: 'date' };
    if (r.valueDate !== null && r.valueDate !== undefined && (typeof r.valueDate !== 'string' || !isValidDate(r.valueDate))) return { ok: false, index: i, reason: 'valueDate' };
    if (!isInt(r.amountMinor) || Math.abs(r.amountMinor as number) > 1e11 || r.amountMinor === 0) return { ok: false, index: i, reason: 'amount' };
    if (typeof r.description !== 'string' || !r.description.trim() || r.description.length > 300) return { ok: false, index: i, reason: 'description' };
    if (!optStr(r.reference, 60) || !optStr(r.operationType, 60)) return { ok: false, index: i, reason: 'text' };
    if (r.balanceMinor !== null && r.balanceMinor !== undefined && (!isInt(r.balanceMinor) || Math.abs(r.balanceMinor as number) > 1e11)) return { ok: false, index: i, reason: 'balance' };
    if (!isInt(r.occ) || (r.occ as number) < 1 || (r.occ as number) > 99) return { ok: false, index: i, reason: 'occ' };
    out.push({
      row: r.row as number,
      date: r.date,
      valueDate: (r.valueDate as string | null) ?? null,
      amountMinor: r.amountMinor as number,
      description: r.description.trim(),
      reference: (r.reference as string | null) ?? null,
      operationType: (r.operationType as string | null) ?? null,
      balanceMinor: (r.balanceMinor as number | null) ?? null,
      occ: r.occ as number,
    });
  }
  return { ok: true, rows: out };
}

export const importCreate = z
  .object({
    accountId: id,
    parserId: z.enum(PARSER_IDS),
    fileName: text(120),
    fileHash: z.string().regex(/^[0-9a-f]{64}$/),
    period: z.object({ from: dateStr, to: dateStr }).nullable(),
    rowsTotal: z.number().int().min(0).max(5000),
    rowsError: z.number().int().min(0).max(100000),
    closingBalance: z.object({ date: dateStr, minor: z.number().int().min(-1e11).max(1e11) }).nullable(),
  })
  .strict();

export type RowStatus = 'new' | 'duplicate' | 'matches_manual';
export interface PreviewRow {
  row: number;
  status: RowStatus;
  categoryId: string | null;
  kind: 'normal' | 'card_lump';
}
export interface PreviewResponse {
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
}
export interface ImportSummary {
  id: string;
  accountId: string;
  parserId: string;
  fileName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rowsTotal: number;
  rowsInserted: number;
  rowsDuplicate: number;
  rowsMerged: number;
  rowsError: number;
  status: 'open' | 'committed' | 'undone';
  createdAt: string;
  closingBalanceMinor: number | null;
  closingDate: string | null;
}
export const profilePut = z
  .object({
    accountId: id,
    headerSignature: z.string().min(1).max(2000),
    mapping: z.object({
      headerRow: z.number().int().min(0).max(1000),
      columns: z.record(z.string(), z.number().int().min(0).max(200)),
      dateFormat: z.enum(['serial', 'dmy', 'mdy', 'ymd']),
      negate: z.boolean(),
    }),
  })
  .strict();
