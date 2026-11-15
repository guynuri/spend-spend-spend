/** Default categories and seed rules created for every new household (PLAN §5.3). */
import type { Locale } from '../../shared/money';
import { norm } from '../../shared/normalize';
import { newId, nowIso } from '../lib/crypto';

export interface DefaultCategory {
  key: string;
  en: string;
  he: string;
  kind: 'income' | 'expense' | 'transfer';
  grp: 'fixed' | 'variable' | null;
  isDebt?: boolean;
  systemKey?: string;
  icon: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: 'salary', en: 'Salary', he: 'משכורת', kind: 'income', grp: null, icon: 'briefcase' },
  { key: 'benefits', en: 'Benefits & allowances', he: 'קצבאות והטבות', kind: 'income', grp: null, icon: 'hand-coins' },
  { key: 'other_income', en: 'Other income', he: 'הכנסות אחרות', kind: 'income', grp: null, icon: 'plus-circle' },
  { key: 'rent', en: 'Rent', he: 'שכר דירה', kind: 'expense', grp: 'fixed', icon: 'home' },
  { key: 'mortgage', en: 'Mortgage', he: 'משכנתא', kind: 'expense', grp: 'fixed', isDebt: true, icon: 'landmark' },
  { key: 'loans', en: 'Loans', he: 'הלוואות', kind: 'expense', grp: 'fixed', isDebt: true, icon: 'banknote' },
  { key: 'utilities', en: 'Municipal tax & utilities', he: 'ארנונה וחשבונות', kind: 'expense', grp: 'fixed', icon: 'zap' },
  { key: 'phone', en: 'Phone & internet', he: 'טלפון ואינטרנט', kind: 'expense', grp: 'fixed', icon: 'smartphone' },
  { key: 'insurance', en: 'Insurance', he: 'ביטוחים', kind: 'expense', grp: 'fixed', icon: 'shield' },
  { key: 'education', en: 'Education & childcare', he: 'חינוך ומסגרות', kind: 'expense', grp: 'fixed', icon: 'graduation-cap' },
  { key: 'subscriptions', en: 'Subscriptions', he: 'מנויים', kind: 'expense', grp: 'fixed', icon: 'repeat' },
  { key: 'bank_fees', en: 'Bank fees', he: 'עמלות בנק', kind: 'expense', grp: 'fixed', icon: 'percent' },
  { key: 'groceries', en: 'Groceries', he: 'סופר ומכולת', kind: 'expense', grp: 'variable', icon: 'shopping-cart' },
  { key: 'eating_out', en: 'Eating out', he: 'אוכל בחוץ', kind: 'expense', grp: 'variable', icon: 'utensils' },
  { key: 'transport', en: 'Transport & fuel', he: 'תחבורה ודלק', kind: 'expense', grp: 'variable', icon: 'fuel' },
  { key: 'car', en: 'Car', he: 'רכב', kind: 'expense', grp: 'variable', icon: 'car' },
  { key: 'health', en: 'Health', he: 'בריאות', kind: 'expense', grp: 'variable', icon: 'heart-pulse' },
  { key: 'clothing', en: 'Clothing', he: 'ביגוד והנעלה', kind: 'expense', grp: 'variable', icon: 'shirt' },
  { key: 'home', en: 'Home', he: 'בית', kind: 'expense', grp: 'variable', icon: 'sofa' },
  { key: 'leisure', en: 'Leisure', he: 'פנאי', kind: 'expense', grp: 'variable', icon: 'ticket' },
  { key: 'kids', en: 'Kids', he: 'ילדים', kind: 'expense', grp: 'variable', icon: 'baby' },
  { key: 'gifts', en: 'Gifts & donations', he: 'מתנות ותרומות', kind: 'expense', grp: 'variable', icon: 'gift' },
  { key: 'travel', en: 'Travel', he: 'חופשות', kind: 'expense', grp: 'variable', icon: 'plane' },
  { key: 'cash', en: 'Cash withdrawals', he: 'משיכות מזומן', kind: 'expense', grp: 'variable', icon: 'wallet' },
  { key: 'card_unsplit', en: 'Credit card (not split)', he: 'כרטיס אשראי (לא מפוצל)', kind: 'expense', grp: 'variable', systemKey: 'card_unsplit', icon: 'credit-card' },
  { key: 'other', en: 'Other', he: 'אחר', kind: 'expense', grp: 'variable', icon: 'circle-help' },
  { key: 'transfers', en: 'Internal transfers', he: 'העברות פנימיות', kind: 'transfer', grp: null, systemKey: 'transfer', icon: 'arrow-left-right' },
  { key: 'savings', en: 'Savings & investments', he: 'חיסכון והשקעות', kind: 'transfer', grp: null, icon: 'piggy-bank' },
];

