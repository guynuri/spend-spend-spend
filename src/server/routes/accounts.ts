import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound } from '../http';
import { accountCreate, accountPatch, balanceSet, type Account } from '../../shared/schemas/ledger';
import { newId, nowIso } from '../lib/crypto';
import { householdToday } from '../lib/today';
import { balancesAt, snapshotsAndVariance } from '../db/sql/balances';

export const accountRoutes = tenantGroup();

interface Row {
  id: string;
  name: string;
  type: Account['type'];
  institution: string | null;
  account_mask: string | null;
  opening_balance_minor: number;
  opening_date: string | null;
  include_in_forecast: number;
  is_liquid: number;
  archived: number;
}

accountRoutes.get('/', async (c) => {
  const { db, hh } = tctx(c);
  const today = householdToday(hh);
  const [rows, bals, snaps] = await Promise.all([
    db.all<Row>('SELECT * FROM accounts WHERE household_id = ?1 ORDER BY archived, created_at'),
    balancesAt(db, today),
    snapshotsAndVariance(db),
  ]);
  const bm = new Map(bals.map((b) => [b.account_id, b]));
  const sm = new Map(snaps.map((s) => [s.account_id, s]));
  const accounts: Account[] = rows.map((r) => {
    const s = sm.get(r.id);
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      institution: r.institution,
      accountMask: r.account_mask,
      openingBalanceMinor: r.opening_balance_minor,
      openingDate: r.opening_date,
      includeInForecast: r.include_in_forecast === 1,
      isLiquid: r.is_liquid === 1,
      archived: r.archived === 1,
      balanceMinor: bm.get(r.id)?.balance ?? r.opening_balance_minor,
      balanceDate: today,
      varianceMinor: s?.variance ?? null,
      latestSnapshot: s?.date ? { date: s.date, balanceMinor: s.balance_minor!, source: s.source! } : null,
    };
  });
  return c.json({ accounts, asOf: today });
});

accountRoutes.post('/', async (c) => {
  const b = await body(c, accountCreate);
  const { db, userId } = tctx(c);
  const id = newId();
  await db.batch([
    db.insertStmt('accounts', {
      id,
      name: b.name,
      type: b.type,
      institution: b.institution ?? null,
      account_mask: b.accountMask || null,
      opening_balance_minor: b.openingBalanceMinor ?? 0,
      opening_date: b.openingDate ?? null,
      include_in_forecast: b.includeInForecast ?? (b.type === 'checking' ? 1 : 0),
      is_liquid: b.isLiquid ?? (b.type === 'credit_card' ? 0 : 1),
      created_at: nowIso(),
    }),
    db.audit(userId, 'account.create', 'account', id),
  ]);
  return c.json({ id }, 201);
});

accountRoutes.patch('/:id', async (c) => {
  const b = await body(c, accountPatch);
  const { db } = tctx(c);
  const id = c.req.param('id');
  const r = await db.run(
    `UPDATE accounts SET name = COALESCE(?3, name), type = COALESCE(?4, type), institution = COALESCE(?5, institution),
       account_mask = COALESCE(?6, account_mask), opening_balance_minor = COALESCE(?7, opening_balance_minor),
       opening_date = CASE WHEN ?8 = 1 THEN ?9 ELSE opening_date END,
       include_in_forecast = COALESCE(?10, include_in_forecast), is_liquid = COALESCE(?11, is_liquid), archived = COALESCE(?12, archived)
     WHERE household_id = ?1 AND id = ?2`,
    id,
    b.name ?? null,
    b.type ?? null,
    b.institution ?? null,
    b.accountMask ?? null,
    b.openingBalanceMinor ?? null,
    b.openingDate !== undefined ? 1 : 0,
    b.openingDate ?? null,
    b.includeInForecast ?? null,
    b.isLiquid ?? null,
    b.archived ?? null,
  );
  if (!r.meta.changes) throw notFound();
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
    return c.json({ archived: true });
  }
  await db.batch([db.stmt('DELETE FROM accounts WHERE household_id = ?1 AND id = ?2', id), db.audit(userId, 'account.delete', 'account', id)]);
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
