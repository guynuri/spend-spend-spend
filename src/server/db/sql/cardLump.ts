import { CARD_ISSUER_PATTERNS } from '../../../shared/domain/constants';

/** SQL predicate on `col` (a normKey'd description) for card-issuer lumps; params start at `from`. */
export function cardLumpPredicate(col: string, from: number) {
  const params: string[] = [];
  const parts = CARD_ISSUER_PATTERNS.map((p) => {
    params.push(p);
    const n = from + params.length - 1;
    return /^[a-z ]+$/.test(p) ? `instr(' ' || ${col} || ' ', ' ' || ?${n} || ' ') > 0` : `instr(${col}, ?${n}) > 0`;
  });
  return { sql: `(${parts.join(' OR ')})`, params };
}
