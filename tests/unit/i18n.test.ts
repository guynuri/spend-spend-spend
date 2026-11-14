import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/en.json';
import he from '../../src/shared/i18n/he.json';

type Tree = { [k: string]: string | Tree };
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(t: Tree, p = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

const E = flatten(en as Tree);
const H = flatten(he as Tree);
const base = (k: string) => k.replace(PLURAL, '');

describe('i18n catalogs', () => {
  it('have identical key sets (plural forms compared by base key)', () => {
    const eb = new Set(Object.keys(E).map(base));
    const hb = new Set(Object.keys(H).map(base));
    expect([...eb].filter((k) => !hb.has(k))).toEqual([]);
    expect([...hb].filter((k) => !eb.has(k))).toEqual([]);
  });
  it('have every plural category each locale needs', () => {
    for (const [cat, lang] of [[E, 'en'], [H, 'he']] as const) {
      const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const plurals = new Set(Object.keys(cat).filter((k) => PLURAL.test(k)).map(base));
      for (const b of plurals) for (const c of cats) expect(cat[`${b}_${c}`], `${lang}:${b}_${c}`).toBeTypeOf('string');
    }
  });
  it('use the same interpolation variables', () => {
    for (const k of Object.keys(E)) {
      const hk = H[k] !== undefined ? k : `${base(k)}_other`;
      if (H[hk] === undefined) continue;
      const ev = vars(E[k]!).filter((v) => v !== 'count');
      const hv = vars(H[hk]!).filter((v) => v !== 'count');
      expect(hv, k).toEqual(ev);
    }
  });
  it('have no empty values', () => {
    for (const [k, v] of [...Object.entries(E), ...Object.entries(H)]) expect(v.trim(), k).not.toBe('');
  });
});
