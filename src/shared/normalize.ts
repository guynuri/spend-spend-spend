const NIQQUD = /[֑-ׇ]/g;
const BIDI = /[‎‏‪-‮⁦-⁩؜]/g;

export const stripBidi = (s: string): string => s.replace(BIDI, '');

/** Canonical text form for search, rules and dedupe (PLAN §9.5). */
export function norm(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKC')
    .replace(NIQQUD, '')
    .replace(BIDI, '')
    .replace(/[״”“„]/g, '"')
    .replace(/[׳’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** norm() without digit runs of ≥ 4 (dates, card numbers, references in descriptions). */
export function normKey(s: string | null | undefined): string {
  return norm(s).replace(/\d{4,}/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cleans a spreadsheet string cell: bidi marks out, NBSP → space, trimmed. */
export const cleanCell = (s: string): string => stripBidi(s).replace(/\u00A0/g, ' ').trim();
