/** Two households for the isolation suite. B's tenant text fields contain ZZ-B-CANARY. */
import { DB, addMember, makeHousehold, makeInvite, makeUser, sessionFor } from './helpers';

export interface Side {
  householdId: string;
  ownerId: string;
  memberId: string;
  ownerCookie: string;
  inviteId: string;
}
export interface IsoFixture {
  a: Side;
  b: Side;
  idForB(pattern: string, param: string): string;
  idForA(pattern: string, param: string): string;
  bodyFor(routeKey: string, side: 'A' | 'B'): unknown;
  queriesFor(pattern: string): string[];
}

async function side(label: 'A' | 'B'): Promise<Side> {
  const meta = label === 'B' ? ' ZZ-B-META' : '';
  const ownerId = await makeUser(`Owner ${label}${meta}`);
  const memberId = await makeUser(`Member ${label}${meta}`);
  const householdId = await makeHousehold(`Home ${label}${meta}`, ownerId);
  await addMember(householdId, memberId, 'member');
  const inv = await makeInvite({ kind: 'member', householdId, role: 'member' });
  if (label === 'B') await DB.prepare("UPDATE invites SET note = 'ZZ-B-CANARY' WHERE id = ?1").bind(inv.id).run();
  return { householdId, ownerId, memberId, ownerCookie: await sessionFor(ownerId, householdId), inviteId: inv.id };
}

export async function buildIsolationFixture(): Promise<IsoFixture> {
  const a = await side('A');
  const b = await side('B');
  const ids = (s: Side, pattern: string, param: string): string => {
    if (param === 'userId') return s.memberId;
    if (pattern.startsWith('/api/household/invites')) return s.inviteId;
    throw new Error(`no id mapping for ${pattern} :${param}`);
  };
  return {
    a,
    b,
    idForB: (p, n) => ids(b, p, n),
    idForA: (p, n) => ids(a, p, n),
    bodyFor: (key) => {
      if (key === 'PATCH /api/household/members/:userId') return { role: 'viewer' };
      return undefined;
    },
    queriesFor: () => [''],
  };
}
