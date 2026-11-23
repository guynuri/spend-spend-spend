import { describe, expect, it } from 'vitest';
import { addMember, json, makeUser, ownerSetup, sessionFor } from './helpers';
import { todayInTz } from '../../src/shared/dates';

type Who = { members: { userId: string; name: string; spentMinor: number }[]; sharedMinor: number; totalMinor: number };

describe('who paid', () => {
  it('counts a line for the account owner, else for whoever added it by hand, else as shared', async () => {
    const o = await ownerSetup('Dana');
    const partner = await makeUser('Noa');
    await addMember(o.householdId, partner, 'member');
    const pc = await sessionFor(partner, o.householdId);
    const today = todayInTz('Asia/Jerusalem');
    const acc = async (name: string, ownerUserId?: string) => (await json<{ id: string }>('POST', '/api/accounts', { cookie: o.cookie, body: { name, type: 'checking', ...(ownerUserId ? { ownerUserId } : {}) } })).body.id;
    const shared = await acc('Joint');
    const noas = await acc('Noa card', partner);
    // an owner must be a member
    const stranger = await makeUser('X');
    expect((await json('POST', '/api/accounts', { cookie: o.cookie, body: { name: 'Bad', type: 'checking', ownerUserId: stranger } })).status).toBe(400);
    const add = (cookie: string, accountId: string, amountMinor: number) => json('POST', '/api/transactions', { cookie, body: { date: today, amountMinor, direction: 'out', description: 'x', accountId } });
    await add(o.cookie, noas, 1000); // on Noa's account, added by Dana → Noa
    await add(o.cookie, shared, 2000); // shared account, added by Dana → Dana
    await add(pc, shared, 300); // shared account, added by Noa → Noa
    await json('POST', '/api/transactions', { cookie: o.cookie, body: { date: today, amountMinor: 999, direction: 'in', description: 'salary', accountId: shared } }); // income: not spending
    const w = (await json<Who>('GET', '/api/dashboard/who', { cookie: o.cookie })).body;
    const by = (name: string) => w.members.find((m) => m.name === name)!.spentMinor;
    expect(by('Dana')).toBe(2000);
    expect(by('Noa')).toBe(1300);
    expect(w.sharedMinor).toBe(0);
    expect(w.totalMinor).toBe(3300);
    // the owner can be changed back to shared: then hand-added rows count for who added them
    expect((await json('PATCH', `/api/accounts/${noas}`, { cookie: o.cookie, body: { ownerUserId: null } })).status).toBe(200);
    const w2 = (await json<Who>('GET', '/api/dashboard/who', { cookie: o.cookie })).body;
    expect(w2.members.find((m) => m.name === 'Dana')!.spentMinor).toBe(3000);
  });
});
