import { describe, expect, it } from 'vitest';
import { DB, json, ownerSetup } from './helpers';
import type { ImportSummary, PreviewResponse, WireRow } from '../../src/shared/schemas/imports';
import type { Tx } from '../../src/shared/schemas/ledger';

let refSeq = 5000;
const row = (n: number, date: string, amountMinor: number, description: string, extra: Partial<WireRow> = {}): WireRow => ({
  row: n,
  date,
  valueDate: date,
  amountMinor,
  description,
  reference: String(++refSeq),
  operationType: null,
  balanceMinor: null,
  occ: 1,
  ...extra,
});

async function setup() {
  const o = await ownerSetup();
  const acc = await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'Checking', type: 'checking' } });
  return { ...o, accountId: acc.body.id };
}
async function runImport(s: Awaited<ReturnType<typeof setup>>, rows: WireRow[], closing: { date: string; minor: number } | null = null, rowsError = 0) {
  const pv = await json<PreviewResponse>('POST', '/api/imports/preview', { cookie: s.cookie, body: { accountId: s.accountId, rows } });
  expect(pv.status).toBe(200);
  const cr = await json<{ importId: string }>('POST', '/api/imports', {
    cookie: s.cookie,
    body: { accountId: s.accountId, parserId: 'otsar-hahayal', fileName: 'x.xlsx', fileHash: 'a'.repeat(64), period: { from: rows[0]!.date, to: rows[rows.length - 1]!.date }, rowsTotal: rows.length, rowsError, closingBalance: closing },
  });
  expect(cr.status).toBe(201);
  for (let i = 0; i < rows.length; i += 250) expect((await json('POST', `/api/imports/${cr.body.importId}/rows`, { cookie: s.cookie, body: { rows: rows.slice(i, i + 250) } })).status).toBe(200);
  const cm = await json<ImportSummary>('POST', `/api/imports/${cr.body.importId}/commit`, { cookie: s.cookie });
  expect(cm.status).toBe(200);
  return { preview: pv.body, summary: cm.body, importId: cr.body.importId };
}
const count = async (hid: string) => (await DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?1').bind(hid).first<{ n: number }>())!.n;

describe('import pipeline (AC4.5–4.9)', () => {
  const base = [
    row(7, '2026-10-01', 1450000, 'משכורת אלפא', { operationType: 'משכורת' }),
    row(8, '2026-10-01', -520000, 'שכר דירה'),
    row(9, '2026-10-10', -743210, 'ישראכרט', { operationType: 'חיוב כרטיס אשראי' }),
    row(10, '2026-10-14', -5000, 'העברה ב-bit', { reference: '777', occ: 1 }),
    row(11, '2026-10-14', -5000, 'העברה ב-bit', { reference: '777', occ: 2 }),
    row(12, '2026-10-15', -12345, 'שופרסל דיל', { balanceMinor: 1000000 }),
  ];

  it('preview → commit; re-import inserts 0; identical same-day rows both kept; overlap adds only new rows', async () => {
    const s = await setup();
    const first = await runImport(s, base, { date: '2026-10-15', minor: 1000000 });
    expect(first.preview.counts).toEqual({ new: 6, duplicate: 0, matches_manual: 0 });
    expect(first.summary).toMatchObject({ rowsInserted: 6, rowsDuplicate: 0, rowsMerged: 0, status: 'committed' });
    expect(await count(s.householdId)).toBe(6);
    // rules + card lump applied after commit (AC4.9)
    const lump = await DB.prepare("SELECT kind, category_id FROM transactions WHERE household_id = ?1 AND description = 'ישראכרט'").bind(s.householdId).first<{ kind: string; category_id: string }>();
    expect(lump!.kind).toBe('card_lump');
    expect(lump!.category_id).toBeTruthy();
    const salary = await DB.prepare("SELECT c.name FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.household_id = ?1 AND t.amount_minor = 1450000").bind(s.householdId).first<{ name: string }>();
    expect(salary!.name).toBe('Salary');
    // balance snapshot stored
    const snap = await DB.prepare('SELECT balance_minor, source FROM account_balances WHERE household_id = ?1').bind(s.householdId).first();
    expect(snap).toEqual({ balance_minor: 1000000, source: 'import' });
    // same file again
    const again = await runImport(s, base);
    expect(again.preview.counts).toEqual({ new: 0, duplicate: 6, matches_manual: 0 });
    expect(again.summary).toMatchObject({ rowsInserted: 0, rowsDuplicate: 6 });
    expect(await count(s.householdId)).toBe(6);
    // overlapping file
    const overlap = [...base.slice(3), row(20, '2026-11-01', 1450000, 'משכורת אלפא'), row(21, '2026-11-02', -9900, 'בזק')];
    const third = await runImport(s, overlap);
    expect(third.preview.counts.new).toBe(2);
    expect(third.summary).toMatchObject({ rowsInserted: 2, rowsDuplicate: 3 });
    expect(await count(s.householdId)).toBe(8);
    // a third identical bit row (occ 3) is a new transaction
    const occ3 = await runImport(s, [row(30, '2026-10-14', -5000, 'העברה ב-bit', { reference: '777', occ: 3 })]);
    expect(occ3.summary.rowsInserted).toBe(1);
  });

  it('a manual entry matching an imported row is merged, keeps its category; undo restores it (AC4.8)', async () => {
    const s = await setup();
    const cats = (await json<{ categories: { id: string; name: string }[] }>('GET', '/api/categories', { cookie: s.cookie })).body.categories;
    const kids = cats.find((c) => c.name === 'Leisure')!.id;
    const manual = await json<Tx>('POST', '/api/transactions', { cookie: s.cookie, body: { date: '2026-10-12', amountMinor: 12345, direction: 'out', description: 'toys', accountId: s.accountId, categoryId: kids, notes: 'birthday' } });
    const r = await runImport(s, base);
    expect(r.preview.counts.matches_manual).toBe(1);
    expect(r.summary).toMatchObject({ rowsInserted: 5, rowsMerged: 1 });
    const m = await DB.prepare('SELECT description, category_id, notes, source, date FROM transactions WHERE id = ?1').bind(manual.body.id).first();
    expect(m).toEqual({ description: 'שופרסל דיל', category_id: kids, notes: 'birthday', source: 'manual', date: '2026-10-15' });
    // undo
    expect((await json('DELETE', `/api/imports/${r.importId}`, { cookie: s.cookie })).status).toBe(200);
    expect(await count(s.householdId)).toBe(1);
    const back = await DB.prepare('SELECT description, date, dedupe_key, merged_import_id FROM transactions WHERE id = ?1').bind(manual.body.id).first();
    expect(back).toEqual({ description: 'toys', date: '2026-10-12', dedupe_key: `m|${manual.body.id}`, merged_import_id: null });
    const list = await json<{ imports: ImportSummary[] }>('GET', '/api/imports', { cookie: s.cookie });
    expect(list.body.imports[0]!.status).toBe('undone');
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM account_balances WHERE household_id = ?1').bind(s.householdId).first<{ n: number }>())!.n).toBe(0);
    // re-import after undo works
    expect((await runImport(s, base)).summary.rowsMerged).toBe(1);
  });

  it('import with errors still commits valid rows and records the error count (AC4.7)', async () => {
    const s = await setup();
    const r = await runImport(s, base.slice(0, 2), null, 3);
    expect(r.summary).toMatchObject({ rowsInserted: 2, rowsError: 3 });
  });

  it('only normalized rows are accepted; ≤ 250 per request; unknown fields are not stored (AC4.2)', async () => {
    const s = await setup();
    const many = Array.from({ length: 251 }, (_, i) => row(i + 1, '2026-10-01', -100, 'x', { reference: String(i) }));
    expect((await json<{ error: { code: string } }>('POST', '/api/imports/preview', { cookie: s.cookie, body: { accountId: s.accountId, rows: many } })).body.error.code).toBe('too_many_rows');
    const bad = await json<{ error: { code: string } }>('POST', '/api/imports/preview', { cookie: s.cookie, body: { accountId: s.accountId, rows: [{ ...base[0], date: '01/10/2026' }] } });
    expect(bad.body.error.code).toBe('row_invalid');
    const leaky = [{ ...base[0]!, accountNumber: '99-123-456789', rawFile: 'AAAA' }];
    await runImport(s, leaky as WireRow[]);
    const all = await DB.prepare('SELECT * FROM transactions WHERE household_id = ?1').bind(s.householdId).all();
    expect(JSON.stringify(all.results)).not.toContain('456789');
    const staged = await DB.prepare('SELECT COUNT(*) AS n FROM import_rows WHERE household_id = ?1').bind(s.householdId).first<{ n: number }>();
    expect(staged!.n).toBe(0);
  });

  it('generic mapper profiles are saved per account and header signature (AC4.4)', async () => {
    const s = await setup();
    const mapping = { headerRow: 2, columns: { date: 0, description: 1, amount: 2 }, dateFormat: 'dmy', negate: false };
    expect((await json('PUT', '/api/import-profiles', { cookie: s.cookie, body: { accountId: s.accountId, headerSignature: 'a|b|c', mapping } })).status).toBe(200);
    expect((await json('PUT', '/api/import-profiles', { cookie: s.cookie, body: { accountId: s.accountId, headerSignature: 'a|b|c', mapping: { ...mapping, negate: true } } })).status).toBe(200);
    const g = await json<{ profiles: { headerSignature: string; mapping: { negate: boolean } }[] }>('GET', `/api/import-profiles?accountId=${s.accountId}`, { cookie: s.cookie });
    expect(g.body.profiles).toHaveLength(1);
    expect(g.body.profiles[0]!.mapping.negate).toBe(true);
  });
});
