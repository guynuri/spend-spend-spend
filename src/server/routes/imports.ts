import { z } from 'zod';
import type { Ctx } from '../types';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound, query } from '../http';
import { importCreate, profilePut, validateRows, type ImportSummary, type PreviewResponse, type RowStatus, type WireRow } from '../../shared/schemas/imports';
import { dedupeKey } from '../../shared/import/dedupe';
import { isCardLump } from '../../shared/domain/ledger';
import { CARD_ISSUER_PATTERNS } from '../../shared/domain/constants';
import { norm, normKey } from '../../shared/normalize';
import { MAX_IMPORT_ROWS } from '../../shared/import/types';
import { id } from '../../shared/schemas/common';
import { newId, nowIso } from '../lib/crypto';
import { householdToday } from '../lib/today';
import { applyRulesStmt, winningRuleSql } from '../db/sql/rules';
import { afterTransactionsWritten } from '../db/sql/linking';
import { afterImportCommitted } from '../db/sql/detection';
import type { TenantDb } from '../db/tenant';
import type { HouseholdRow } from '../db/rows';
import { refreshCardPayments } from '../db/sql/cards';
import { CARD_PARSER_IDS } from '../../shared/import/formats';

const isCardAccount = async (db: TenantDb, accountId: string) => (await db.first<{ type: string }>('SELECT type FROM accounts WHERE household_id = ?1 AND id = ?2', accountId))?.type === 'credit_card';

export const importRoutes = tenantGroup();
export const importProfileRoutes = tenantGroup();

/** Server-side enrichment: dedupe key and normalized texts are always computed here. */
/** First installment of n ("… 1/n" reference, set by cardAccountResult): an Apple Pay capture of the whole price matches it. */
const firstOf = (ref: string | null) => {
  const m = /(?:^|\s)1\/(\d{1,2})$/.exec(ref ?? '');
  return m ? Number(m[1]) : 0;
};
export const enrich = (r: WireRow) => ({
  ...r,
  k: dedupeKey(r),
  dn: normKey(r.description),
  op: r.operationType ? norm(r.operationType) : null,
  lump: isCardLump(norm(r.description), r.amountMinor, CARD_ISSUER_PATTERNS) ? 1 : 0,
  inst: firstOf(r.reference),
});
/**
 * A manual row this staged row replaces: same amount; or a captured (Apple Pay) purchase of the whole
 * price that the card file bills as installment 1 of n (within ₪1 per installment for rounding).
 */
const MANUAL_MATCH = `(m.amount_minor = s.a OR (m.captured = 1 AND m.has_splits = 0 AND s.inst > 1 AND abs(m.amount_minor - s.a * s.inst) <= 100 * s.inst))`;
type Enriched = ReturnType<typeof enrich>;

async function rowsBody(c: Ctx) {
  let raw: { rows?: unknown; accountId?: unknown };
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Bad JSON');
  }
  const v = validateRows(raw.rows);
  if (!v.ok) throw new HttpError(400, v.reason === 'too_many_rows' ? 'too_many_rows' : 'row_invalid', 'Invalid rows', { index: v.index, reason: v.reason });
  return { rows: v.rows.map(enrich), accountId: raw.accountId };
}

const mapImport = (r: Record<string, unknown>): ImportSummary => ({
  id: r.id as string,
  accountId: r.account_id as string,
  parserId: r.parser_id as string,
  fileName: (r.file_name as string) ?? null,
  periodStart: (r.period_start as string) ?? null,
  periodEnd: (r.period_end as string) ?? null,
  rowsTotal: r.rows_total as number,
  rowsInserted: r.rows_inserted as number,
  rowsDuplicate: r.rows_duplicate as number,
  rowsMerged: r.rows_merged as number,
  rowsError: r.rows_error as number,
  status: r.status as ImportSummary['status'],
  createdAt: r.created_at as string,
  closingBalanceMinor: (r.closing_balance_minor as number) ?? null,
  closingDate: (r.closing_date as string) ?? null,
});

