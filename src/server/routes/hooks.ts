/**
 * Phone-automation hooks (D-R20): iOS Shortcuts call these with a personal key instead of a session.
 * - POST /api/hook/purchase: an Apple Pay purchase (Wallet "Transaction" automation) → a captured entry
 *   on the matching card account, replaced by the card file's row when that is imported.
 * - POST /api/hook/file: a bank or card file shared from another app → imported like the import page
 *   does. The file is read in memory and never stored.
 * The key is add-only: these routes create rows and answer with a one-line message, never read data.
 */
import { Hono, type Context } from 'hono';
import type { AppCtx } from '../types';
import { HttpError } from '../http';
import { rateLimit } from '../middleware/auth';
import { hookAuth } from '../middleware/hook';
import { newId, nowIso } from '../lib/crypto';
import { householdToday } from '../lib/today';
import { normKey } from '../../shared/normalize';
import { matchCaptureCard, parsePaidAmount, readPurchase } from '../../shared/domain/capture';
import { isValidDate } from '../../shared/dates';
import { inferAccount } from '../../shared/banks';
import { formatMoney } from '../../shared/money';
import { sniffFile } from '../../shared/import/sniff';
import { IMPORT_CHUNK, MAX_IMPORT_ROWS } from '../../shared/import/types';
import { toWire, validateRows } from '../../shared/schemas/imports';
import { applyRulesStmt } from '../db/sql/rules';
import { afterTransactionsWritten } from '../db/sql/linking';
import { refreshCardPayments } from '../db/sql/cards';
import { commitImport, enrich } from './imports';

export const hookRoutes = new Hono<AppCtx>();
hookRoutes.use('*', rateLimit('hook', 60, 60_000));

/** Messages the shortcut shows as a notification, in the household's language. */
const MSG = {
  en: {
    added: (amount: string, merchant: string, account: string, category: string | null) => `${amount} at ${merchant} → ${account}${category ? ` · ${category}` : ''}`,
    duplicate: 'Already added',
    unreadable: 'Could not read the purchase. In Money Money Money → Settings → Live card tracking, use “Didn’t work?” for the step-by-step setup.',
    foreign: 'Foreign-currency purchase: it will arrive with the card file',
    noCard: (card: string) => `No credit-card account matches “${card}”. Add one in Money Money Money → Accounts.`,
    imported: (n: number, dup: number, account: string) => `${n} new transaction${n === 1 ? '' : 's'} imported into ${account}${dup ? ` (${dup} already there)` : ''}`,
    unrecognized: 'This file needs a column mapping: open it on the Import page once.',
    noAccount: 'No matching account for this file: open it on the Import page.',
  },
  he: {
    added: (amount: string, merchant: string, account: string, category: string | null) => `${amount} ב־${merchant} ← ${account}${category ? ` · ${category}` : ''}`,
    duplicate: 'כבר נוסף',
    unreadable: 'לא הצלחנו לקרוא את הקנייה. ב־Money Money Money ← הגדרות ← מעקב חי אחר הכרטיס, „לא עבד?” מציג את ההגדרה צעד אחר צעד.',
    foreign: 'קנייה במטבע חוץ: היא תגיע עם קובץ הכרטיס',
    noCard: (card: string) => `אין חשבון כרטיס אשראי שמתאים ל„${card}”. אפשר להוסיף ב־Money Money Money ← חשבונות.`,
    imported: (n: number, dup: number, account: string) => `${n} תנועות חדשות יובאו ל${account}${dup ? ` (${dup} כבר היו)` : ''}`,
    unrecognized: 'צריך למפות את העמודות של הקובץ הזה: פותחים אותו פעם אחת בדף הייבוא.',
    noAccount: 'לא נמצא חשבון מתאים לקובץ: פותחים אותו בדף הייבוא.',
  },
};

async function auth(c: Context<AppCtx>) {
  const r = await hookAuth(c);
  return { ...r, msg: MSG[r.hh.locale === 'he' ? 'he' : 'en'] };
}

