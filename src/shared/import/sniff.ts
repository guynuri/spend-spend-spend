import { MAX_FILE_BYTES, type FileKind } from './types';

export type SniffResult = { ok: true; kind: FileKind } | { ok: false; error: 'file_too_large' | 'file_type' | 'unsupported_file' | 'file_empty' };

const EXT = /\.(xlsx|xls|csv)$/i;

/** Validates size and extension, then decides the real format from the bytes (PLAN §9.1.1). */
export function sniffFile(name: string, size: number, head: Uint8Array): SniffResult {
  if (size > MAX_FILE_BYTES) return { ok: false, error: 'file_too_large' };
  if (!EXT.test(name)) return { ok: false, error: 'file_type' };
  if (size === 0 || head.length === 0) return { ok: false, error: 'file_empty' };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return { ok: true, kind: 'xlsx' };
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return { ok: true, kind: 'xls' };
  // Text: reject obvious binaries (NUL bytes outside UTF-16).
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (!utf16 && head.slice(0, 512).some((b) => b === 0)) return { ok: false, error: 'unsupported_file' };
  const text = decodeText(head.slice(0, 4096)).replace(/^\uFEFF/, '').trimStart();
  if (text.startsWith('<') && /<table/i.test(text)) return { ok: true, kind: 'html' };
  return { ok: true, kind: 'csv' };
}

/** UTF-8/UTF-16 by BOM; else strict UTF-8; else windows-1255 (PLAN §9.1.2). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1255').decode(bytes);
  }
}
