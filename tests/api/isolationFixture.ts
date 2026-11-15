/** Two households for the isolation suite. B's tenant text fields contain ZZ-B-CANARY. */
import { DB, addMember, json, makeHousehold, makeInvite, makeUser, sessionFor } from './helpers';

export interface Side {
  householdId: string;
  ownerId: string;
  memberId: string;
  ownerCookie: string;
  inviteId: string;
  ids: Record<string, string>;
}
export interface IsoFixture {
  a: Side;
  b: Side;
  idForB(pattern: string, param: string): string;
  idForA(pattern: string, param: string): string;
  /** A valid body for the route; foreign ids taken from `side`. */
  bodyFor(routeKey: string, side: 'A' | 'B'): unknown;
  queriesFor(pattern: string): string[];
}

const C = 'ZZ-B-CANARY';

async function side(label: 'A' | 'B'): Promise<Side> {
  const meta = label === 'B' ? ' ZZ-B-META' : '';
  const tag = label === 'B' ? ` ${C}` : '';
  const ownerId = await makeUser(`Owner ${label}${meta}`);
  const memberId = await makeUser(`Member ${label}${meta}`);
  const householdId = await makeHousehold(`Home ${label}${meta}`, ownerId);
  await addMember(householdId, memberId, 'member');
  const inv = await makeInvite({ kind: 'member', householdId, role: 'member' });
  if (label === 'B') await DB.prepare('UPDATE invites SET note = ?2 WHERE id = ?1').bind(inv.id, C).run();
  const cookie = await sessionFor(ownerId, householdId);
  const post = async (path: string, body: unknown) => {
    const r = await json<Record<string, unknown>>('POST', path, { cookie, body });
    if (r.status >= 300) throw new Error(`${path} ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const ids: Record<string, string> = {};
  await post('/api/household/sample-data', {});
  if (label === 'B') {
    const upd: [string, string[]][] = [
      ['accounts', ['name', 'institution']],
      ['transactions', ['description', 'notes', 'reference']],
      ['transaction_splits', ['note']],
      ['recurring_items', ['name']],
      ['planned_expenses', ['name', 'notes']],
      ['goals', ['name', 'description']],
      ['goal_contributions', ['note']],
      ['categories', ['name']],
    ];
    await DB.batch(upd.map(([t, cols]) => DB.prepare(`UPDATE ${t} SET ${cols.map((c) => `${c} = COALESCE(${c}, '') || ' ${C}'`).join(', ')} WHERE household_id = ?1`).bind(householdId)));
  }
  ids.account = (await post('/api/accounts', { name: `Checking${tag}`, type: 'checking', institution: `Bank${tag}`, openingBalanceMinor: 100000, openingDate: '2026-01-01' })).id as string;
  ids.category = (await post('/api/categories', { name: `Cat${tag}`, kind: 'expense', grp: 'variable' })).id as string;
  ids.rule = (await post('/api/rules', { field: 'description', match: 'contains', pattern: `rule${tag}`, sign: 'any', categoryId: ids.category })).id as string;
  const today = new Date().toISOString().slice(0, 10);
  ids.tx = (await post('/api/transactions', { date: today, amountMinor: 12345, direction: 'out', description: `Shop${tag}`, accountId: ids.account, categoryId: ids.category, notes: `note${tag}` })).id as string;
  ids.lump = (await post('/api/transactions', { date: today, amountMinor: 50000, direction: 'out', description: `ישראכרט${tag}`, accountId: ids.account })).id as string;
  const cats = (await json<{ categories: { id: string; kind: string }[] }>('GET', '/api/categories', { cookie })).body.categories.filter((c) => c.kind === 'expense');
  const wire = { row: 1, date: today, valueDate: null, amountMinor: -777, description: `Imported${tag}`, reference: `R${tag}`.slice(0, 40), operationType: null, balanceMinor: 5000, occ: 1 };
  ids.import = (await post('/api/imports', { accountId: ids.account, parserId: 'generic', fileName: `f${tag}.csv`, fileHash: 'b'.repeat(64), period: null, rowsTotal: 1, rowsError: 0, closingBalance: { date: today, minor: 5000 } })).importId as string;
  await post(`/api/imports/${ids.import}/rows`, { rows: [wire] });
  await post(`/api/imports/${ids.import}/commit`, {});
  ids.openImport = (await post('/api/imports', { accountId: ids.account, parserId: 'generic', fileName: 'open.csv', fileHash: 'c'.repeat(64), period: null, rowsTotal: 1, rowsError: 0, closingBalance: null })).importId as string;
  await json('PUT', '/api/import-profiles', { cookie, body: { accountId: ids.account, headerSignature: `sig${tag}`, mapping: { headerRow: 0, columns: { date: 0 }, dateFormat: 'dmy', negate: false } } });
  await json('PUT', `/api/transactions/${ids.lump}/splits`, { cookie, body: { lines: [{ categoryId: cats[0]!.id, amountMinor: -30000, note: `split${tag}` }, { categoryId: ids.category, amountMinor: -20000 }] } });
  return { householdId, ownerId, memberId, ownerCookie: cookie, inviteId: inv.id, ids };
}

export async function buildIsolationFixture(): Promise<IsoFixture> {
  const a = await side('A');
  const b = await side('B');
  const idFor = (s: Side, pattern: string, param: string): string => {
    if (param === 'userId') return s.memberId;
    if (pattern.startsWith('/api/household/invites')) return s.inviteId;
    if (pattern.startsWith('/api/accounts/')) return s.ids.account!;
    if (pattern.startsWith('/api/categories/')) return s.ids.category!;
    if (pattern.startsWith('/api/rules/')) return s.ids.rule!;
    if (pattern.startsWith('/api/transactions/')) return s.ids.tx!;
    if (pattern === '/api/imports/:id/rows' || pattern === '/api/imports/:id/commit') return s.ids.openImport!;
    if (pattern.startsWith('/api/imports/')) return s.ids.import!;
    throw new Error(`no id mapping for ${pattern} :${param}`);
  };
  const bodyFor = (key: string, sideL: 'A' | 'B'): unknown => {
    const s = sideL === 'A' ? a : b;
    const today = new Date().toISOString().slice(0, 10);
    switch (key) {
      case 'PATCH /api/household/members/:userId':
        return { role: 'viewer' };
      case 'PATCH /api/accounts/:id':
        return { name: 'x' };
      case 'POST /api/accounts/:id/balance':
        return { date: today, balanceMinor: 1 };
      case 'PATCH /api/categories/:id':
        return { name: 'renamed' };
      case 'POST /api/rules':
        return { field: 'description', match: 'contains', pattern: 'zz', sign: 'any', categoryId: s.ids.category };
      case 'PATCH /api/rules/:id':
        return { categoryId: s.ids.category };
      case 'POST /api/transactions':
        return { date: today, amountMinor: 1, direction: 'out', description: 'x', accountId: s.ids.account };
      case 'PATCH /api/transactions/:id':
        return { categoryId: s.ids.category, notes: 'x' };
      case 'PUT /api/transactions/:id/splits':
        return { lines: [] };
      case 'POST /api/transactions/bulk':
        return { ids: [s.ids.tx], categoryId: a.ids.category };
      case 'POST /api/transactions/undo-learn':
        return { ruleId: s.ids.rule, txIds: [s.ids.tx] };
      case 'POST /api/imports/preview':
        return { accountId: s.ids.account, rows: [{ row: 1, date: today, valueDate: null, amountMinor: -1, description: 'x', reference: null, operationType: null, balanceMinor: null, occ: 1 }] };
      case 'POST /api/imports':
        return { accountId: s.ids.account, parserId: 'generic', fileName: 'x', fileHash: 'd'.repeat(64), period: null, rowsTotal: 0, rowsError: 0, closingBalance: null };
      case 'POST /api/imports/:id/rows':
        return { rows: [{ row: 1, date: today, valueDate: null, amountMinor: -1, description: 'x', reference: null, operationType: null, balanceMinor: null, occ: 1 }] };
      case 'PUT /api/budgets':
        return { month: today.slice(0, 7), items: [{ categoryId: s.ids.category, limitMinor: 100 }] };
      case 'PUT /api/import-profiles':
        return { accountId: s.ids.account, headerSignature: 'zz', mapping: { headerRow: 0, columns: {}, dateFormat: 'dmy', negate: false } };
      default:
        return undefined;
    }
  };
  return {
    a,
    b,
    idForB: (p, n) => idFor(b, p, n),
    idForA: (p, n) => idFor(a, p, n),
    bodyFor,
    queriesFor: (pattern) => {
      if (pattern.startsWith('/api/transactions')) {
        const from = '2000-01-01';
        return ['', `?from=${from}&to=2100-01-01`, `?from=${from}&to=2100-01-01&account=${b.ids.account}`, `?from=${from}&to=2100-01-01&category=${b.ids.category}`, `?from=${from}&to=2100-01-01&q=CANARY`];
      }
      if (pattern === '/api/trends/monthly') return ['', `?category=${b.ids.category}`];
      if (pattern === '/api/import-profiles') return [`?accountId=${a.ids.account}`, `?accountId=${b.ids.account}`];
      return [''];
    },
  };
}
