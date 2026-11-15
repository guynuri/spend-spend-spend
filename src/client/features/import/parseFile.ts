import { sniffFile } from '../../../shared/import/sniff';
import type { FileKind, Grid, ParseResult } from '../../../shared/import/types';
import type { Mapping } from '../../../shared/import/generic';

export interface Parsed {
  fileName: string;
  fileHash: string;
  kind: FileKind;
  grid: Grid;
  parserId: 'otsar-hahayal' | 'generic';
  result: ParseResult | null;
  guess: Mapping | null;
  signature: string | null;
}

export class FileError extends Error {
  constructor(public code: string) {
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
    return { fileName: file.name, fileHash, kind: s.kind, grid, parserId: 'otsar-hahayal', result, guess: null, signature: null };
  }
  const guess = generic.guessMapping(grid);
  return { fileName: file.name, fileHash, kind: s.kind, grid, parserId: 'generic', result: null, guess, signature: generic.headerSignature(grid, guess.headerRow) };
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
