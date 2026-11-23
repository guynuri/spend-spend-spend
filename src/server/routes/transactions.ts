import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body, notFound, query } from '../http';
import { bulkCategorize, splitsPut, txCreate, txOwed, txPatch, txQuery, undoLearn, type SplitLine, type TxList } from '../../shared/schemas/ledger';
import { csvCell, isCardLump, isGenericPayee, learnedRuleFor, scaleSplit, splitSumOk } from '../../shared/domain/ledger';
import { norm, normKey } from '../../shared/normalize';
import { householdCals } from '../db/sql/facts';
import { CARD_ISSUER_PATTERNS, DEFAULT_CATEGORIES } from '../seed/defaults';
import { newId, nowIso } from '../lib/crypto';
import { householdToday } from '../lib/today';
import { applyRulesStmt } from '../db/sql/rules';
import { TX_COLS, mapTx } from '../db/sql/txmap';
import { afterTransactionsWritten } from '../db/sql/linking';
import type { TenantDb } from '../db/tenant';
import { NEVER_LINK, refreshCardPayments, unlinkStmt } from '../db/sql/cards';
import type { Ctx } from '../types';

export const transactionRoutes = tenantGroup();
const PAGE = 50;

function encodeCursor(date: string, rowid: number) {
  return btoa(JSON.stringify([date, rowid])).replace(/=+$/, '');
}
function decodeCursor(s: string): [string, number] | null {
  try {
    const v = JSON.parse(atob(s));
    return Array.isArray(v) && typeof v[0] === 'string' && Number.isInteger(v[1]) ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

/** WHERE fragment + params for the ledger filters (AC3.4). Params start at ?2. */
function filterSql(c: Ctx) {
  const f = query(c, txQuery);
  const today = householdToday(tctx(c).hh);
  // default: the current budget period (pay day)
  const { cal } = householdCals(tctx(c).hh);
  const from = f.from ?? cal.start(cal.of(today));
  const to = f.to ?? cal.end(cal.of(today));
  const where: string[] = ['t.household_id = ?1', 't.date >= ?2', 't.date <= ?3'];
  const params: (string | number)[] = [from, to];
  const p = () => `?${params.length + 2}`; // ?1 is the household id
  if (f.account) {
    where.push(`t.account_id = ${p()}`);
    params.push(f.account);
  }
  if (f.category) {
    // A parent category includes its subcategories.
    const n = p();
    params.push(f.category);
    const inCat = (col: string) => `(${col} = ${n} OR ${col} IN (SELECT id FROM categories WHERE household_id = ?1 AND parent_id = ${n}))`;
    where.push(`(${inCat('t.category_id')} AND t.has_splits = 0 OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.household_id = ?1 AND s.transaction_id = t.id AND ${inCat('s.category_id')}))`);
  }
  if (f.uncategorized) where.push('t.category_id IS NULL AND t.has_splits = 0');
  if (f.kind) {
    where.push(`t.kind = ${p()}`);
    params.push(f.kind);
  }
  const qn = f.q ? norm(f.q) : '';
  if (qn) {
    const esc = (x: string) => `%${x.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const n = params.length;
    // Category names match too (the transaction's or any split line's); a default category also
    // matches by its name in the other language ("groceries" finds "מזון וצריכה").
    const defaults = DEFAULT_CATEGORIES.filter((d) => norm(d.he).includes(qn) || norm(d.en).includes(qn)).flatMap((d) => [d.he, d.en]);
    where.push(
      `(t.description_norm LIKE ?${n + 2} ESCAPE '\\' OR lower(t.description) LIKE ?${n + 3} ESCAPE '\\' OR lower(COALESCE(t.notes, '')) LIKE ?${n + 3} ESCAPE '\\' OR COALESCE(t.reference, '') LIKE ?${n + 3} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM categories c WHERE c.household_id = ?1
          AND ((t.has_splits = 0 AND c.id = t.category_id) OR c.id IN (SELECT s.category_id FROM transaction_splits s WHERE s.household_id = ?1 AND s.transaction_id = t.id))
          AND (lower(c.name) LIKE ?${n + 3} ESCAPE '\\' OR c.name IN (SELECT value FROM json_each(?${n + 4})))))`,
    );
    params.push(esc(normKey(f.q!) || qn), esc(qn), JSON.stringify(defaults));
  }
  return { where: where.join(' AND '), params, from, to, cursor: f.cursor };
}

async function loadSplits(db: TenantDb, ids: string[]) {
  const map = new Map<string, SplitLine[]>();
  if (!ids.length) return map;
  const rows = await db.all<{ id: string; transaction_id: string; category_id: string | null; amount_minor: number; note: string | null }>(
    'SELECT id, transaction_id, category_id, amount_minor, note FROM transaction_splits WHERE household_id = ?1 AND transaction_id IN (SELECT value FROM json_each(?2)) ORDER BY rowid',
    JSON.stringify(ids),
  );
  for (const r of rows) {
    const l = map.get(r.transaction_id) ?? [];
    l.push({ id: r.id, categoryId: r.category_id, amountMinor: r.amount_minor, note: r.note });
    map.set(r.transaction_id, l);
  }
  return map;
}

transactionRoutes.get('/', async (c) => {
  const { db } = tctx(c);
  const f = filterSql(c);
  const params = [...f.params];
  let where = f.where;
  if (f.cursor) {
    const cur = decodeCursor(f.cursor);
    if (!cur) throw new HttpError(400, 'validation', 'Bad cursor');
    where += ` AND (t.date < ?${params.length + 2} OR (t.date = ?${params.length + 2} AND t.rowid < ?${params.length + 3}))`;
    params.push(cur[0], cur[1]);
  }
  const [rows, sum] = await Promise.all([
    // Newest-entered first within a day (rowid = insertion order). Ids are random, so ordering by id
    // dropped a just-added row at a random spot among that day's rows, often off-screen.
    db.all(`SELECT ${TX_COLS}, t.rowid AS _rowid FROM transactions t WHERE ${where} ORDER BY t.date DESC, t.rowid DESC LIMIT ${PAGE + 1}`, ...params),
    db.first<{ n: number; i: number; o: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN t.amount_minor > 0 THEN t.amount_minor END), 0) AS i, COALESCE(SUM(CASE WHEN t.amount_minor < 0 THEN -t.amount_minor END), 0) AS o FROM transactions t WHERE ${f.where}`,
      ...f.params,
    ),
  ]);
  const page = rows.slice(0, PAGE);
  const splits = await loadSplits(db, page.filter((r) => r.has_splits === 1).map((r) => r.id as string));
  const last = page[page.length - 1];
  const res: TxList = {
    items: page.map((r) => mapTx(r, splits.get(r.id as string) ?? [])),
    nextCursor: rows.length > PAGE && last ? encodeCursor(last.date as string, last._rowid as number) : null,
    summary: { count: sum?.n ?? 0, inMinor: sum?.i ?? 0, outMinor: sum?.o ?? 0 },
    range: { from: f.from, to: f.to },
  };
  return c.json(res);
});

