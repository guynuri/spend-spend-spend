import { describe, expect, it } from 'vitest';
import { DB, json, ownerSetup } from './helpers';
import { addDays, monthEnd, monthOf, todayInTz } from '../../src/shared/dates';
import type { ForecastView } from '../../src/shared/domain/forecast';
import type { RecurringDto } from '../../src/shared/schemas/plan';

const today = () => todayInTz('Asia/Jerusalem');
const sum = (f: ForecastView) => f.startBalance + Object.values(f.breakdown).reduce((a, b) => a + b, 0);

async function demo() {
  const o = await ownerSetup();
  await json('POST', '/api/household/sample-data', { cookie: o.cookie });
  return o;
}

describe('forecast & upcoming (AC7.1–7.3, AC6.4)', () => {
  it('demo forecast: as-of yesterday, exact breakdown sum, series to end of next month', async () => {
    const o = await demo();
    const f = (await json<ForecastView>('GET', '/api/forecast', { cookie: o.cookie })).body;
    expect(f.asOf).toBe(addDays(today(), -1));
    expect(f.hasForecastAccount).toBe(true);
    expect(f.series.at(-1)!.date).toBe(monthEnd(monthOf(addDays(monthEnd(monthOf(today())), 1))));
    if (f.eom) expect(sum(f)).toBe(f.eom.balance);
    expect(f.baselineDaily).toBeGreaterThan(0);
    expect(['high', 'medium']).toContain(f.confidence);
    expect(f.low!.date >= today()).toBe(true);
  });

  it('a planned expense before month end lowers EOM by exactly its amount (AC7.2); card override changes the figure', async () => {
    const o = await demo();
    const accounts = (await json<{ accounts: { id: string; type: string }[] }>('GET', '/api/accounts', { cookie: o.cookie })).body.accounts;
    const checking = accounts.find((a) => a.type === 'checking')!.id;
    const before = (await json<ForecastView>('GET', '/api/forecast', { cookie: o.cookie })).body;
    const date = today() === monthEnd(monthOf(today())) ? today() : addDays(today(), 1);
    const p = await json<{ id: string }>('POST', '/api/planned', { cookie: o.cookie, body: { name: 'Gift', amountMinor: 123400, date, accountId: checking } });
    expect(p.status).toBe(201);
    const after = (await json<ForecastView>('GET', '/api/forecast', { cookie: o.cookie })).body;
    expect(before.eom!.balance - after.eom!.balance).toBe(123400);
    expect(sum(after)).toBe(after.eom!.balance);
    // card override for the next card charge
    const rec = (await json<{ items: RecurringDto[] }>('GET', '/api/recurring', { cookie: o.cookie })).body.items;
    const card = rec.find((r) => r.kind === 'card_charge')!;
    expect(card.next).toBeTruthy();
    const nextCard = after.events.find((e) => e.itemId === card.id && e.due === card.next!.due)!;
    expect((await json('PUT', `/api/recurring/${card.id}/overrides/${card.next!.due}`, { cookie: o.cookie, body: { amountMinor: -100000 } })).status).toBe(200);
    const ov = (await json<ForecastView>('GET', '/api/forecast', { cookie: o.cookie })).body;
    const ovCard = ov.events.find((e) => e.itemId === card.id && e.due === card.next!.due)!;
    expect(ovCard.amountMinor).toBe(-100000);
    expect(ovCard.overridden).toBe(true);
    expect(nextCard.amountMinor).not.toBe(-100000);
    // skip it
    await json('PUT', `/api/recurring/${card.id}/overrides/${card.next!.due}`, { cookie: o.cookie, body: { skipped: true } });
    expect((await json<ForecastView>('GET', '/api/forecast', { cookie: o.cookie })).body.events.some((e) => e.itemId === card.id && e.due === card.next!.due)).toBe(false);
    // clear
    await json('PUT', `/api/recurring/${card.id}/overrides/${card.next!.due}`, { cookie: o.cookie, body: {} });
    expect((await DB.prepare('SELECT COUNT(*) AS n FROM recurring_overrides WHERE household_id = ?1').bind(o.householdId).first<{ n: number }>())!.n).toBe(0);
  });

  it('upcoming: next 45 days with running balance; totals', async () => {
    const o = await demo();
    const u = await json<{ items: { date: string; balanceAfter: number | null; type: string }[]; end: string }>('GET', '/api/upcoming?days=45', { cookie: o.cookie });
    expect(u.body.items.length).toBeGreaterThan(10);
    expect(u.body.items.every((i) => i.date >= today() && i.date <= u.body.end && i.balanceAfter !== null)).toBe(true);
    expect(u.body.items.some((i) => i.type === 'card')).toBe(true);
    expect(u.body.items.some((i) => i.type === 'income')).toBe(true);
    const r = await json<{ items: RecurringDto[]; totals: { monthlyMinor: number; yearlyMinor: number } }>('GET', '/api/recurring', { cookie: o.cookie });
    expect(r.body.totals.monthlyMinor).toBeGreaterThan(1000000);
    expect(r.body.totals.yearlyMinor).toBe(r.body.totals.monthlyMinor * 12);
    expect(r.body.items.some((i) => i.status === 'suggested')).toBe(true);
  });
});

