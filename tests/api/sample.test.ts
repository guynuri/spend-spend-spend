import { describe, expect, it } from 'vitest';
import { DB, json, ownerSetup } from './helpers';
import type { TxList } from '../../src/shared/schemas/ledger';

describe('sample data (AC14.1 part)', () => {
  it('loads into an empty household only; consistent splits and balance snapshot', async () => {
    const o = await ownerSetup();
    const r = await json<{ transactions: number }>('POST', '/api/household/sample-data', { cookie: o.cookie, headers: { 'x-mz-locale': 'he' } });
    expect(r.status).toBe(201);
    expect(r.body.transactions).toBeGreaterThan(100);
    expect((await json('POST', '/api/household/sample-data', { cookie: o.cookie })).status).toBe(409);
    const me = await json<{ active: { hasSampleData: boolean } }>('GET', '/api/me', { cookie: o.cookie });
    expect(me.body.active.hasSampleData).toBe(true);
    // every split sums to its parent
    const bad = await DB.prepare(
      'SELECT t.id FROM transactions t WHERE t.household_id = ?1 AND t.has_splits = 1 AND t.amount_minor <> (SELECT SUM(s.amount_minor) FROM transaction_splits s WHERE s.transaction_id = t.id)',
    ).bind(o.householdId).all();
    expect(bad.results).toEqual([]);
    // exactly one unsplit card lump (the latest)
    const unsplit = await DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?1 AND kind = 'card_lump' AND has_splits = 0").bind(o.householdId).first<{ n: number }>();
    expect(unsplit!.n).toBe(1);
    // snapshot equals opening + Σ transactions → zero variance
    const acc = await json<{ accounts: { name: string; varianceMinor: number | null; type: string }[] }>('GET', '/api/accounts', { cookie: o.cookie });
    expect(acc.body.accounts.find((a) => a.type === 'checking')!.varianceMinor).toBe(0);
    const list = await json<TxList>('GET', '/api/transactions?from=2000-01-01&to=2100-01-01&uncategorized=1', { cookie: o.cookie });
    expect(list.body.summary.count).toBeGreaterThan(0);
  });
});
