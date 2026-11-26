import { describe, expect, it } from 'vitest';
import { exports } from 'cloudflare:workers';
import * as XLSX from 'xlsx';
import { BASE, DB, addMember, call, json, makeUser, ownerSetup, sessionFor } from './helpers';
import { addMonths, monthOf, todayInTz } from '../../src/shared/dates';
import type { BudgetView } from '../../src/shared/domain/budget';
import type { Tx } from '../../src/shared/schemas/ledger';

/** A Max export with these rows (date dd-mm-yyyy, business, charged amount). */
function maxFile(rows: [string, string, number][]) {
  const aoa = [
    ['כל המשתמשים (1)'],
    ['תאריך עסקה', 'שם בית העסק', 'קטגוריה', '4 ספרות אחרונות של כרטיס האשראי', 'סוג עסקה', 'סכום חיוב', 'מטבע חיוב', 'סכום עסקה מקורי', 'מטבע עסקה מקורי', 'תאריך חיוב', 'הערות'],
    ...rows.map(([d, b, a]) => [d, b, 'שונות', '1111', 'רגילה', a, '₪', a, '₪', null, null]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
}
const hook = (path: string, token: string | null, body: BodyInit, headers: Record<string, string> = {}) =>
  exports.default
    .fetch(`${BASE}/api/hook/${path}`, { method: 'POST', body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } })
    .then(async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> & { error?: { code: string } } }));