// ---------------- preview (no writes) ----------------
importRoutes.post('/preview', async (c) => {
  const { db } = tctx(c);
  const { rows, accountId } = await rowsBody(c);
  const acc = id.safeParse(accountId);
  if (!acc.success) throw new HttpError(400, 'validation', 'accountId required');
  if (!(await db.owns('accounts', acc.data))) throw notFound();
  // purchases on a card account are never the bank's card charge
  const cardAccount = await isCardAccount(db, acc.data);
  const lumpCat = await db.first<{ id: string }>("SELECT id FROM categories WHERE household_id = ?1 AND system_key = 'card_unsplit'");
  const data = rows.map((r, i) => ({ i, k: r.k, dn: r.dn, op: r.op, a: r.amountMinor, d: r.date, inst: r.inst }));
  const res = await db.all<{ i: number; dup: number; man: number; cat: string | null }>(
    `WITH s AS (SELECT CAST(json_extract(j.value, '$.i') AS INTEGER) AS i, json_extract(j.value, '$.k') AS k, json_extract(j.value, '$.dn') AS dn,
                       json_extract(j.value, '$.op') AS op, json_extract(j.value, '$.a') AS a, json_extract(j.value, '$.d') AS d,
                       COALESCE(json_extract(j.value, '$.inst'), 0) AS inst FROM json_each(?2) j)
     SELECT s.i,
            EXISTS (SELECT 1 FROM transactions t WHERE t.household_id = ?1 AND t.account_id = ?3 AND t.dedupe_key = s.k) AS dup,
            EXISTS (SELECT 1 FROM transactions m WHERE m.household_id = ?1 AND m.account_id = ?3 AND m.source = 'manual' AND m.import_id IS NULL
                      AND m.merged_import_id IS NULL AND ${MANUAL_MATCH} AND abs(julianday(m.date) - julianday(s.d)) <= 3) AS man,
            ${winningRuleSql({ hh: '?1', amount: 's.a', dn: 's.dn', op: 's.op', select: 'r.category_id' })} AS cat
       FROM s`,
    JSON.stringify(data),
    acc.data,
  );
  const counts: Record<RowStatus, number> = { new: 0, duplicate: 0, matches_manual: 0 };
  const out: PreviewResponse['rows'] = res.map((x) => {
    const r = rows[x.i]!;
    const status: RowStatus = x.dup ? 'duplicate' : x.man ? 'matches_manual' : 'new';
    counts[status]++;
    // Same flag the commit stores (computed once in enrich), so preview and import always agree.
    const lump = r.lump === 1 && !cardAccount;
    return { row: r.row, status, kind: lump ? 'card_lump' : 'normal', categoryId: lump ? (lumpCat?.id ?? null) : x.cat };
  });
  return c.json({ rows: out, counts } satisfies PreviewResponse);
});

// ---------------- create / rows / commit ----------------
importRoutes.post('/', async (c) => {
  const b = await body(c, importCreate);
  const { db, userId } = tctx(c);
  await db.assertOwned({ accounts: [b.accountId] });
  // card-issuer files hold a card's purchases: they go to a credit-card account, and bank files never do
  // (a mapped 'generic' file may be either)
  const card = await isCardAccount(db, b.accountId);
  if (b.parserId !== 'generic' && CARD_PARSER_IDS.includes(b.parserId) !== card) throw new HttpError(400, 'wrong_account_type', card ? 'Bank files go to a bank account' : 'Card files go to a credit-card account');
  const idv = newId();
  await db.insert('imports', {
    id: idv,
    account_id: b.accountId,
    parser_id: b.parserId,
    file_name: b.fileName || null,
    file_hash: b.fileHash,
    period_start: b.period?.from ?? null,
    period_end: b.period?.to ?? null,
    rows_total: b.rowsTotal,
    rows_error: b.rowsError,
    closing_balance_minor: b.closingBalance?.minor ?? null,
    closing_date: b.closingBalance?.date ?? null,
    status: 'open',
    created_by: userId,
    created_at: nowIso(),
  });
  return c.json({ importId: idv }, 201);
});

export async function openImport(db: TenantDb, importId: string) {
  const imp = await db.first<{ id: string; account_id: string; status: string; closing_balance_minor: number | null; closing_date: string | null; rows_total: number }>(
    'SELECT id, account_id, status, closing_balance_minor, closing_date, rows_total FROM imports WHERE household_id = ?1 AND id = ?2',
    importId,
  );
  if (!imp) throw notFound();
  return imp;
}

importRoutes.post('/:id/rows', async (c) => {
  const { db } = tctx(c);
  const imp = await openImport(db, c.req.param('id'));
  if (imp.status !== 'open') throw new HttpError(409, 'import_closed', 'Import is not open');
  const { rows } = await rowsBody(c);
  const st = await db.first<{ chunks: number; n: number }>(
    'SELECT COUNT(*) AS chunks, COALESCE(SUM(json_array_length(rows_json)), 0) AS n FROM import_rows WHERE household_id = ?1 AND import_id = ?2',
    imp.id,
  );
  if ((st?.n ?? 0) + rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, 'too_many_rows', 'Import too large');
  await db.insert('import_rows', { import_id: imp.id, chunk: st?.chunks ?? 0, rows_json: JSON.stringify(rows satisfies Enriched[]) });
  return c.json({ staged: (st?.n ?? 0) + rows.length });
});