describe('recurring registry, detection, settlement (AC6.1–6.3, AC6.5, AC4.9)', () => {
  it('CRUD, confirm/dismiss suggestions; dismissed patterns are not proposed again', async () => {
    const o = await demo();
    const items = (await json<{ items: RecurringDto[] }>('GET', '/api/recurring', { cookie: o.cookie })).body.items;
    const sug = items.find((i) => i.status === 'suggested')!;
    expect((await json('PATCH', `/api/recurring/${sug.id}`, { cookie: o.cookie, body: { status: 'dismissed' } })).status).toBe(200);
    await json('POST', '/api/recurring/detect', { cookie: o.cookie });
    const after = (await json<{ items: RecurringDto[] }>('GET', '/api/recurring', { cookie: o.cookie })).body.items;
    expect(after.some((i) => i.matchNorm === sug.matchNorm && i.status === 'suggested')).toBe(false);
    expect((await json<{ created: number }>('POST', '/api/recurring/detect', { cookie: o.cookie })).body.created).toBe(0);
    const c = await json<{ id: string }>('POST', '/api/recurring', { cookie: o.cookie, body: { name: 'Gym', kind: 'expense', amountMinor: 19900, cadence: 'monthly', dayOfMonth: 2, anchorDate: '2026-01-02', matchText: 'gym' } });
    expect(c.status).toBe(201);
    expect((await json('PATCH', `/api/recurring/${c.body.id}`, { cookie: o.cookie, body: { status: 'paused' } })).status).toBe(200);
    expect((await json('DELETE', `/api/recurring/${c.body.id}`, { cookie: o.cookie })).status).toBe(200);
  });

  it('after an import: rows link to recurring occurrences, planned items are matched, detection runs', async () => {
    const o = await ownerSetup();
    const acc = (await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'C', type: 'checking' } })).body.id;
    const card = await json<{ id: string }>('POST', '/api/recurring', { cookie: o.cookie, body: { name: 'Isracard', kind: 'card_charge', amountMinor: 700000, cadence: 'monthly', dayOfMonth: 10, anchorDate: '2026-01-10', accountId: acc } });
    const planned = await json<{ id: string }>('POST', '/api/planned', { cookie: o.cookie, body: { name: 'Car test', amountMinor: 145000, date: '2026-09-20', accountId: acc } });
    const rows = [] as Record<string, unknown>[];
    let n = 1;
    for (const m of ['06', '07', '08', '09']) {
      rows.push({ row: n++, date: `2026-${m}-10`, valueDate: null, amountMinor: -650000 - n * 1000, description: 'ישראכרט', reference: `c${m}`, operationType: null, balanceMinor: null, occ: 1 });
      rows.push({ row: n++, date: `2026-${m}-07`, valueDate: null, amountMinor: -5490, description: 'NETFLIX.COM', reference: `n${m}`, operationType: null, balanceMinor: null, occ: 1 });
    }
    rows.push({ row: n, date: '2026-09-22', valueDate: null, amountMinor: -146000, description: 'מכון רישוי', reference: 'r1', operationType: null, balanceMinor: null, occ: 1 });
    const imp = await json<{ importId: string }>('POST', '/api/imports', { cookie: o.cookie, body: { accountId: acc, parserId: 'generic', fileName: 'f.csv', fileHash: 'e'.repeat(64), period: null, rowsTotal: rows.length, rowsError: 0, closingBalance: null } });
    await json('POST', `/api/imports/${imp.body.importId}/rows`, { cookie: o.cookie, body: { rows } });
    expect((await json('POST', `/api/imports/${imp.body.importId}/commit`, { cookie: o.cookie })).status).toBe(200);
    const linked = await DB.prepare('SELECT recurring_due FROM transactions WHERE household_id = ?1 AND recurring_id = ?2 ORDER BY recurring_due').bind(o.householdId, card.body.id).all<{ recurring_due: string }>();
    expect(linked.results.map((r) => r.recurring_due)).toEqual(['2026-06-10', '2026-07-10', '2026-08-10', '2026-09-10']);
    const p = await DB.prepare('SELECT status, matched_tx_id FROM planned_expenses WHERE id = ?1').bind(planned.body.id).first<{ status: string; matched_tx_id: string }>();
    expect(p!.status).toBe('done');
    expect(p!.matched_tx_id).toBeTruthy();
    const items = (await json<{ items: RecurringDto[] }>('GET', '/api/recurring', { cookie: o.cookie })).body.items;
    const netflix = items.find((i) => i.status === 'suggested');
    expect(netflix).toMatchObject({ kind: 'expense', amountMinor: -5490, amountMode: 'fixed', dayOfMonth: 7 });
    // the card estimate is the mean of the last 3 matched charges (AC6.3)
    const cardDto = items.find((i) => i.id === card.body.id)!;
    expect(cardDto.lastSettled).toHaveLength(3);
    expect(cardDto.next!.amountMinor).toBe(Math.round(cardDto.lastSettled.reduce((a, s) => a + s.amountMinor, 0) / 3));
  });

  it('planned by card: status done once the next card charge settles; manual link/unlink', async () => {
    const o = await demo();
    const pl = (await json<{ planned: { id: string; cardRecurringId: string | null; status: string }[] }>('GET', '/api/planned', { cookie: o.cookie })).body.planned;
    expect(pl.find((p) => p.cardRecurringId)!.status).toBe('planned');
    const acc = (await json<{ accounts: { id: string; type: string }[] }>('GET', '/api/accounts', { cookie: o.cookie })).body.accounts.find((a) => a.type === 'checking')!.id;
    const tx = await json<{ id: string }>('POST', '/api/transactions', { cookie: o.cookie, body: { date: today(), amountMinor: 145000, direction: 'out', description: 'test center', accountId: acc } });
    const p = pl.find((x) => !x.cardRecurringId)!;
    expect((await json('PATCH', `/api/planned/${p.id}`, { cookie: o.cookie, body: { matchedTxId: tx.body.id } })).status).toBe(200);
    expect((await json<{ planned: { id: string; status: string }[] }>('GET', '/api/planned', { cookie: o.cookie })).body.planned.find((x) => x.id === p.id)!.status).toBe('done');
    expect((await json('PATCH', `/api/planned/${p.id}`, { cookie: o.cookie, body: { matchedTxId: null, status: 'planned' } })).status).toBe(200);
    expect((await json('DELETE', `/api/planned/${p.id}`, { cookie: o.cookie })).status).toBe(200);
  });
});
