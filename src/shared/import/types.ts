export type Cell = string | number | null;
export type Grid = Cell[][];

export interface NormRow {
  /** 1-based row number in the source sheet. */
  row: number;
  date: string;
  valueDate?: string | null;
  amountMinor: number;
  description: string;
  reference?: string | null;
  operationType?: string | null;
  balanceMinor?: number | null;
  /** Occurrence index among identical (date, amount, reference, description) rows. */
  occ: number;
}

export type RowErrorCode = 'date_invalid' | 'amount_invalid' | 'description_missing' | 'amount_too_large';
export interface RowError {
  row: number;
  code: RowErrorCode;
}

export interface ParseResult {
  parserId: string;
  rows: NormRow[];
  errors: RowError[];
  period?: { from: string; to: string };
  accountMask?: string | null;
  closingBalance?: { date: string; minor: number } | null;
  warnings: ('balance_mismatch' | 'no_rows' | 'too_many_rows')[];
}

export interface BankParser {
  id: string;
  labelKey: string;
  detect(grid: Grid): number;
  parse(grid: Grid): ParseResult;
}

export type FileKind = 'xlsx' | 'xls' | 'html' | 'csv';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const IMPORT_CHUNK = 250;