const STAGED = `SELECT json_extract(j.value, '$.k') AS k, json_extract(j.value, '$.date') AS d, json_extract(j.value, '$.amountMinor') AS a,
                       COALESCE(json_extract(j.value, '$.inst'), 0) AS inst,
                       json_extract(j.value, '$.row') AS rn, j.value AS v
                  FROM import_rows ir, json_each(ir.rows_json) j WHERE ir.household_id = ?1 AND ir.import_id = ?2`;

importRoutes.post('/:id/commit', async (c) => {
  const { db, userId, hh } = tctx(c);
  return c.json(await commitImport(db, hh, userId, c.req.param('id'), c.get('rid')));
});

/** Commits a staged import (used by the import page and by the file hook). */
export async function commitImport(db: TenantDb, hh: HouseholdRow, userId: string, importId: string, rid?: string): Promise<ImportSummary> {
  const imp = await openImport(db, importId);
  if (imp.status !== 'open') throw new HttpError(409, 'import_closed', 'Import is not open');
  const now = nowIso();
  const cardAccount = await isCardAccount(db, imp.account_id);
  const staged = await db.first<{ n: number }>('SELECT COALESCE(SUM(json_array_length(rows_json)), 0) AS n FROM import_rows WHERE household_id = ?1 AND import_id = ?2', imp.id);

  // 1) pair new rows with matching manual entries (same account & amount, ±3 days); merge them.
  const pairs = await db.all<{ mid: string; v: string }>(
    `WITH s AS (${STAGED}),
          c AS (SELECT s.k, s.v, s.rn, m.id AS mid, abs(julianday(m.date) - julianday(s.d)) AS dist
                  FROM s JOIN transactions m ON m.household_id = ?1 AND m.account_id = ?3 AND m.source = 'manual' AND m.import_id IS NULL
                   AND m.merged_import_id IS NULL AND ${MANUAL_MATCH} AND abs(julianday(m.date) - julianday(s.d)) <= 3
                 WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.household_id = ?1 AND t.account_id = ?3 AND t.dedupe_key = s.k)),
          r AS (SELECT c.*, ROW_NUMBER() OVER (PARTITION BY mid ORDER BY dist, rn) AS a1, ROW_NUMBER() OVER (PARTITION BY k ORDER BY dist, mid) AS a2 FROM c)
     SELECT mid, v FROM r WHERE a1 = 1 AND a2 = 1`,
    imp.id,
    imp.account_id,
  );
  const stmts: D1PreparedStatement[] = [];
  if (pairs.length)
    stmts.push(
      db.stmt(
        `UPDATE transactions SET
           pre_merge_json = json_object('date', date, 'value_date', value_date, 'description', description, 'description_norm', description_norm,
                                        'reference', reference, 'operation_type', operation_type, 'balance_after_minor', balance_after_minor, 'dedupe_key', dedupe_key,
                                        'captured', captured, 'amount_minor', amount_minor),
           date = json_extract(p.v, '$.date'), value_date = json_extract(p.v, '$.valueDate'), description = json_extract(p.v, '$.description'),
           description_norm = json_extract(p.v, '$.dn'), reference = json_extract(p.v, '$.reference'), operation_type = json_extract(p.v, '$.op'),
           balance_after_minor = json_extract(p.v, '$.balanceMinor'), dedupe_key = json_extract(p.v, '$.k'), merged_import_id = ?2, updated_at = ?3,
           captured = 0, amount_minor = json_extract(p.v, '$.amountMinor')
         FROM (SELECT json_extract(j.value, '$.mid') AS mid, json_extract(j.value, '$.v') AS v FROM json_each(?4) j) AS p
         WHERE transactions.household_id = ?1 AND transactions.id = p.mid`,
        imp.id,
        now,
        JSON.stringify(pairs),
      ),
    );
  // 2) insert everything else; existing keys (incl. just-merged rows) are skipped.
  stmts.push(
    db.stmt(
      `INSERT INTO transactions (id, household_id, account_id, date, value_date, amount_minor, description, description_norm, reference, operation_type,
                                 kind, import_id, dedupe_key, balance_after_minor, source, created_by, created_at, updated_at)
       SELECT substr(lower(hex(randomblob(11))), 1, 21), ?1, ?3, json_extract(j.value, '$.date'), json_extract(j.value, '$.valueDate'),
              json_extract(j.value, '$.amountMinor'), json_extract(j.value, '$.description'), json_extract(j.value, '$.dn'),
              json_extract(j.value, '$.reference'), json_extract(j.value, '$.op'),
              CASE WHEN json_extract(j.value, '$.lump') = 1 AND ?6 = 0 THEN 'card_lump' ELSE 'normal' END, ?2, json_extract(j.value, '$.k'),
              json_extract(j.value, '$.balanceMinor'), 'import', ?4, ?5, ?5
         FROM import_rows ir, json_each(ir.rows_json) j
        WHERE ir.household_id = ?1 AND ir.import_id = ?2 AND EXISTS (SELECT 1 FROM accounts a WHERE a.household_id = ?1 AND a.id = ?3)
        ORDER BY ir.chunk, j.key
       ON CONFLICT(household_id, account_id, dedupe_key) DO NOTHING`,
      imp.id,
      imp.account_id,
      userId,
      now,
      cardAccount ? 1 : 0,
    ),
  );
  // 3) flag card lumps, 4) rules
  stmts.push(
    db.stmt(
      `UPDATE transactions SET category_id = (SELECT id FROM categories WHERE household_id = ?1 AND system_key = 'card_unsplit'), category_source = 'rule', updated_at = ?3
       WHERE household_id = ?1 AND import_id = ?2 AND kind = 'card_lump' AND category_id IS NULL AND has_splits = 0`,
      imp.id,
      now,
    ),
  );
  stmts.push(await applyRulesStmt(db, { kind: 'import', importId: imp.id }, now));
  // 5) balance snapshot from the file's closing balance
  if (imp.closing_balance_minor !== null && imp.closing_date)
    stmts.push(
      db.stmt(
        `INSERT INTO account_balances (id, household_id, account_id, date, balance_minor, source, import_id)
         SELECT ?2, ?1, ?3, ?4, ?5, 'import', ?6 WHERE EXISTS (SELECT 1 FROM accounts WHERE household_id = ?1 AND id = ?3)
         ON CONFLICT(account_id, date) DO UPDATE SET balance_minor = excluded.balance_minor, source = 'import', import_id = excluded.import_id
           WHERE account_balances.source = 'import'`,
        newId(),
        imp.account_id,
        imp.closing_date,
        imp.closing_balance_minor,
        imp.id,
      ),
    );
  const res = await db.batch(stmts);
  const inserted = res[pairs.length ? 1 : 0]?.meta.changes ?? 0;
  const merged = pairs.length ? (res[0]?.meta.changes ?? 0) : 0;
  const duplicates = Math.max(0, (staged?.n ?? 0) - inserted - merged);
  // The rows are in. Linking and detection are best-effort: a failure there must not leave the import
  // 'open' with its transactions already written (they re-run on the next import or registry change).
  try {
    await afterTransactionsWritten(db, { importId: imp.id }, householdToday(hh));
    await afterImportCommitted(db, householdToday(hh));
    await refreshCardPayments(db);
  } catch (e) {
    console.error(JSON.stringify({ rid, error: 'import_postprocess', msg: String((e as Error).message).slice(0, 200) }));
  }
  await db.batch([
    db.stmt(
      "UPDATE imports SET status = 'committed', rows_inserted = ?3, rows_merged = ?4, rows_duplicate = ?5 WHERE household_id = ?1 AND id = ?2",
      imp.id,
      inserted,
      merged,
      duplicates,
    ),
    db.stmt('DELETE FROM import_rows WHERE household_id = ?1 AND import_id = ?2', imp.id),
    db.audit(userId, 'import.commit', 'import', imp.id, { inserted, merged, duplicates }),
  ]);
  const row = await db.first('SELECT * FROM imports WHERE household_id = ?1 AND id = ?2', imp.id);
  return mapImport(row!);
}

