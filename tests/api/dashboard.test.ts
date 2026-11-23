import { describe, expect, it } from 'vitest';
import { DB, json, makeUser, ownerSetup, sessionFor } from './helpers';
import { TENANT_TABLES } from '../../src/server/db/tables';
import { addMonths, monthEnd, monthOf, todayInTz } from '../../src/shared/dates';
import type { BudgetView } from '../../src/shared/domain/budget';
import type { UsualMonth } from '../../src/shared/domain/usual';

async function demo() {
  const o = await ownerSetup('Owner', 'Demo home');
  await json('POST', '/api/household/sample-data', { cookie: o.cookie });
  return o;
}
type Dash = {
  month: string;
  onboarding: boolean;
  hasSampleData: boolean;
  pnl: { incomeMinor: number; expensesMinor: number; expectedExpensesMinor: number | null };
  budget: { totals: BudgetView['totals'] };
  upcoming: unknown[];
  goals: { summary: { activeCount: number; behindCount: number } };
  health: { overall: number | null; trend: { overall: number | null }[]; change: number | null };
  insights: { key: string; severity: string; href: string }[];
  forecast: { eom: { balance: number } };
  usual: UsualMonth | null;
};

describe('dashboard (AC11.1–11.3, AC5.4)', () => {
  it('empty household → onboarding', async () => {
    const o = await ownerSetup();
    const d = await json<Dash>('GET', '/api/dashboard', { cookie: o.cookie });
    expect(d.status).toBe(200);
    expect(d.body.onboarding).toBe(true);
    expect(d.body.health.overall).toBeNull();
  });

  it('demo: same budget numbers as the budget page; health, goals, insights, upcoming', async () => {
    const o = await demo();
    const d = (await json<Dash>('GET', '/api/dashboard', { cookie: o.cookie })).body;
    expect(d.onboarding).toBe(false);
    expect(d.hasSampleData).toBe(true);
    const b = (await json<BudgetView>('GET', `/api/budgets?month=${d.month}`, { cookie: o.cookie })).body;
    expect(d.budget.totals).toEqual(b.totals);
    expect(d.health.overall).not.toBeNull();
    expect(d.health.trend).toHaveLength(6);
    expect(d.goals.summary.activeCount).toBe(3);
    expect(d.goals.summary.behindCount).toBeGreaterThanOrEqual(1);
    expect(d.upcoming.length).toBeLessThanOrEqual(5);
    expect(d.insights.length).toBeGreaterThan(0);
    expect(d.insights.length).toBeLessThanOrEqual(8);
    const order = { alert: 0, warn: 1, info: 2, good: 3 } as Record<string, number>;
    for (let i = 1; i < d.insights.length; i++) expect(order[d.insights[i - 1]!.severity]!).toBeLessThanOrEqual(order[d.insights[i]!.severity]!);
    expect(d.insights.every((i) => i.href.startsWith('/'))).toBe(true);
    if (d.month === monthOf(todayInTz('Asia/Jerusalem'))) expect(d.pnl.expectedExpensesMinor!).toBeGreaterThanOrEqual(d.pnl.expensesMinor);
  });

  it('usual month: averages over complete months before the shown one; same numbers as Trends', async () => {
    const empty = await ownerSetup();
    expect((await json<Dash>('GET', '/api/dashboard', { cookie: empty.cookie })).body.usual).toBeNull();
    const o = await demo();
    const d = (await json<Dash>('GET', '/api/dashboard', { cookie: o.cookie })).body;
    const u = d.usual!;
    expect(u.months.length).toBeGreaterThan(0);
    expect(u.months.length).toBeLessThanOrEqual(6);
    expect(u.months.every((m) => m < d.month)).toBe(true);
    expect(u.items.length).toBeGreaterThan(0);
    for (let i = 1; i < u.items.length; i++) expect(u.items[i - 1]!.avgMinor).toBeGreaterThanOrEqual(u.items[i]!.avgMinor);
    // Each average = that category's spending in Trends over the same months ÷ number of months.
    const from = `${u.months[0]}-01`;
    const to = monthEnd(u.months[u.months.length - 1]!);
    const tr = (await json<{ items: { categoryId: string | null; spentMinor: number }[] }>('GET', `/api/trends/categories?from=${from}&to=${to}`, { cookie: o.cookie })).body.items;
    for (const it of u.items) expect(it.avgMinor).toBe(Math.round(tr.find((x) => x.categoryId === it.categoryId)!.spentMinor / u.months.length));
    if (u.avgIncomeMinor > 0) expect(u.spendShareOfIncome).toBeCloseTo(u.avgExpensesMinor / u.avgIncomeMinor, 6);
  });

  it('health endpoint and goals CRUD with contributions completing a goal', async () => {
    const o = await demo();
    const h = await json<{ overall: number; subs: Record<string, { score: number | null }>; recommendations: { key: string; gain: number }[] }>('GET', '/api/health-score?months=6', { cookie: o.cookie });
    expect(h.body.overall).toBeGreaterThan(0);
    expect(Object.keys(h.body.subs).sort()).toEqual(['budget', 'cushion', 'debt', 'goals', 'savings']);
    const g = await json<{ id: string }>('POST', '/api/goals', { cookie: o.cookie, body: { name: 'Bike', targetMinor: 100000, targetDate: '2030-01-01' } });
    expect(g.status).toBe(201);
    await json('POST', `/api/goals/${g.body.id}/contributions`, { cookie: o.cookie, body: { date: todayInTz('Asia/Jerusalem'), amountMinor: 50000 } });
    let goals: { id: string; status: string; progress?: number; milestones?: unknown[] }[] = (await json<{ goals: { id: string; status: string; progress: number; milestones: unknown[] }[] }>('GET', '/api/goals', { cookie: o.cookie })).body.goals;
    expect(goals.find((x) => x.id === g.body.id)).toMatchObject({ progress: 0.5 });
    expect(goals.find((x) => x.id === g.body.id)!.milestones).toHaveLength(2);
    const c2 = await json<{ id: string }>('POST', `/api/goals/${g.body.id}/contributions`, { cookie: o.cookie, body: { date: todayInTz('Asia/Jerusalem'), amountMinor: 50000 } });
    goals = (await json<{ goals: { id: string; status: string }[] }>('GET', '/api/goals', { cookie: o.cookie })).body.goals;
    expect(goals.find((x) => x.id === g.body.id)!.status).toBe('completed');
    await json('DELETE', `/api/goals/${g.body.id}/contributions/${c2.body.id}`, { cookie: o.cookie });
    goals = (await json<{ goals: { id: string; status: string }[] }>('GET', '/api/goals', { cookie: o.cookie })).body.goals;
    expect(goals.find((x) => x.id === g.body.id)!.status).toBe('on_track');
    expect((await json('PATCH', `/api/goals/${g.body.id}`, { cookie: o.cookie, body: { status: 'archived' } })).status).toBe(200);
    expect((await json('DELETE', `/api/goals/${g.body.id}`, { cookie: o.cookie })).status).toBe(200);
  });
});