describe('card accounts, Apple Pay captures and shared files (D-R20)', () => {
  it('captures purchases live, merges them with the card file, and books the bank charge as the bill', async () => {
    const o = await ownerSetup();
    const cookie = o.cookie;
    const today = todayInTz('Asia/Jerusalem');
    const prev = addMonths(monthOf(today), -1);
    const [y, m] = prev.split('-');
    const bank = (await json<{ id: string }>('POST', '/api/accounts', { cookie, body: { name: 'Checking', type: 'checking', openingBalanceMinor: 0, openingDate: `${prev}-01` } })).body.id;
    const max = (await json<{ id: string }>('POST', '/api/accounts', { cookie, body: { name: 'Max', type: 'credit_card', bankId: 'max', accountMask: '1111' } })).body.id;

    // keys: per user, shown once; no key / a wrong key → 401
    const key = await json<{ id: string; token: string }>('POST', '/api/capture-keys', { cookie, body: { label: 'iPhone' } });
    expect(key.status).toBe(201);
    const token = key.body.token;
    expect((await json<{ keys: { id: string; lastUsedAt: string | null }[] }>('GET', '/api/capture-keys', { cookie })).body.keys).toHaveLength(1);
    expect((await hook('purchase', null, JSON.stringify({ merchant: 'x', amount: 1 }), { 'content-type': 'application/json' })).status).toBe(401);
    const wrong = await hook('purchase', 'mz_wrong-key-wrong-key-wrong', JSON.stringify({ merchant: 'x', amount: 1 }), { 'content-type': 'application/json' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBeTruthy(); // the shortcut's notification says why

    // Apple Pay purchase → a captured entry on the Max account; a retry is not added twice; foreign waits
    const buy = (b: object) => hook('purchase', token, JSON.stringify(b), { 'content-type': 'application/json' });
    const p1 = await buy({ merchant: 'רמי לוי', amount: '₪245.90', card: 'Max Visa •••• 1111', date: `${prev}-04` });
    expect(p1.status).toBe(201);
    expect(p1.body.message).toContain('Max');
    expect((await buy({ merchant: 'רמי לוי', amount: '₪245.90', card: 'Max Visa •••• 1111', date: `${prev}-04` })).body.status).toBe('duplicate');
    expect((await buy({ merchant: 'Hotel', amount: '$120.00', card: 'Max' })).body.status).toBe('skipped');
    const captured = await DB.prepare('SELECT account_id, amount_minor, captured, category_id FROM transactions WHERE household_id = ?1 AND id = ?2').bind(o.householdId, p1.body.id).first<{ account_id: string; amount_minor: number; captured: number; category_id: string | null }>();
    expect(captured).toMatchObject({ account_id: max, amount_minor: -24590, captured: 1 });
    expect(captured!.category_id).not.toBeNull(); // the built-in rule for רמי לוי

    // the Max file shared from the phone: the captured purchase merges, the online one is added
    const f1 = await hook('file', token, maxFile([[`04-${m}-${y}`, 'רמי לוי', 245.9], [`06-${m}-${y}`, 'ZARA ONLINE', 100]]), { 'x-file-name': encodeURIComponent('max export.xlsx') });
    expect(f1.status).toBe(201);
    expect(f1.body.inserted).toBe(2);
    const onCard = (await DB.prepare('SELECT description, amount_minor, captured, source FROM transactions WHERE household_id = ?1 AND account_id = ?2 ORDER BY date').bind(o.householdId, max).all()).results;
    expect(onCard).toHaveLength(2);
    expect(onCard[0]).toMatchObject({ amount_minor: -24590, captured: 0 });
    // the same file again: nothing new
    expect((await hook('file', token, maxFile([[`04-${m}-${y}`, 'רמי לוי', 245.9], [`06-${m}-${y}`, 'ZARA ONLINE', 100]]))).body.inserted).toBe(0);

    // the bank's Max charge (this month) pays last month's purchases: 345.90 known, 654.10 not itemized yet
    const lump = await json<Tx>('POST', '/api/transactions', { cookie, body: { date: `${monthOf(today)}-01`, amountMinor: 100000, direction: 'out', description: 'מקס איט פיננסים', accountId: bank } });
    const tx = async () => (await json<{ items: Tx[] }>('GET', `/api/transactions?from=${monthOf(today)}-01&to=${monthOf(today)}-01&account=${bank}`, { cookie })).body.items.find((t) => t.id === lump.body.id)!;
    let t = await tx();
    expect(t.cardAccountId).toBe(max);
    expect(t.splits.map((s) => s.amountMinor).sort((a, b) => a - b)).toEqual([-65410, -34590]);
    const budget = async (month: string) => (await json<BudgetView>('GET', `/api/budgets?month=${month}`, { cookie })).body;
    expect((await budget(monthOf(today))).unsplitCardMinor).toBe(65410);
    expect((await budget(monthOf(today))).totals.expensesMinor).toBe(65410); // the paid part is a transfer
    expect((await budget(prev)).totals.expensesMinor).toBe(34590); // the purchases, when they happened

    // the rest of the month's purchases arrive (via the import page this time): nothing left unitemized
    const imp = await json<{ importId: string }>('POST', '/api/imports', { cookie, body: { accountId: max, parserId: 'max', fileName: 'max.xlsx', fileHash: 'e'.repeat(64), period: null, rowsTotal: 1, rowsError: 0, closingBalance: null } });
    await json('POST', `/api/imports/${imp.body.importId}/rows`, { cookie, body: { rows: [{ row: 5, date: `${prev}-20`, valueDate: null, amountMinor: -65410, description: 'IKEA', reference: null, operationType: null, balanceMinor: null, occ: 1 }] } });
    await json('POST', `/api/imports/${imp.body.importId}/commit`, { cookie, body: {} });
    t = await tx();
    expect(t.splits.map((s) => s.amountMinor)).toEqual([-100000]);
    expect((await budget(monthOf(today))).unsplitCardMinor).toBe(0);
    // the card account owes nothing more for that cycle: purchases − bill paid
    const accs = (await json<{ accounts: { id: string; balanceMinor: number }[] }>('GET', '/api/accounts', { cookie })).body.accounts;
    expect(accs.find((a) => a.id === max)!.balanceMinor).toBe(0);

    // a linked charge isn't split by hand; unlinking makes it a placeholder again and it stays unlinked
    expect((await json('PUT', `/api/transactions/${lump.body.id}/splits`, { cookie, body: { lines: [] } })).status).toBe(409);
    expect((await json('PATCH', `/api/transactions/${lump.body.id}`, { cookie, body: { cardAccountId: null } })).status).toBe(200);
    t = await tx();
    expect(t).toMatchObject({ cardAccountId: null, hasSplits: false });
    await json('POST', '/api/transactions', { cookie, body: { date: today, amountMinor: 1, direction: 'out', description: 'x', accountId: bank } }); // triggers a refresh
    expect((await tx()).cardAccountId).toBeNull();
    expect((await json('PATCH', `/api/transactions/${lump.body.id}`, { cookie, body: { cardAccountId: max } })).status).toBe(200);
    expect((await tx()).cardAccountId).toBe(max);

    // file kinds and accounts must fit
    expect((await json('POST', '/api/imports', { cookie, body: { accountId: bank, parserId: 'max', fileName: 'x', fileHash: 'f'.repeat(64), period: null, rowsTotal: 0, rowsError: 0, closingBalance: null } })).body).toMatchObject({ error: { code: 'wrong_account_type' } });
    expect((await json('POST', '/api/imports', { cookie, body: { accountId: max, parserId: 'hapoalim', fileName: 'x', fileHash: 'f'.repeat(64), period: null, rowsTotal: 0, rowsError: 0, closingBalance: null } })).status).toBe(400);

    // an Apple Pay purchase paid in 3 installments: the file's installment 1/3 replaces the capture
    const cur = monthOf(today);
    const [cy, cm] = cur.split('-');
    const inst = await buy({ merchant: 'iDigital', amount: '₪1,200.00', card: 'Max •••• 1111', date: `${cur}-01` });
    expect(inst.status).toBe(201);
    const instFile = maxFile([[`01-${cm}-${cy}`, 'iDigital', 400]]);
    // (the Max layout's notes column carries the installment)
    const wbi = XLSX.read(instFile, { type: 'array' });
    const ws = wbi.Sheets[wbi.SheetNames[0]!]!;
    XLSX.utils.sheet_add_aoa(ws, [['תשלום 1 מתוך 3']], { origin: 'K3' });
    const f2 = await hook('file', token, new Uint8Array(XLSX.write(wbi, { bookType: 'xlsx', type: 'array' })));
    expect(f2.status).toBe(201);
    const instRows = (await DB.prepare("SELECT amount_minor, captured, reference FROM transactions WHERE household_id = ?1 AND account_id = ?2 AND description = 'iDigital'").bind(o.householdId, max).all()).results;
    expect(instRows).toEqual([{ amount_minor: -40000, captured: 0, reference: '1/3' }]);

    // the shared shortcut may pass Wallet's transaction as it is: a dictionary, or text
    const wallet = await hook('purchase', token, JSON.stringify({ Merchant: 'Aroma', Amount: '₪18.00', 'Card or Pass': 'Max •••• 1111' }));
    expect(wallet.status).toBe(201);
    expect((await hook('purchase', token, 'Merchant: Cafe Cafe\nAmount: ₪22.50\nCard or Pass: Max')).status).toBe(201);
    const bad = await hook('purchase', token, '{"foo": 1}');
    expect(bad.status).toBe(400);
    expect(bad.body.error?.code).toBe('unreadable_purchase');
    // errors carry a top-level message too, so the shortcut's notification says why
    expect(bad.body.message).toMatch(/Could not read the purchase/);
    // Wallet's transaction passed on as is: iOS sends just a name (seen on a device: text/plain, 15 chars, no amount)
    const nameOnly = await hook('purchase', token, 'Aroma Tel Aviv', { 'content-type': 'text/plain' });
    expect(nameOnly.status).toBe(400);
    expect(nameOnly.body).toMatchObject({ error: { code: 'no_amount' }, message: expect.stringContaining('Text action') });
    // the fix on the phone: a Text action with three lines, passed to the shortcut
    expect((await hook('purchase', token, 'Merchant: Aroma Tel Aviv\nAmount: ‏23.50 ₪\nCard or Pass: Max', { 'content-type': 'text/plain' })).status).toBe(201);
    // the key remembers its last result and what arrived (type, size, field names — never values)
    type K = { lastUsedAt: string | null; lastResult: string | null; lastDetail: string | null };
    const keyNow = async () => (await json<{ keys: K[] }>('GET', '/api/capture-keys', { cookie })).body.keys[0]!;
    expect(await keyNow()).toMatchObject({ lastResult: 'added' });
    await hook('purchase', token, 'Aroma Tel Aviv', { 'content-type': 'text/plain' });
    expect(await keyNow()).toMatchObject({ lastResult: 'no_amount', lastDetail: 'text/plain · 14 chars · no number' });
    const odd = await hook('purchase', token, JSON.stringify({ Shop: 'Aroma secret', Total: 'x' }), { 'content-type': 'application/json' });
    expect(odd.status).toBe(400);
    expect(odd.body).toMatchObject({ message: expect.any(String), error: { code: 'unreadable_purchase' } });
    const detail = (await keyNow()).lastDetail!;
    expect(detail).toContain('application/json');
    expect(detail).toContain('fields: total, 1 other'); // known names only; others counted (they could be data)
    expect(detail).not.toContain('Aroma');
    await hook('purchase', token, JSON.stringify({ 'Aroma ₪19.00': true }), { 'content-type': 'application/json' });
    expect((await keyNow()).lastDetail).not.toContain('Aroma');
    // run by hand (no Wallet transaction): a connection test, not an error
    for (const empty of ['', '{}', '  ']) {
      const t = await hook('purchase', token, empty);
      expect(t.status).toBe(200);
      expect(t.body).toMatchObject({ status: 'test', message: expect.stringContaining('Connected') });
    }
    expect((await keyNow()).lastResult).toBe('test');
    await hook('purchase', token, JSON.stringify({ merchant: 'Aroma', amount: '₪19.00', card: 'Max' }), { 'content-type': 'application/json' });
    expect((await keyNow()).lastResult).toBe('added');

    // the household's shared shortcut links: owner sets, everyone reads, only iCloud links
    const link = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
    expect((await json('PATCH', '/api/household', { cookie, body: { shortcutPurchaseLink: link } })).status).toBe(200);
    expect((await json('PATCH', '/api/household', { cookie, body: { shortcutFileLink: 'https://evil.example/x' } })).status).toBe(400);
    expect((await json<{ shortcutLinks: Record<string, string | null> }>('GET', '/api/household', { cookie })).body.shortcutLinks).toEqual({ purchase: link, file: null });

    // revoking the key stops it; a viewer gets no keys
    expect((await json('DELETE', `/api/capture-keys/${key.body.id}`, { cookie })).status).toBe(200);
    expect((await buy({ merchant: 'x', amount: 1, card: 'Max' })).status).toBe(401);
    const viewer = await makeUser('Viewer');
    await addMember(o.householdId, viewer, 'viewer');
    expect((await json('POST', '/api/capture-keys', { cookie: await sessionFor(viewer, o.householdId), body: {} })).status).toBe(403);
    const member = await makeUser('Member');
    await addMember(o.householdId, member, 'member');
    expect((await json('PATCH', '/api/household', { cookie: await sessionFor(member, o.householdId), body: { shortcutPurchaseLink: null } })).status).toBe(403);
    // the hook needs no CSRF headers, and a session cookie alone doesn't open it
    expect((await call('POST', '/api/hook/purchase', { cookie, body: { merchant: 'x', amount: 1 } })).status).toBe(401);
  });
});