importRoutes.get('/', async (c) => {
  const { db } = tctx(c);
  const rows = await db.all("SELECT * FROM imports WHERE household_id = ?1 AND status <> 'open' ORDER BY created_at DESC LIMIT 50");
  return c.json({ imports: rows.map(mapImport) });
});

/** Undo import (AC4.8): its transactions and snapshot go; merged manual rows revert. */
importRoutes.delete('/:id', async (c) => {
  const { db, userId, hh } = tctx(c);
  const imp = await openImport(db, c.req.param('id'));
  if (imp.status === 'undone') throw new HttpError(409, 'import_closed', 'Already undone');
  // `?onlyOpen=1` (client cleanup after a failed upload) must never undo a committed import.
  if (c.req.query('onlyOpen') === '1' && imp.status !== 'open') throw new HttpError(409, 'import_closed', 'Import already committed');
  // An open import normally has no transactions. If a commit died half-way it does: then fall through to
  // the full undo below, so nothing is left behind that could no longer be undone.
  const written = imp.status === 'open' ? await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?1 AND (import_id = ?2 OR merged_import_id = ?2)', imp.id) : null;
  if (imp.status === 'open' && !written?.n) {
    // An unfinished upload (e.g. a failed commit the client is retrying): drop it entirely.
    await db.batch([db.stmt('DELETE FROM import_rows WHERE household_id = ?1 AND import_id = ?2', imp.id), db.stmt('DELETE FROM imports WHERE household_id = ?1 AND id = ?2', imp.id)]);
    return c.json({ ok: true, discarded: true });
  }
  const now = nowIso();
  await db.batch([
    db.stmt(
      `UPDATE planned_expenses SET status = 'planned', matched_tx_id = NULL
        WHERE household_id = ?1 AND matched_tx_id IN (SELECT id FROM transactions WHERE household_id = ?1 AND import_id = ?2)`,
      imp.id,
    ),
    db.stmt('DELETE FROM transactions WHERE household_id = ?1 AND import_id = ?2', imp.id),
    db.stmt(
      `UPDATE transactions SET date = json_extract(pre_merge_json, '$.date'), value_date = json_extract(pre_merge_json, '$.value_date'),
         description = json_extract(pre_merge_json, '$.description'), description_norm = json_extract(pre_merge_json, '$.description_norm'),
         reference = json_extract(pre_merge_json, '$.reference'), operation_type = json_extract(pre_merge_json, '$.operation_type'),
         balance_after_minor = json_extract(pre_merge_json, '$.balance_after_minor'), dedupe_key = json_extract(pre_merge_json, '$.dedupe_key'),
         captured = COALESCE(json_extract(pre_merge_json, '$.captured'), 0),
         amount_minor = COALESCE(json_extract(pre_merge_json, '$.amount_minor'), amount_minor), merged_import_id = NULL, pre_merge_json = NULL, updated_at = ?3
       WHERE household_id = ?1 AND merged_import_id = ?2`,
      imp.id,
      now,
    ),
    db.stmt('DELETE FROM account_balances WHERE household_id = ?1 AND import_id = ?2', imp.id),
    db.stmt('DELETE FROM import_rows WHERE household_id = ?1 AND import_id = ?2', imp.id),
    db.stmt("UPDATE imports SET status = 'undone' WHERE household_id = ?1 AND id = ?2", imp.id),
    db.audit(userId, 'import.undo', 'import', imp.id),
  ]);
  await afterImportCommitted(db, householdToday(hh));
  await refreshCardPayments(db);
  return c.json({ ok: true });
});