describe('data control (AC15.1)', () => {
  const count = async (hid: string) => {
    let n = 0;
    for (const t of TENANT_TABLES) if (t !== 'audit_log' && t !== 'categories' && t !== 'category_rules') n += (await DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE household_id = ?1`).bind(hid).first<{ n: number }>())!.n;
    return n;
  };
  it('reset needs the typed household name, removes all data, keeps defaults; only owners', async () => {
    const o = await demo();
    const v = await makeUser('Member');
    await DB.prepare("INSERT INTO memberships (household_id, user_id, role, created_at) VALUES (?1, ?2, 'member', 'x')").bind(o.householdId, v).run();
    expect((await json<{ error: { code: string } }>('POST', '/api/household/reset', { cookie: await sessionFor(v, o.householdId), body: { confirm: 'Demo home' } })).body.error.code).toBe('forbidden_role');
    expect((await json<{ error: { code: string } }>('POST', '/api/household/reset', { cookie: o.cookie, body: { confirm: 'nope' } })).body.error.code).toBe('confirm_mismatch');
    expect(await count(o.householdId)).toBeGreaterThan(100);
    expect((await json('POST', '/api/household/reset', { cookie: o.cookie, body: { confirm: 'Demo home' } })).status).toBe(200);
    expect(await count(o.householdId)).toBe(0);
    const cats = (await DB.prepare('SELECT COUNT(*) AS n FROM categories WHERE household_id = ?1').bind(o.householdId).first<{ n: number }>())!.n;
    expect(cats).toBe(20);
    expect((await json<{ active: { hasSampleData: boolean } }>('GET', '/api/me', { cookie: o.cookie })).body.active.hasSampleData).toBe(false);
    expect((await json<Dash>('GET', '/api/dashboard', { cookie: o.cookie })).body.onboarding).toBe(true);
  });
  it('delete household removes every tenant row and the household', async () => {
    const o = await demo();
    expect((await json('DELETE', '/api/household', { cookie: o.cookie, body: { confirm: 'Demo home' } })).status).toBe(200);
    for (const t of TENANT_TABLES) expect((await DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE household_id = ?1`).bind(o.householdId).first<{ n: number }>())!.n, t).toBe(0);
    expect(await DB.prepare('SELECT id FROM households WHERE id = ?1').bind(o.householdId).first()).toBeNull();
    expect((await json<{ active: unknown; households: unknown[] }>('GET', '/api/me', { cookie: o.cookie })).body).toMatchObject({ active: null, households: [] });
    void addMonths;
  });
});
