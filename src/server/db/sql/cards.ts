/**
 * Links bank card charges to credit-card accounts and books them (D-R20). A linked charge gets split lines
 * the app owns: the bill payment (transfer category) and the part not itemized yet ("card not split"
 * category, still spending). Run after anything that changes card purchases, charges or card accounts;
 * it rewrites only linked charges, so it is cheap and idempotent.
 */
import { cardPaymentParts, chooseCardAccount, cycleMonth, type CardAccountIn } from '../../../shared/domain/cards';
import { newId, nowIso } from '../../lib/crypto';
import type { TenantDb } from '../tenant';

export const NEVER_LINK = 'none';

interface Lump {
  id: string;
  date: string;
  amount_minor: number;
  description_norm: string;
  card_account_id: string | null;
  has_splits: number;
  category_id: string | null;
}

export async function refreshCardPayments(q: TenantDb): Promise<void> {
  const [accs, lumps, cov, cats] = await q.batch([
    q.stmt("SELECT id, bank_id, account_mask FROM accounts WHERE household_id = ?1 AND type = 'credit_card' AND archived = 0"),
    // linked charges, and placeholder ones that could be linked (never a charge the user split or categorized)
    q.stmt(
      `SELECT t.id, t.date, t.amount_minor, t.description_norm, t.card_account_id, t.has_splits, t.category_id FROM transactions t
        WHERE t.household_id = ?1 AND t.kind = 'card_lump' AND t.amount_minor < 0
          AND ((t.card_account_id IS NOT NULL AND t.card_account_id <> '${NEVER_LINK}')
            OR (t.card_account_id IS NULL AND t.has_splits = 0
                AND (t.category_id IS NULL OR t.category_id IN (SELECT id FROM categories WHERE household_id = ?1 AND system_key = 'card_unsplit'))))`,
    ),
    // purchases per card account and month, net of refunds
    q.stmt(
      `SELECT t.account_id AS a, substr(t.date, 1, 7) AS m, -SUM(t.amount_minor) AS s FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.household_id = ?1 AND a.type = 'credit_card'
        WHERE t.household_id = ?1 GROUP BY t.account_id, m`,
    ),
    q.stmt("SELECT id, system_key FROM categories WHERE household_id = ?1 AND system_key IN ('transfer', 'card_unsplit')"),
  ]);
  const accounts: CardAccountIn[] = (accs!.results as { id: string; bank_id: string | null; account_mask: string | null }[]).map((a) => ({ id: a.id, bankId: a.bank_id, mask: a.account_mask }));
  const all = lumps!.results as unknown as Lump[];
  if (!accounts.length && !all.some((l) => l.card_account_id)) return;
  const covered = new Map((cov!.results as { a: string; m: string; s: number }[]).map((r) => [`${r.a}|${r.m}`, r.s ?? 0]));
  const coveredIn = (a: string, m: string) => covered.get(`${a}|${m}`) ?? 0;
  const catOf = new Map((cats!.results as { id: string; system_key: string }[]).map((c) => [c.system_key, c.id]));
  const transfer = catOf.get('transfer') ?? null;
  const unsplit = catOf.get('card_unsplit') ?? null;
  const active = new Set(accounts.map((a) => a.id));

  const book: { id: string; acc: string; lines: { cat: string | null; amount: number }[] }[] = [];
  const unlink: string[] = [];
  for (const l of all) {
    let acc = l.card_account_id && active.has(l.card_account_id) ? l.card_account_id : null;
    // a link to an archived / deleted card account falls back to the placeholder
    if (!acc && l.card_account_id) {
      unlink.push(l.id);
      continue;
    }
    // only charges from the month before the card account's first purchase on are linked automatically,
    // so years of history don't silently change shape (an older charge can still be linked by hand)
    if (!acc) {
      acc = chooseCardAccount({ descriptionNorm: l.description_norm, amountMinor: l.amount_minor, date: l.date }, accounts, coveredIn);
      if (!acc || !firstMonthOk(acc, l.date, covered)) continue;
    }
    const { paidMinor, unitemizedMinor } = cardPaymentParts(l.amount_minor, coveredIn(acc, cycleMonth(l.date)));
    const lines = [
      ...(paidMinor ? [{ cat: transfer, amount: -paidMinor }] : []),
      ...(unitemizedMinor ? [{ cat: unsplit, amount: -unitemizedMinor }] : []),
    ];
    book.push({ id: l.id, acc, lines });
  }
  if (!book.length && !unlink.length) return;
  const now = nowIso();
  const ids = JSON.stringify([...book.map((b) => b.id), ...unlink]);
  const splitRows = book.flatMap((b) => b.lines.map((x) => ({ id: newId(), transaction_id: b.id, category_id: x.cat, amount_minor: x.amount, note: null })));
  await q.batch([
    q.stmt('DELETE FROM transaction_splits WHERE household_id = ?1 AND transaction_id IN (SELECT value FROM json_each(?2))', ids),
    ...(splitRows.length ? q.bulkInsertStmts('transaction_splits', Object.keys(splitRows[0]!), splitRows) : []),
    ...(book.length
      ? [
          q.stmt(
            `UPDATE transactions SET card_account_id = j.acc, has_splits = 1, category_id = ?3, category_source = 'rule', updated_at = ?4
               FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.acc') AS acc FROM json_each(?2)) AS j
              WHERE transactions.household_id = ?1 AND transactions.id = j.id`,
            JSON.stringify(book.map((b) => ({ id: b.id, acc: b.acc }))),
            transfer,
            now,
          ),
        ]
      : []),
    ...(unlink.length ? [unlinkStmt(q, unlink, unsplit, now)] : []),
  ]);
}

/** Back to the "card (not split)" placeholder; `never` also stops automatic linking for these charges. */
export function unlinkStmt(q: TenantDb, ids: string[], unsplitCat: string | null, now: string, never = false) {
  return q.stmt(
    `UPDATE transactions SET card_account_id = ?3, has_splits = 0, category_id = ?4, category_source = 'rule', updated_at = ?5
      WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND kind = 'card_lump'`,
    JSON.stringify(ids),
    never ? NEVER_LINK : null,
    unsplitCat,
    now,
  );
}

/** A charge in month M is linked automatically once the card account has purchases in M − 1 or earlier. */
function firstMonthOk(acc: string, chargeDate: string, covered: Map<string, number>) {
  const first = [...covered.keys()].filter((k) => k.startsWith(`${acc}|`)).map((k) => k.slice(acc.length + 1)).sort()[0];
  return !!first && first <= cycleMonth(chargeDate);
}
