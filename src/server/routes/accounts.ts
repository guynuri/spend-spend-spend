import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound } from '../http';
import { accountCreate, accountPatch, balanceSet, type Account } from '../../shared/schemas/ledger';
import { newId, nowIso } from '../lib/crypto';
import { householdToday } from '../lib/today';
import { balancesAt, snapshotsAndVariance } from '../db/sql/balances';
import { refreshCardPayments } from '../db/sql/cards';

export const accountRoutes = tenantGroup();

/** Stored type: 'investment' lives as type 'savings' + is_investment = 1 (migration 0015). */
type StoredType = Exclude<Account['type'], 'investment'>;
const stored = (t: Account['type']): { type: StoredType; is_investment: number } => (t === 'investment' ? { type: 'savings', is_investment: 1 } : { type: t, is_investment: 0 });

interface Row {
  id: string;
  name: string;
  type: StoredType;
  is_investment: number;
  institution: string | null;
  bank_id: string | null;
  account_mask: string | null;
  opening_balance_minor: number;
  opening_date: string | null;
  include_in_forecast: number;
  is_liquid: number;
  archived: number;
  owner_user_id: string | null;
}

/** An owner must be a member of this household. */
async function checkOwner(db: ReturnType<typeof tctx>['db'], owner: string | null | undefined) {
  if (!owner) return;
  if (!(await db.first('SELECT 1 FROM memberships WHERE household_id = ?1 AND user_id = ?2', owner))) throw new HttpError(400, 'not_a_member', 'Not a member of this household');
}

accountRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const today = householdToday(hh);
  const [rows, bals, snaps, paid] = await Promise.all([
    db.all<Row>('SELECT * FROM accounts WHERE household_id = ?1 ORDER BY archived, created_at'),
    balancesAt(db, today),
    snapshotsAndVariance(db),
    // card bills paid from the bank (linked card charges): their bill-payment part lowers what the card
    // account owes; the part no purchase explains yet ("card not split") was never owed by the account
    db.all<{ a: string; s: number }>(
      `SELECT t.card_account_id AS a, -SUM(sp.amount_minor) AS s FROM transactions t
         JOIN transaction_splits sp ON sp.transaction_id = t.id AND sp.household_id = ?1
         LEFT JOIN categories c ON c.id = sp.category_id AND c.household_id = ?1
        WHERE t.household_id = ?1 AND t.kind = 'card_lump' AND t.card_account_id IS NOT NULL AND t.card_account_id <> 'none' AND t.date <= ?2
          AND COALESCE(c.system_key, '') <> 'card_unsplit'
        GROUP BY t.card_account_id`,
      today,
    ),
  ]);
  const bm = new Map(bals.map((b) => [b.account_id, b]));
  const pm = new Map(paid.map((p) => [p.a, p.s]));
  const sm = new Map(snaps.map((s) => [s.account_id, s]));
  const accounts: Account[] = rows.map((r) => {
    const s = sm.get(r.id);
    const investment = r.is_investment === 1;
    return {
      id: r.id,
      name: r.name,
      type: investment ? 'investment' : r.type,
      institution: r.institution,
      bankId: r.bank_id,
      accountMask: r.account_mask,
      openingBalanceMinor: r.opening_balance_minor,
      openingDate: r.opening_date,
      includeInForecast: r.include_in_forecast === 1,
      isLiquid: r.is_liquid === 1,
      archived: r.archived === 1,
      ownerUserId: r.owner_user_id ?? null,
      balanceMinor: (bm.get(r.id)?.balance ?? r.opening_balance_minor) + (r.type === 'credit_card' ? (pm.get(r.id) ?? 0) : 0),
      balanceDate: today,
      // An investment balance moves with the market, so a gap vs. transactions is expected, not an error.
      varianceMinor: investment ? null : (s?.variance ?? null),
      latestSnapshot: s?.date ? { date: s.date, balanceMinor: s.balance_minor!, source: s.source! } : null,
    };
  });
  return c.json({ accounts, asOf: today });
});