transactionRoutes.get('/export.csv', async (c) => {
  const { db } = tctx(c);
  const f = filterSql(c);
  const rows = await db.all<Record<string, unknown>>(
    `SELECT t.date, a.name AS account, t.description, t.amount_minor, t.reference, t.notes, t.has_splits,
            COALESCE(cat.name, '') AS category,
            (SELECT group_concat(COALESCE(sc.name, '?') || ' ' || printf('%.2f', s.amount_minor / 100.0), '; ')
               FROM transaction_splits s LEFT JOIN categories sc ON sc.id = s.category_id AND sc.household_id = ?1
              WHERE s.household_id = ?1 AND s.transaction_id = t.id) AS split_text
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.household_id = ?1
       LEFT JOIN categories cat ON cat.id = t.category_id AND cat.household_id = ?1
      WHERE ${f.where} ORDER BY t.date, t.id LIMIT 5000`,
    ...f.params,
  );
  const lines = ['date,account,description,amount,category,splits,reference,notes'];
  for (const r of rows)
    lines.push(
      [r.date, r.account, r.description, ((r.amount_minor as number) / 100).toFixed(2), r.has_splits ? '' : r.category, r.split_text ?? '', r.reference, r.notes]
        .map((v) => csvCell(v as string | number | null))
        .join(','),
    );
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="transactions_${f.from}_${f.to}.csv"`, 'Cache-Control': 'no-store' },
  });
});

transactionRoutes.post('/', async (c) => {
  const b = await body(c, txCreate);
  const { db, userId, hh } = tctx(c);
  await db.assertOwned({ accounts: [b.accountId], categories: [b.categoryId] });
  if (b.owedMinor && (b.direction !== 'out' || b.owedMinor >= b.amountMinor)) throw new HttpError(400, 'owed_too_big', 'The part paid back must be less than the purchase');
  // everything that could make the owed split fail is checked before anything is written
  if (b.owedMinor) {
    if (isCardLump(norm(b.description), -b.amountMinor, CARD_ISSUER_PATTERNS)) throw new HttpError(400, 'owed_not_purchase', 'A card bill is not a purchase');
    await ensureOwedCategory(db, hh.locale);
  }
  const id = newId();
  const amount = b.direction === 'in' ? b.amountMinor : -b.amountMinor;
  const dn = normKey(b.description);
  const now = nowIso();
  const lump = isCardLump(norm(b.description), amount, CARD_ISSUER_PATTERNS);
  const lumpCat = lump && !b.categoryId ? await db.first<{ id: string }>("SELECT id FROM categories WHERE household_id = ?1 AND system_key = 'card_unsplit'") : null;
  await db.insert('transactions', {
    id,
    account_id: b.accountId,
    date: b.date,
    amount_minor: amount,
    description: b.description,
    description_norm: dn,
    category_id: b.categoryId ?? lumpCat?.id ?? null,
    category_source: b.categoryId ? 'user' : lumpCat ? 'rule' : null,
    kind: lump ? 'card_lump' : 'normal',
    notes: b.notes || null,
    dedupe_key: `m|${id}`,
    source: 'manual',
    created_by: userId,
    created_at: now,
    updated_at: now,
  });
  if (!b.categoryId) await (await applyRulesStmt(db, { kind: 'ids', ids: [id] }, now)).run();
  if (b.owedMinor) await setOwed(db, id, b.owedMinor);
  await afterTransactionsWritten(db, { ids: [id] }, householdToday(hh));
  await refreshCardPayments(db);
  const row = await db.first(`SELECT ${TX_COLS} FROM transactions t WHERE t.household_id = ?1 AND t.id = ?2`, id);
  return c.json(mapTx(row!), 201);
});

transactionRoutes.patch('/:id', async (c) => {
  const b = await body(c, txPatch);
  const { db, hh } = tctx(c);
  const id = c.req.param('id');
  const tx = await db.first<{ id: string; source: string; amount_minor: number; description: string; has_splits: number; category_id: string | null; kind: string; card_account_id: string | null }>(
    'SELECT id, source, amount_minor, description, has_splits, category_id, kind, card_account_id FROM transactions WHERE household_id = ?1 AND id = ?2',
    id,
  );
  if (!tx) throw notFound();
  await db.assertOwned({ categories: [b.categoryId], accounts: [b.accountId], recurring_items: [b.recurringId] });
  const editingCore = b.description !== undefined || b.date !== undefined || b.amountMinor !== undefined || b.direction !== undefined || b.accountId !== undefined;
  if (editingCore && tx.source !== 'manual') throw new HttpError(400, 'imported_readonly', 'Imported fields cannot be edited');
  // A bank card charge: link it to the card account it pays, or (null) mark it as not a card bill.
  // Categorizing a linked charge by hand also unlinks it: the user books it themselves.
  // Runs after the checks above so a refused edit never leaves the link half changed.
  const linked = !!tx.card_account_id && tx.card_account_id !== NEVER_LINK;
  const unlinking = linked && (b.cardAccountId === null || (b.cardAccountId === undefined && b.categoryId !== undefined));
  const staysLinked = b.cardAccountId !== undefined ? !!b.cardAccountId : linked && !unlinking;
  // the app owns a linked charge's split lines: it stays a card charge until it is unlinked
  if (staysLinked && b.kind === 'normal') throw new HttpError(409, 'card_payment_linked', 'This charge is itemized by its card account');
  // the split a linked charge has is the app's and goes with the unlink; any other split must be removed first
  if ((b.amountMinor !== undefined || b.direction !== undefined) && tx.has_splits && !unlinking) throw new HttpError(400, 'split_sum_mismatch', 'Remove the split before changing the amount');
  if (b.cardAccountId !== undefined || (linked && b.categoryId !== undefined)) {
    if (tx.kind !== 'card_lump') throw new HttpError(400, 'not_card_charge', 'Only card charges can be linked to a card account');
    if (b.cardAccountId) {
      const acc = await db.first<{ type: string; archived: number }>('SELECT type, archived FROM accounts WHERE household_id = ?1 AND id = ?2', b.cardAccountId);
      if (!acc) throw notFound();
      if (acc.type !== 'credit_card' || acc.archived) throw new HttpError(400, 'not_card_account', 'Not an active credit-card account');
      await db.run(
        "UPDATE transactions SET card_account_id = ?3, has_splits = 0, updated_at = ?4 WHERE household_id = ?1 AND id = ?2 AND kind = 'card_lump'",
        id,
        b.cardAccountId,
        nowIso(),
      );
    } else if (unlinking) {
      const unsplit = await db.first<{ id: string }>("SELECT id FROM categories WHERE household_id = ?1 AND system_key = 'card_unsplit'");
      await db.batch([db.stmt('DELETE FROM transaction_splits WHERE household_id = ?1 AND transaction_id = ?2', id), unlinkStmt(db, [id], unsplit?.id ?? null, nowIso(), true)]);
      tx.has_splits = 0;
    } else if (!linked) {
      // not linked: only stop automatic linking; the user's own category or split stays
      await db.run('UPDATE transactions SET card_account_id = ?3, updated_at = ?4 WHERE household_id = ?1 AND id = ?2', id, NEVER_LINK, nowIso());
    }
  }
  const now = nowIso();
  let amount = tx.amount_minor;
  if (b.amountMinor !== undefined || b.direction !== undefined) {
    const abs = b.amountMinor ?? Math.abs(tx.amount_minor);
    const dir = b.direction ?? (tx.amount_minor >= 0 ? 'in' : 'out');
    amount = dir === 'in' ? abs : -abs;
  }
  const description = b.description ?? tx.description;
  const setCat = b.categoryId !== undefined;
  await db.run(
    `UPDATE transactions SET
       category_id = CASE WHEN ?3 = 1 THEN ?4 ELSE category_id END,
       category_source = CASE WHEN ?3 = 1 THEN (CASE WHEN ?4 IS NULL THEN NULL ELSE 'user' END) ELSE category_source END,
       notes = CASE WHEN ?5 = 1 THEN ?6 ELSE notes END,
       description = ?7, description_norm = ?8, date = COALESCE(?9, date), amount_minor = ?10, account_id = COALESCE(?11, account_id),
       kind = COALESCE(?12, kind),
       recurring_id = CASE WHEN ?13 = 1 THEN ?14 ELSE recurring_id END,
       recurring_due = CASE WHEN ?13 = 1 THEN ?15 ELSE recurring_due END,
       updated_at = ?16
     WHERE household_id = ?1 AND id = ?2`,
    id,
    setCat ? 1 : 0,
    b.categoryId ?? null,
    b.notes !== undefined ? 1 : 0,
    b.notes ?? null,
    description,
    normKey(description),
    b.date ?? null,
    amount,
    b.accountId ?? null,
    b.kind ?? null,
    b.recurringId !== undefined ? 1 : 0,
    b.recurringId ?? null,
    b.recurringId ? (b.recurringDue ?? null) : null,
    now,
  );
  // a purchase split by "someone will pay me back": your share follows the new category
  if (setCat && tx.has_splits)
    await db.run(
      `UPDATE transaction_splits SET category_id = ?3 WHERE household_id = ?1 AND transaction_id = ?2
          AND (category_id IS NULL OR category_id NOT IN (SELECT id FROM categories WHERE household_id = ?1 AND system_key = 'owed'))
          AND (SELECT COUNT(*) FROM transaction_splits s WHERE s.household_id = ?1 AND s.transaction_id = ?2) = 2
          AND EXISTS (SELECT 1 FROM transaction_splits s JOIN categories c ON c.id = s.category_id AND c.household_id = ?1 WHERE s.household_id = ?1 AND s.transaction_id = ?2 AND c.system_key = 'owed')`,
      id,
      b.categoryId ?? null,
    );

  // A categorization changes only this transaction. Similar uncategorized ones are offered (`similar`);
  // learning a rule and applying it to them is opt-in (`learn: true`, "always for this merchant").
  // Payment apps / transfers / checks / ATM are never offered: the counterparty differs each time.
  let learned: { ruleId: string; count: number; txIds: string[]; previous: { categoryId: string; source: 'user' | 'learned' | 'ai' | 'seed' } | null } | null = null;
  let similar: { count: number; txIds: string[] } | null = null;
  const key = learnedRuleFor({ description, amountMinor: amount });
  if (setCat && b.categoryId && !tx.has_splits && key.pattern_norm && !isGenericPayee(description)) {
    if (!b.learn) {
      const rows = await db.all<{ id: string }>(
        `SELECT id FROM transactions WHERE household_id = ?1 AND category_id IS NULL AND has_splits = 0 AND description_norm = ?2 AND id <> ?3
           AND ((?4 = 'in' AND amount_minor > 0) OR (?4 = 'out' AND amount_minor < 0)) LIMIT 500`,
        key.pattern_norm,
        id,
        key.sign,
      );
      if (rows.length) similar = { count: rows.length, txIds: rows.map((r) => r.id) };
    } else {
      const prev = await db.first<{ category_id: string; source: 'user' | 'learned' | 'ai' | 'seed' }>(
        'SELECT category_id, source FROM category_rules WHERE household_id = ?1 AND field = ?2 AND match = ?3 AND pattern_norm = ?4 AND sign = ?5',
        key.field,
        key.match,
        key.pattern_norm,
        key.sign,
      );
      // An explicit user rule for this merchant wins: a single choice never re-points it.
      if (prev?.source !== 'user') {
        const rule = await db.first<{ id: string }>(
          `INSERT INTO category_rules (id, household_id, field, match, pattern_norm, sign, category_id, source, created_at)
           SELECT ?2, ?1, ?3, ?4, ?5, ?6, ?7, 'learned', ?8 WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?7)
           ON CONFLICT(household_id, field, match, pattern_norm, sign) DO UPDATE SET category_id = excluded.category_id, source = 'learned'
           RETURNING id`,
          newId(),
          key.field,
          key.match,
          key.pattern_norm,
          key.sign,
          b.categoryId,
          now,
        );
        const applied = await db.all<{ id: string }>(
          `UPDATE transactions SET category_id = ?2, category_source = 'rule', updated_at = ?3
            WHERE household_id = ?1 AND category_id IS NULL AND has_splits = 0 AND description_norm = ?4 AND id <> ?5
              AND ((?6 = 'in' AND amount_minor > 0) OR (?6 = 'out' AND amount_minor < 0))
            RETURNING id`,
          b.categoryId,
          now,
          key.pattern_norm,
          id,
          key.sign,
        );
        learned = { ruleId: rule!.id, count: applied.length, txIds: applied.map((r) => r.id), previous: prev ? { categoryId: prev.category_id, source: prev.source } : null };
      }
    }
  }
  if (editingCore) await afterTransactionsWritten(db, { ids: [id] }, householdToday(hh));
  await refreshCardPayments(db);
  const row = await db.first(`SELECT ${TX_COLS} FROM transactions t WHERE t.household_id = ?1 AND t.id = ?2`, id);
  const splits = await loadSplits(db, [id]);
  return c.json({ tx: mapTx(row!, splits.get(id) ?? []), learned, similar });
});

transactionRoutes.post('/undo-learn', async (c) => {
  const b = await body(c, undoLearn);
  const { db } = tctx(c);
  const rule = await db.first<{ id: string; category_id: string; source: string }>('SELECT id, category_id, source FROM category_rules WHERE household_id = ?1 AND id = ?2', b.ruleId);
  if (!rule) throw notFound();
  if (b.txIds?.length) await db.assertOwned({ transactions: b.txIds });
  if (b.previous) await db.assertOwned({ categories: [b.previous.categoryId] });
  await db.batch([
    db.stmt(
      `UPDATE transactions SET category_id = NULL, category_source = NULL, updated_at = ?4
        WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND category_source = 'rule' AND category_id = ?3`,
      JSON.stringify(b.txIds ?? []),
      rule.category_id,
      nowIso(),
    ),
    // Restore the rule as it was before the categorization, or delete it if the categorization created it.
    ...(b.previous
      ? [db.stmt('UPDATE category_rules SET category_id = ?3, source = ?4 WHERE household_id = ?1 AND id = ?2', rule.id, b.previous.categoryId, b.previous.source)]
      : rule.source === 'learned'
        ? [db.stmt('DELETE FROM category_rules WHERE household_id = ?1 AND id = ?2', rule.id)]
        : []),
  ]);
  return c.json({ ok: true });
});

transactionRoutes.delete('/:id', async (c) => {
  const { db, userId } = tctx(c);
  const id = c.req.param('id');
  if (!(await db.owns('transactions', id))) throw notFound();
  // A planned expense matched to this transaction becomes planned again (it has no FK).
  await db.batch([
    db.stmt("UPDATE planned_expenses SET status = 'planned', matched_tx_id = NULL WHERE household_id = ?1 AND matched_tx_id = ?2 AND status = 'done'", id),
    db.stmt('DELETE FROM transactions WHERE household_id = ?1 AND id = ?2', id),
  ]);
  await db.audit(userId, 'transaction.delete', 'transaction', id).run();
  await refreshCardPayments(db);
  return c.json({ ok: true });
});

/** The household's "Owed to me" category, created when missing (e.g. a household whose own category had that name). */
async function ensureOwedCategory(db: TenantDb, locale?: string): Promise<string> {
  const hit = await db.first<{ id: string }>("SELECT id FROM categories WHERE household_id = ?1 AND system_key = 'owed'");
  if (hit) return hit.id;
  const base = locale === 'he' ? 'חייבים לי' : 'Owed to me';
  const taken = new Set((await db.all<{ name: string }>('SELECT name FROM categories WHERE household_id = ?1')).map((r) => r.name));
  const name = [base, `${base} 🤝`, `${base} (2)`].find((n) => !taken.has(n)) ?? `${base} ${newId().slice(0, 4)}`;
  const max = await db.first<{ m: number }>('SELECT COALESCE(MAX(sort), 0) AS m FROM categories WHERE household_id = ?1');
  const id = newId();
  await db.insert('categories', { id, name, kind: 'transfer', grp: null, is_debt: 0, system_key: 'owed', icon: 'handshake', emoji: '🤝', color: 'cat-3', sort: (max?.m ?? 0) + 1 });
  return id;
}

/**
 * "Someone will pay me back" (D-R30): the purchase becomes two lines — your share in its category, the
 * rest in the system category "Owed to me" (a transfer, so never spending). Their repayment, put in the
 * same category, cancels it out; what's left there is what people still owe you. 0 removes it. Works on
 * an unsplit purchase, or one already split this way (your share keeps its category).
 */
async function setOwed(db: TenantDb, id: string, owedMinor: number) {
  const tx = await db.first<{ amount_minor: number; category_id: string | null; has_splits: number; card_account_id: string | null }>(
    'SELECT amount_minor, category_id, has_splits, card_account_id FROM transactions WHERE household_id = ?1 AND id = ?2',
    id,
  );
  if (!tx) throw notFound();
  if (tx.amount_minor >= 0) throw new HttpError(400, 'owed_not_purchase', 'Only a purchase can be paid back');
  if (tx.card_account_id && tx.card_account_id !== NEVER_LINK) throw new HttpError(409, 'card_payment_linked', 'This charge is itemized by its card account');
  if (owedMinor >= -tx.amount_minor) throw new HttpError(400, 'owed_too_big', 'The part paid back must be less than the purchase');
  const owed = { id: await ensureOwedCategory(db) };
  // your share's category: the transaction's (kept in step with the share line by PATCH), else the line's
  let own = tx.category_id;
  if (tx.has_splits) {
    const lines = (await loadSplits(db, [id])).get(id) ?? [];
    const mine = lines.filter((l) => l.categoryId !== owed.id);
    if (lines.length !== 2 || mine.length !== 1) throw new HttpError(409, 'owed_split_exists', 'Already split: use the split editor');
    own = tx.category_id ?? mine[0]!.categoryId;
  }
  await db.batch([
    db.stmt('DELETE FROM transaction_splits WHERE household_id = ?1 AND transaction_id = ?2', id),
    ...(owedMinor > 0
      ? [
          db.insertStmt('transaction_splits', { id: newId(), transaction_id: id, category_id: own, amount_minor: tx.amount_minor + owedMinor, note: null }),
          db.insertStmt('transaction_splits', { id: newId(), transaction_id: id, category_id: owed.id, amount_minor: -owedMinor, note: null }),
        ]
      : []),
    db.stmt('UPDATE transactions SET has_splits = ?3, category_id = COALESCE(category_id, ?4), updated_at = ?5 WHERE household_id = ?1 AND id = ?2', id, owedMinor > 0 ? 1 : 0, own, nowIso()),
  ]);
}

transactionRoutes.put('/:id/owed', async (c) => {
  const b = await body(c, txOwed);
  const { db } = tctx(c);
  const id = c.req.param('id');
  await setOwed(db, id, b.owedMinor);
  const row = await db.first(`SELECT ${TX_COLS} FROM transactions t WHERE t.household_id = ?1 AND t.id = ?2`, id);
  return c.json(mapTx(row!, (await loadSplits(db, [id])).get(id) ?? []));
});

transactionRoutes.put('/:id/splits', async (c) => {
  const b = await body(c, splitsPut);
  const { db } = tctx(c);
  const id = c.req.param('id');
  const tx = await db.first<{ amount_minor: number; card_account_id: string | null }>('SELECT amount_minor, card_account_id FROM transactions WHERE household_id = ?1 AND id = ?2', id);
  if (!tx) throw notFound();
  // a linked card charge is booked by the app from the card account's purchases
  if (tx.card_account_id && tx.card_account_id !== NEVER_LINK) throw new HttpError(409, 'card_payment_linked', 'This charge is itemized by its card account');
  await db.assertOwned({ categories: b.lines.map((l) => l.categoryId) });
  if (b.lines.length === 1) throw new HttpError(400, 'split_min_lines', 'A split needs at least two lines');
  if (b.lines.length && !splitSumOk(b.lines, tx.amount_minor)) throw new HttpError(400, 'split_sum_mismatch', 'Split lines must sum to the transaction amount', { expected: tx.amount_minor });
  await db.batch([
    db.stmt('DELETE FROM transaction_splits WHERE household_id = ?1 AND transaction_id = ?2', id),
    ...b.lines.map((l) => db.insertStmt('transaction_splits', { id: newId(), transaction_id: id, category_id: l.categoryId, amount_minor: l.amountMinor, note: l.note || null })),
    db.stmt('UPDATE transactions SET has_splits = ?3, updated_at = ?4 WHERE household_id = ?1 AND id = ?2', id, b.lines.length ? 1 : 0, nowIso()),
  ]);
  const splits = await loadSplits(db, [id]);
  return c.json({ ok: true, splits: splits.get(id) ?? [] });
});

/** "Same as last time": the latest split of the same kind (card lump) or payee, scaled (AC3.6). */
transactionRoutes.get('/:id/split-suggestion', async (c) => {
  const { db } = tctx(c);
  const id = c.req.param('id');
  const tx = await db.first<{ amount_minor: number; kind: string; description_norm: string; account_id: string }>(
    'SELECT amount_minor, kind, description_norm, account_id FROM transactions WHERE household_id = ?1 AND id = ?2',
    id,
  );
  if (!tx) throw notFound();
  // No payee to match on: an empty description would match every other description-less split.
  if (tx.kind !== 'card_lump' && !tx.description_norm) return c.json({ suggestion: null });
  const prev = await db.first<{ id: string; date: string; amount_minor: number }>(
    `SELECT id, date, amount_minor FROM transactions WHERE household_id = ?1 AND has_splits = 1 AND id <> ?2 AND (card_account_id IS NULL OR card_account_id = 'none')
       AND (CASE WHEN ?3 = 'card_lump' THEN kind = 'card_lump' ELSE description_norm = ?4 END)
     ORDER BY date DESC, id DESC LIMIT 1`,
    id,
    tx.kind,
    tx.description_norm,
  );
  if (!prev) return c.json({ suggestion: null });
  const lines = (await loadSplits(db, [prev.id])).get(prev.id) ?? [];
  return c.json({ suggestion: { fromTxId: prev.id, fromDate: prev.date, fromAmountMinor: prev.amount_minor, lines: scaleSplit(lines, tx.amount_minor) } });
});

transactionRoutes.post('/bulk', async (c) => {
  const b = await body(c, bulkCategorize);
  const { db } = tctx(c);
  await db.assertOwned({ transactions: b.ids, categories: [b.categoryId] });
  const r = await db.run(
    `UPDATE transactions SET category_id = ?3, category_source = CASE WHEN ?3 IS NULL THEN NULL ELSE 'user' END, updated_at = ?4
      WHERE household_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND has_splits = 0`,
    JSON.stringify(b.ids),
    b.categoryId,
    nowIso(),
  );
  return c.json({ updated: r.meta.changes ?? 0 });
});