// ---------------- generic-mapper profiles ----------------
importProfileRoutes.get('/', async (c) => {
  const { db } = tctx(c);
  const q = query(c, z.object({ accountId: id }));
  const rows = await db.all<{ header_signature: string; mapping_json: string }>(
    'SELECT header_signature, mapping_json FROM import_profiles WHERE household_id = ?1 AND account_id = ?2 ORDER BY updated_at DESC',
    q.accountId,
  );
  return c.json({ profiles: rows.map((r) => ({ headerSignature: r.header_signature, mapping: JSON.parse(r.mapping_json) })) });
});

importProfileRoutes.put('/', async (c) => {
  const b = await body(c, profilePut);
  const { db } = tctx(c);
  await db.assertOwned({ accounts: [b.accountId] });
  await db.run(
    `INSERT INTO import_profiles (id, household_id, account_id, header_signature, mapping_json, updated_at)
     SELECT ?2, ?1, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM accounts WHERE household_id = ?1 AND id = ?3)
     ON CONFLICT(account_id, header_signature) DO UPDATE SET mapping_json = excluded.mapping_json, updated_at = excluded.updated_at`,
    newId(),
    b.accountId,
    b.headerSignature,
    JSON.stringify(b.mapping),
    nowIso(),
  );
  return c.json({ ok: true });
});