accountRoutes.post('/', async (c) => {
  const b = await body(c, accountCreate);
  const { db, userId } = tctx(c);
  await checkOwner(db, b.ownerUserId);
  const id = newId();
  await db.batch([
    db.insertStmt('accounts', {
      id,
      name: b.name,
      ...stored(b.type),
      institution: b.institution || null,
      bank_id: b.bankId ?? null,
      account_mask: b.accountMask || null,
      opening_balance_minor: b.openingBalanceMinor ?? 0,
      opening_date: b.openingDate ?? null,
      include_in_forecast: b.includeInForecast ?? (b.type === 'checking' ? 1 : 0),
      is_liquid: b.isLiquid ?? (b.type === 'credit_card' || b.type === 'investment' ? 0 : 1),
      owner_user_id: b.ownerUserId ?? null,
      created_at: nowIso(),
    }),
    db.audit(userId, 'account.create', 'account', id),
  ]);
  await refreshCardPayments(db);
  return c.json({ id }, 201);
});

accountRoutes.patch('/:id', async (c) => {
  const b = await body(c, accountPatch);
  const { db } = tctx(c);
  const id = c.req.param('id');
  await checkOwner(db, b.ownerUserId);
  const r = await db.run(
    `UPDATE accounts SET name = COALESCE(?3, name), type = COALESCE(?4, type), institution = COALESCE(?5, institution),
       account_mask = COALESCE(?6, account_mask), opening_balance_minor = COALESCE(?7, opening_balance_minor),
       opening_date = CASE WHEN ?8 = 1 THEN ?9 ELSE opening_date END,
       include_in_forecast = COALESCE(?10, include_in_forecast), is_liquid = COALESCE(?11, is_liquid), archived = COALESCE(?12, archived),
       bank_id = CASE WHEN ?13 = 1 THEN ?14 ELSE bank_id END, is_investment = COALESCE(?15, is_investment),
       owner_user_id = CASE WHEN ?16 = 1 THEN ?17 ELSE owner_user_id END
     WHERE household_id = ?1 AND id = ?2`,
    id,
    b.name ?? null,
    b.type ? stored(b.type).type : null,
    b.institution ?? null,
    b.accountMask ?? null,
    b.openingBalanceMinor ?? null,
    b.openingDate !== undefined ? 1 : 0,
    b.openingDate ?? null,
    b.includeInForecast ?? null,
    b.isLiquid ?? null,
    b.archived ?? null,
    b.bankId !== undefined ? 1 : 0,
    b.bankId ?? null,
    b.type ? stored(b.type).is_investment : null,
    b.ownerUserId !== undefined ? 1 : 0,
    b.ownerUserId ?? null,
  );
  if (!r.meta.changes) throw notFound();
  await refreshCardPayments(db);
  return c.json({ ok: true });
});

/** Deletes an unused account; an account with transactions is archived instead. */
accountRoutes.delete('/:id', async (c) => {
  const { db, userId } = tctx(c);
  const id = c.req.param('id');
  if (!(await db.owns('accounts', id))) throw notFound();
  const used = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?1 AND account_id = ?2', id);
  if (used!.n > 0) {
    await db.run('UPDATE accounts SET archived = 1 WHERE household_id = ?1 AND id = ?2', id);
    await refreshCardPayments(db);
    return c.json({ archived: true });
  }
  await db.batch([db.stmt('DELETE FROM accounts WHERE household_id = ?1 AND id = ?2', id), db.audit(userId, 'account.delete', 'account', id)]);
  await refreshCardPayments(db);
  return c.json({ deleted: true });
});

/** Manual "balance as of date" snapshot (AC3.1). */
accountRoutes.post('/:id/balance', async (c) => {
  const b = await body(c, balanceSet);
  const { db } = tctx(c);
  const id = c.req.param('id');
  if (!(await db.owns('accounts', id))) throw notFound();
  if (b.date > householdToday(tctx(c).hh)) throw new HttpError(400, 'date_in_future', 'Date in the future');
  await db.run(
    `INSERT INTO account_balances (id, household_id, account_id, date, balance_minor, source) SELECT ?3, ?1, ?2, ?4, ?5, 'manual'
      WHERE EXISTS (SELECT 1 FROM accounts WHERE household_id = ?1 AND id = ?2)
     ON CONFLICT(account_id, date) DO UPDATE SET balance_minor = excluded.balance_minor, source = 'manual', import_id = NULL`,
    id,
    newId(),
    b.date,
    b.balanceMinor,
  );
  return c.json({ ok: true });
});