type SeedRule = { field: 'description' | 'operation_type'; match: 'contains' | 'equals' | 'starts_with'; pattern: string; sign: 'any' | 'in' | 'out'; cat: string };
const c = (pattern: string, cat: string, sign: SeedRule['sign'] = 'any', field: SeedRule['field'] = 'description'): SeedRule => ({ field, match: 'contains', pattern, sign, cat });

export const SEED_RULES: SeedRule[] = [
  c('משכורת', 'salary', 'in'),
  c('שכר', 'salary', 'in'),
  c('משכורת', 'salary', 'in', 'operation_type'),
  c('ביטוח לאומי', 'benefits', 'in'),
  c('קצבת', 'benefits', 'in'),
  c('ארנונה', 'utilities', 'out'),
  c('חברת החשמל', 'utilities', 'out'),
  c('חשמל', 'utilities', 'out'),
  c('מי-', 'utilities', 'out'),
  c('תאגיד מים', 'utilities', 'out'),
  c('גז', 'utilities', 'out'),
  c('בזק', 'phone', 'out'),
  c('פרטנר', 'phone', 'out'),
  c('סלקום', 'phone', 'out'),
  c('הוט', 'phone', 'out'),
  c('פלאפון', 'phone', 'out'),
  c('שופרסל', 'groceries', 'out'),
  c('רמי לוי', 'groceries', 'out'),
  c('ויקטורי', 'groceries', 'out'),
  c('יוחננוף', 'groceries', 'out'),
  c('פז ', 'transport', 'out'),
  c('דלק', 'transport', 'out'),
  c('סונול', 'transport', 'out'),
  c('רב קו', 'transport', 'out'),
  c('מכבי', 'health', 'out'),
  c('כללית', 'health', 'out'),
  c('מאוחדת', 'health', 'out'),
  c('סופר-פארם', 'health', 'out'),
  c('סופר פארם', 'health', 'out'),
  c('עמלה', 'bank_fees', 'out'),
  c('דמי ניהול', 'bank_fees', 'out'),
  c('עמלה', 'bank_fees', 'out', 'operation_type'),
  c('משכנתא', 'mortgage', 'out'),
  c('הלוואה', 'loans', 'out'),
  c('הלוואה', 'loans', 'out', 'operation_type'),
  c('משיכת מזומן', 'cash', 'out'),
  c('כספומט', 'cash', 'out'),
  c('משיכת מזומן', 'cash', 'out', 'operation_type'),
  c('ביטוח', 'insurance', 'out'),
  c('מעון', 'education', 'out'),
  c('גן ילדים', 'education', 'out'),
];

export { CARD_ISSUER_PATTERNS } from '../../shared/domain/constants';

type Stmt<S> = (table: string, row: Record<string, string | number | null>) => S;

/** Statements that create the default categories and seed rules for a household. */
export function defaultCategoryStatements<S>(insert: Stmt<S>, locale: Locale) {
  const ids = new Map<string, string>();
  const stmts: S[] = [];
  DEFAULT_CATEGORIES.forEach((d, i) => {
    const id = newId();
    ids.set(d.key, id);
    stmts.push(insert('categories', { id, name: locale === 'he' ? d.he : d.en, kind: d.kind, grp: d.grp, is_debt: d.isDebt ? 1 : 0, system_key: d.systemKey ?? null, icon: d.icon, sort: i }));
  });
  const now = nowIso();
  const seen = new Set<string>();
  for (const r of SEED_RULES) {
    const pat = norm(r.pattern);
    const k = `${r.field}|${r.match}|${pat}|${r.sign}`;
    if (seen.has(k)) continue;
    seen.add(k);
    stmts.push(insert('category_rules', { id: newId(), field: r.field, match: r.match, pattern_norm: pat, sign: r.sign, category_id: ids.get(r.cat)!, source: 'seed', created_at: now }));
  }
  return { stmts, ids };
}
