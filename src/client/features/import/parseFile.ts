import { sniffFile } from '../../../shared/import/sniff';
import type { FileKind, Grid, ParseResult } from '../../../shared/import/types';
import { findProfile, headerSignature, type Mapping } from '../../../shared/import/generic';

export interface Parsed {
  fileName: string;
  fileHash: string;
  kind: FileKind;
  grid: Grid;
  parserId: string;
  /** Catalog banks that export this layout (empty for generic). */
  bankIds: readonly string[];
  /** Card-issuer statement. The import page refuses these (PLAN D-10); parseCardStatement accepts only these. */
  card: boolean;
  result: ParseResult | null;
  guess: Mapping | null;
  signature: string | null;
}

export class FileError extends Error {
  /** Optional technical detail shown under the message (e.g. why a PDF couldn't be read). */
  constructor(
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}

async function sha256(bytes: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Everything happens in the browser; the raw file never leaves the device (AC4.2). */
export async function parseFile(file: File): Promise<Parsed> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const s = sniffFile(file.name, file.size, head);
  if (!s.ok) throw new FileError(s.error);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const [{ toGrid }, { pickParser }, generic] = await Promise.all([import('../../../shared/import/grid'), import('../../../shared/import/registry'), import('../../../shared/import/generic')]);
  let grid: Grid;
  try {
    grid = toGrid(s.kind, bytes);
  } catch {
    throw new FileError('unsupported_file');
  }
  const fileHash = await sha256(bytes);
  const p = pickParser(grid);
  if (p) {
    const result = p.parse(grid);
    if (!result.rows.length && !result.errors.length) throw new FileError('no_rows');
    return { fileName: file.name, fileHash, kind: s.kind, grid, parserId: p.id, bankIds: p.bankIds ?? [], card: !!p.card, result, guess: null, signature: null };
  }
  const guess = generic.guessMapping(grid);
  return { fileName: file.name, fileHash, kind: s.kind, grid, parserId: 'generic', bankIds: [], card: false, result: null, guess, signature: generic.headerSignature(grid, guess.headerRow) };
}

/**
 * Card-issuer statement (Isracard/Amex, Max, Cal) → rows, charges negative, refunds positive.
 * Throws FileError: sniff codes, 'unsupported_file', 'no_rows', or 'not_card' for any other file.
 */
export async function parseCardStatement(file: File): Promise<ParseResult & { bankIds: readonly string[] }> {
  const p = await parseFile(file);
  if (!p.card || !p.result) throw new FileError('not_card');
  return { ...p.result, bankIds: p.bankIds };
}

/**
 * The one place that decides how a parsed file continues for an account: a saved mapping for its
 * header wins over format detection (same description column ⇒ same dedupe keys on re-import).
 */
export function decideParse(p: Parsed, profiles: Map<string, Mapping>, current?: Mapping | null): { result: ParseResult } | { mapping: Mapping; signature: string | null; profileUsed: boolean } {
  const prof = findProfile(p.grid, profiles);
  if (!prof && p.result) return { result: p.result };
  if (prof) return { mapping: prof.mapping, signature: prof.signature, profileUsed: true };
  // no saved mapping for this account: keep what the user mapped so far, else the guess
  const m = current ?? p.guess!;
  return { mapping: m, signature: headerSignature(p.grid, m.headerRow), profileUsed: false };
}

export function errorReportCsv(errors: { row: number; code: string }[], label: (code: string) => string) {
  const lines = ['row,code,reason', ...errors.map((e) => `${e.row},${e.code},"${label(e.code).replace(/"/g, '""')}"`)];
  return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
