/**
 * Deterministic sample household (PLAN §14): data relative to `today`, in the user's locale.
 * Pure: returns rows; insertion uses the same tenant helpers as the app.
 */
import { addDays, addMonths, clampDay, daysInMonth, monthOf } from '../../shared/dates';
import { normKey } from '../../shared/normalize';
import type { Locale } from '../../shared/money';
import { DEFAULT_CATEGORIES } from './defaults';

type Row = Record<string, string | number | null>;
export interface DemoData {
  accounts: Row[];
  transactions: Row[];
  transaction_splits: Row[];
  account_balances: Row[];
  recurring_items: Row[];
  budgets: Row[];
  goals: Row[];
  goal_contributions: Row[];
  planned_expenses: Row[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Category key → id, resolved from the household's categories by default name in either locale. */
export function categoryKeyMap(cats: { id: string; name: string; system_key: string | null }[]) {
  const m = new Map<string, string>();
  for (const d of DEFAULT_CATEGORIES) {
    const hit = cats.find((c) => (d.systemKey && c.system_key === d.systemKey) || c.name === d.en || c.name === d.he);
    if (hit) m.set(d.key, hit.id);
  }
  return m;
}

const TEXT = {
  he: {
    checking: 'עו״ש משפחתי', savings: 'חיסכון', card: 'כרטיס אשראי',
    salaryA: 'משכורת אלפא מערכות בע״מ', salaryB: 'משכורת עמותת בטא', allowance: 'ביטוח לאומי קצבת ילדים', rent: 'שכר דירה הוראת קבע',
    arnona: 'ארנונה עיריית חולון', electric: 'חברת החשמל לישראל', water: 'מי-חולון תאגיד מים', phone: 'פרטנר תקשורת', internet: 'בזק בינלאומי',
    insurance: 'הראל ביטוח בריאות', netflix: 'NETFLIX.COM', spotify: 'SPOTIFY', gym: 'הולמס פלייס מנוי', daycare: 'מעון הדקל', loan: 'הלוואה פירעון חודשי',
    atm: 'משיכת מזומן כספומט', fees: 'עמלת ניהול חשבון', bit: 'העברה ב-bit', paybox: 'PAYBOX העברה', card_lump: 'ישראכרט חיוב חודשי', shufersal: 'שופרסל דיל',
    refund: 'החזר ZARA', garage: 'מוסך הצפון תיקון', toSavings: 'העברה לחיסכון', fromChecking: 'הפקדה מעו״ש', fuel: 'פז יילו',
    goalEmergency: 'קרן חירום', goalVacation: 'חופשה משפחתית', goalCar: 'רכב חדש', plannedTest: 'טסט לרכב', plannedFlights: 'טיסות לחופשה',
  },
  en: {
    checking: 'Family checking', savings: 'Savings', card: 'Credit card',
    salaryA: 'Salary - Alpha Systems Ltd', salaryB: 'Salary - Beta Association', allowance: 'National Insurance child allowance', rent: 'Rent standing order',
    arnona: 'Municipal tax - Holon', electric: 'Israel Electric Corp', water: 'Holon water utility', phone: 'Partner Communications', internet: 'Bezeq International',
    insurance: 'Harel health insurance', netflix: 'NETFLIX.COM', spotify: 'SPOTIFY', gym: 'Holmes Place membership', daycare: 'Palm daycare', loan: 'Loan repayment',
    atm: 'ATM cash withdrawal', fees: 'Account fee', bit: 'bit transfer', paybox: 'PAYBOX transfer', card_lump: 'Isracard monthly charge', shufersal: 'Shufersal Deal',
    refund: 'ZARA refund', garage: 'North garage repair', toSavings: 'Transfer to savings', fromChecking: 'Deposit from checking', fuel: 'Paz Yellow',
    goalEmergency: 'Emergency fund', goalVacation: 'Family vacation', goalCar: 'New car', plannedTest: 'Car annual test', plannedFlights: 'Vacation flights',
  },
} as const;

export function buildDemo(today: string, locale: Locale, cat: Map<string, string>, newId: () => string, nowIso: string): DemoData {
  const T = TEXT[locale];
  const rnd = mulberry32(20261114);
  const r = (a: number, b: number) => Math.round(a + rnd() * (b - a));
  const curMonth = monthOf(today);
  const firstMonth = addMonths(curMonth, -6);
  const yesterday = addDays(today, -1);
  const checking = newId();
  const savings = newId();
  const d: DemoData = { accounts: [], transactions: [], transaction_splits: [], account_balances: [], recurring_items: [], budgets: [], goals: [], goal_contributions: [], planned_expenses: [] };
  const openingDate = `${firstMonth}-01`;
  d.accounts.push(
    { id: checking, name: T.checking, type: 'checking', institution: locale === 'he' ? 'בנק אוצר החייל' : 'Otsar Ha-Hayal', account_mask: '1234', opening_balance_minor: 820000, opening_date: openingDate, include_in_forecast: 1, is_liquid: 1, created_at: nowIso },
    { id: savings, name: T.savings, type: 'savings', institution: null, account_mask: null, opening_balance_minor: 2500000, opening_date: openingDate, include_in_forecast: 0, is_liquid: 1, created_at: nowIso },
  );

  // Recurring registry (confirmed items + one suggestion).
  const rec = (key: string, name: string, kind: string, amount: number, day: number, cadence = 'monthly', mode = 'fixed', categoryKey: string | null = null, matchText = name, status = 'active', source = 'seed') => {
    const id = newId();
    const anchor = cadence === 'bimonthly' ? clampDay(firstMonth, day) : clampDay(firstMonth, day);
    d.recurring_items.push({ id, name, kind, amount_minor: amount, amount_mode: mode, cadence, day_of_month: day, anchor_date: anchor, start_date: openingDate, end_date: null, account_id: checking, category_id: categoryKey ? (cat.get(categoryKey) ?? null) : null, match_norm: kind === 'card_charge' ? '' : normKey(matchText), status, source, created_at: nowIso });
    return { id, key };
  };
  const R = {
    salaryA: rec('salaryA', T.salaryA, 'income', 1450000, 1, 'monthly', 'fixed', 'salary'),
    salaryB: rec('salaryB', T.salaryB, 'income', 980000, 10, 'monthly', 'fixed', 'salary'),
    allowance: rec('allowance', T.allowance, 'income', 17300, 20, 'monthly', 'fixed', 'benefits'),
    rent: rec('rent', T.rent, 'expense', -520000, 1, 'monthly', 'fixed', 'rent'),
    daycare: rec('daycare', T.daycare, 'expense', -290000, 1, 'monthly', 'fixed', 'education'),
    loan: rec('loan', T.loan, 'expense', -125000, 15, 'monthly', 'fixed', 'loans'),
    insurance: rec('insurance', T.insurance, 'expense', -41000, 5, 'monthly', 'fixed', 'insurance'),
    phone: rec('phone', T.phone, 'expense', -5900, 3, 'monthly', 'fixed', 'phone'),
    internet: rec('internet', T.internet, 'expense', -9900, 3, 'monthly', 'fixed', 'phone'),
    netflix: rec('netflix', T.netflix, 'expense', -5490, 7, 'monthly', 'fixed', 'subscriptions'),
    spotify: rec('spotify', T.spotify, 'expense', -1990, 9, 'monthly', 'fixed', 'subscriptions'),
    gym: rec('gym', T.gym, 'expense', -19900, 2, 'monthly', 'fixed', 'subscriptions'),
    electric: rec('electric', T.electric, 'expense', -32000, 12, 'monthly', 'estimated', 'utilities'),
    arnona: rec('arnona', T.arnona, 'expense', -98000, 15, 'bimonthly', 'fixed', 'utilities'),
    card: rec('card', T.card, 'card_charge', -750000, 10, 'monthly', 'estimated', 'card_unsplit'),
    water: rec('water', T.water, 'expense', -21000, 18, 'bimonthly', 'estimated', 'utilities', T.water, 'suggested', 'detected'),
  };
  if (d.recurring_items[0]) d.recurring_items[d.recurring_items.length - 2]!.name = locale === 'he' ? 'חיוב כרטיס ישראכרט' : 'Isracard charge';

  const tx = (date: string, amount: number, desc: string, catKey: string | null, extra: Row = {}) => {
    if (date >= today) return null;
    const id = newId();
    d.transactions.push({
      id, account_id: checking, date, value_date: date, amount_minor: amount, description: desc, description_norm: normKey(desc), reference: String(r(100000, 999999)), operation_type: null,
      category_id: catKey ? (cat.get(catKey) ?? null) : null, category_source: catKey ? 'rule' : null, has_splits: 0, kind: 'normal', notes: null, recurring_id: null, recurring_due: null,
      planned_id: null, import_id: null, dedupe_key: `m|${id}`, balance_after_minor: null, source: 'manual', created_by: null, created_at: nowIso, updated_at: nowIso, ...extra,
    });
    return id;
  };
  const recTx = (item: { id: string }, due: string, amount: number, desc: string, catKey: string | null, shift = 0, extra: Row = {}) =>
    tx(addDays(due, shift), amount, desc, catKey, { recurring_id: item.id, recurring_due: due, ...extra });

  const months: string[] = [];
  for (let m = firstMonth; m <= curMonth; m = addMonths(m, 1)) months.push(m);
  const lumps: { id: string; month: string; amount: number }[] = [];
  months.forEach((m, mi) => {
    const day = (n: number) => clampDay(m, n);
    recTx(R.salaryA, day(1), 1450000, T.salaryA, 'salary');
    recTx(R.salaryB, day(10), 980000, T.salaryB, 'salary');
    recTx(R.allowance, day(20), 17300, T.allowance, 'benefits');
    recTx(R.rent, day(1), -520000, T.rent, 'rent');
    recTx(R.daycare, day(1), -290000, T.daycare, 'education');
    recTx(R.loan, day(15), -125000, T.loan, 'loans');
    recTx(R.insurance, day(5), -41000, T.insurance, 'insurance');
    recTx(R.phone, day(3), -5900, T.phone, 'phone');
    recTx(R.internet, day(3), -9900, T.internet, 'phone');
    recTx(R.netflix, day(7), -5490, T.netflix, 'subscriptions');
    recTx(R.spotify, day(9), -1990, T.spotify, 'subscriptions');
    recTx(R.gym, day(2), -19900, T.gym, 'subscriptions');
    recTx(R.electric, day(12), -r(26000, 41000), T.electric, 'utilities');
    if (mi % 2 === 0) recTx(R.arnona, day(15), -98000, T.arnona, 'utilities');
    if (mi % 2 === 1) recTx(R.water, day(18), -r(18000, 24000), T.water, 'utilities', 1, { recurring_id: null, recurring_due: null });
    tx(day(11), -100000, T.toSavings, 'savings');
    d.transactions.push({
      id: newId(), account_id: savings, date: day(11), value_date: day(11), amount_minor: 100000, description: T.fromChecking, description_norm: normKey(T.fromChecking), reference: null, operation_type: null,
      category_id: cat.get('savings') ?? null, category_source: 'rule', has_splits: 0, kind: 'normal', notes: null, recurring_id: null, recurring_due: null, planned_id: null, import_id: null,
      dedupe_key: `m|sv${mi}`, balance_after_minor: null, source: 'manual', created_by: null, created_at: nowIso, updated_at: nowIso,
    });
    if (day(11) >= today) d.transactions.pop();
    tx(day(6), -r(3, 5) * 10000, T.atm, 'cash');
    tx(day(22), -r(2, 4) * 10000, T.atm, 'cash');
    tx(monthEndDay(m), -1250, T.fees, 'bank_fees');
    tx(day(8), -r(80, 250) * 100, T.bit, null);
    tx(day(19), -r(50, 150) * 100, T.paybox, null);
    tx(day(14), -r(150, 450) * 100, T.shufersal, 'groceries');
    tx(day(24), -r(150, 380) * 100, T.shufersal, 'groceries');
    tx(day(17), -r(180, 320) * 100, T.fuel, 'transport');
    const lumpAmount = -r(600000, 900000);
    const lid = recTx(R.card, day(10), lumpAmount, T.card_lump, 'card_unsplit', 0, { kind: 'card_lump' });
    if (lid) lumps.push({ id: lid, month: m, amount: lumpAmount });
    if (mi === 2) tx(day(13), 18900, T.refund, 'clothing');
    if (mi === 4) tx(day(21), -480000, T.garage, 'car');
  });
  // Split every card lump except the latest one.
  const shares: [string, number][] = [['groceries', 0.4], ['eating_out', 0.12], ['transport', 0.14], ['leisure', 0.1], ['clothing', 0.09], ['health', 0.08], ['home', 0.07]];
  lumps.slice(0, -1).forEach((l) => {
    let left = l.amount;
    shares.forEach(([k, s], i) => {
      const amt = i === shares.length - 1 ? left : Math.round(l.amount * (s + (rnd() - 0.5) * 0.04));
      left -= amt;
      d.transaction_splits.push({ id: newId(), transaction_id: l.id, category_id: cat.get(k) ?? null, amount_minor: amt, note: null });
    });
    const t = d.transactions.find((x) => x.id === l.id)!;
    t.has_splits = 1;
  });

  // Balance snapshot as of yesterday = opening + Σ checking transactions.
  const bal = 820000 + d.transactions.filter((t) => t.account_id === checking).reduce((a, t) => a + (t.amount_minor as number), 0);
  d.account_balances.push({ id: newId(), account_id: checking, date: yesterday, balance_minor: bal, source: 'manual', import_id: null });

  // Budgets for 12 expense categories (two over, one around 90 % in the last full month).
  const budget = (k: string, limit: number) => cat.get(k) && d.budgets.push({ id: newId(), category_id: cat.get(k)!, effective_from: firstMonth, limit_minor: limit });
  budget('groceries', 280000);
  budget('eating_out', 70000);
  budget('transport', 150000);
  budget('leisure', 60000);
  budget('clothing', 50000);
  budget('health', 80000);
  budget('home', 60000);
  budget('cash', 90000);
  budget('subscriptions', 30000);
  budget('utilities', 120000);
  budget('phone', 16000);
  budget('car', 40000);

  // Goals.
  const goal = (name: string, target: number, start: number, startDate: string, targetDate: string | null, priority: number, monthly: number) => {
    const id = newId();
    d.goals.push({ id, name, description: null, target_minor: target, start_minor: start, start_date: startDate, target_date: targetDate, priority, status: 'active', created_at: nowIso });
    months.slice(0, -1).forEach((m) => monthly && d.goal_contributions.push({ id: newId(), goal_id: id, date: clampDay(m, 11), amount_minor: monthly, note: null, transaction_id: null }));
  };
  goal(T.goalEmergency, 6000000, 2500000, openingDate, `${addMonths(curMonth, 12)}-01`, 1, 250000);
  goal(T.goalVacation, 1500000, 200000, openingDate, `${addMonths(curMonth, 3)}-15`, 2, 50000);
  goal(T.goalCar, 8000000, 1000000, openingDate, null, 3, 0);

  // Planned: car test next week (account), flights next month by card.
  d.planned_expenses.push(
    { id: newId(), name: T.plannedTest, amount_minor: -145000, date: addDays(today, 7), category_id: cat.get('car') ?? null, account_id: checking, card_recurring_id: null, status: 'planned', matched_tx_id: null, notes: null, created_at: nowIso },
    { id: newId(), name: T.plannedFlights, amount_minor: -320000, date: clampDay(addMonths(curMonth, 1), 5), category_id: cat.get('travel') ?? null, account_id: null, card_recurring_id: R.card.id, status: 'planned', matched_tx_id: null, notes: null, created_at: nowIso },
  );
  return d;
}

function monthEndDay(m: string) {
  return clampDay(m, daysInMonth(m));
}

export const DEMO_TABLE_ORDER: (keyof DemoData)[] = ['accounts', 'recurring_items', 'planned_expenses', 'transactions', 'transaction_splits', 'account_balances', 'budgets', 'goals', 'goal_contributions'];