hookRoutes.post('/purchase', async (c) => {
  const { db, hh, userId, msg } = await auth(c);
  // JSON from our own steps, or whatever the shared shortcut passes on (readPurchase)
  const raw = await c.req.text();
  if (raw.length > 20_000) throw new HttpError(413, 'body_too_large', 'Body too large');
  const b = readPurchase(raw);
  const amt = b ? parsePaidAmount(b.amount) : null;
  if (!b || !amt) throw new HttpError(400, 'unreadable_purchase', msg.unreadable);
  if (amt.currency === 'foreign') return c.json({ status: 'skipped', message: msg.foreign });
  const accounts = await db.all<{ id: string; name: string; bank_id: string | null; account_mask: string | null }>(
    "SELECT id, name, bank_id, account_mask FROM accounts WHERE household_id = ?1 AND type = 'credit_card' AND archived = 0",
  );
  const accountId = matchCaptureCard(
    b.card,
    accounts.map((a) => ({ id: a.id, name: a.name, bankId: a.bank_id, mask: a.account_mask })),
  );
  if (!accountId) throw new HttpError(422, 'unknown_card', msg.noCard(b.card ?? ''));
  const today = householdToday(hh);
  const date = b.date && isValidDate(b.date) && b.date <= today ? b.date : today;
  const amount = -amt.minor;
  const now = nowIso();
  const account = accounts.find((a) => a.id === accountId)!;
  const money = formatMoney(amt.minor, { currency: hh.currency, locale: hh.locale === 'he' ? 'he' : 'en', decimals: 2 });
  // a retried request (flaky network) must not add the purchase twice
  const dup = await db.first<{ id: string }>(
    'SELECT id FROM transactions WHERE household_id = ?1 AND account_id = ?2 AND captured = 1 AND amount_minor = ?3 AND description = ?4 AND date = ?5 AND created_at > ?6',
    accountId,
    amount,
    b.merchant,
    date,
    new Date(Date.now() - 5 * 60_000).toISOString(),
  );
  if (dup) return c.json({ status: 'duplicate', id: dup.id, message: msg.duplicate });
  const id = newId();
  await db.insert('transactions', {
    id,
    account_id: accountId,
    date,
    amount_minor: amount,
    description: b.merchant,
    description_norm: normKey(b.merchant),
    kind: 'normal',
    dedupe_key: `m|${id}`,
    source: 'manual',
    captured: 1,
    created_by: userId,
    created_at: now,
    updated_at: now,
  });
  await (await applyRulesStmt(db, { kind: 'ids', ids: [id] }, now)).run();
  await afterTransactionsWritten(db, { ids: [id] }, today);
  await refreshCardPayments(db);
  const cat = await db.first<{ name: string | null }>('SELECT c.name FROM transactions t LEFT JOIN categories c ON c.id = t.category_id AND c.household_id = ?1 WHERE t.household_id = ?1 AND t.id = ?2', id);
  await db.audit(userId, 'capture.purchase', 'transaction', id).run();
  return c.json({ status: 'added', id, message: msg.added(money, b.merchant, account.name, cat?.name ?? null) }, 201);
});

/** Magic bytes → a file name the sniffer accepts (Shortcuts may not send one). */
const nameFor = (head: Uint8Array, given: string | null) => {
  if (given && /\.(xlsx|xls|csv)$/i.test(given)) return given;
  if (head[0] === 0x50 && head[1] === 0x4b) return 'file.xlsx';
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'file.xls';
  return 'file.csv';
};

hookRoutes.post('/file', async (c) => {
  const { db, hh, userId, msg } = await auth(c);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  let given: string | null;
  try {
    given = decodeURIComponent(c.req.header('x-file-name') ?? '') || null;
  } catch {
    given = null;
  }
  const s = sniffFile(nameFor(bytes, given), bytes.length, bytes.slice(0, 4096));
  if (!s.ok) throw new HttpError(400, s.error, s.error);
  // SheetJS only loads for this route
  const [{ toGrid }, { pickParser }, { cardAccountResult }] = await Promise.all([import('../../shared/import/grid'), import('../../shared/import/registry'), import('../../shared/import/cardAccount')]);
  let grid;
  try {
    grid = toGrid(s.kind, bytes);
  } catch {
    throw new HttpError(400, 'unsupported_file', 'Unreadable file');
  }
  const p = pickParser(grid);
  if (!p) throw new HttpError(422, 'unrecognized_file', msg.unrecognized);
  const parsed = p.parse(grid);
  const result = p.card ? cardAccountResult(parsed, grid) : parsed;
  if (!result.rows.length) throw new HttpError(422, 'no_rows', 'No transactions in the file');
  const accounts = (
    await db.all<{ id: string; name: string; type: string; bank_id: string | null; account_mask: string | null }>('SELECT id, name, type, bank_id, account_mask FROM accounts WHERE household_id = ?1 AND archived = 0')
  )
    .filter((a) => (a.type === 'credit_card') === !!p.card)
    .map((a) => ({ id: a.id, name: a.name, accountMask: a.account_mask, bankId: a.bank_id }));
  const acc = inferAccount(accounts, { accountMask: result.accountMask, bankIds: p.bankIds });
  if (!acc) throw new HttpError(422, 'which_account', msg.noAccount);
  const rows = result.rows.slice(0, MAX_IMPORT_ROWS).map(toWire);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const importId = newId();
  const stage: D1PreparedStatement[] = [
    db.insertStmt('imports', {
      id: importId,
      account_id: acc.id,
      parser_id: p.id,
      file_name: (given ?? 'shared file').slice(0, 120),
      file_hash: hash,
      period_start: result.period?.from ?? null,
      period_end: result.period?.to ?? null,
      rows_total: rows.length,
      rows_error: result.errors.length,
      closing_balance_minor: result.closingBalance?.minor ?? null,
      closing_date: result.closingBalance?.date ?? null,
      status: 'open',
      created_by: userId,
      created_at: nowIso(),
    }),
  ];
  for (let i = 0, chunk = 0; i < rows.length; i += IMPORT_CHUNK, chunk++) {
    const v = validateRows(rows.slice(i, i + IMPORT_CHUNK));
    if (!v.ok) throw new HttpError(400, 'row_invalid', 'Invalid rows', { index: i + v.index, reason: v.reason });
    stage.push(db.insertStmt('import_rows', { import_id: importId, chunk, rows_json: JSON.stringify(v.rows.map(enrich)) }));
  }
  await db.batch(stage);
  const summary = await commitImport(db, hh, userId, importId, c.get('rid'));
  return c.json({ status: 'imported', importId, inserted: summary.rowsInserted + summary.rowsMerged, duplicates: summary.rowsDuplicate, message: msg.imported(summary.rowsInserted + summary.rowsMerged, summary.rowsDuplicate, acc.name) }, 201);
});
