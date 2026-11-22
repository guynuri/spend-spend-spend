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
  /** How it is budgeted (default monthly): see BudgetMode. */
  mode?: 'general' | 'occasional';
  systemKey?: string;
  icon: string;
  /** Default look: an emoji and a palette slot (shared/categoryLook.ts). */
  emoji: string;
  color: string;
  /** Not seeded: offered in the "add category" catalog instead (keeps new households short). */
  extra?: true;
  /** Earlier default names, still matched for households created with them. */
  aliases?: string[];
}

/** Every name a household may have this default under. */
export const defaultNames = (d: DefaultCategory) => [d.en, d.he, ...(d.aliases ?? [])];

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: 'salary', en: 'Salary', he: 'משכורת', kind: 'income', grp: null, emoji: '💼', color: 'cat-6', icon: 'briefcase' },
  { key: 'benefits', en: 'Benefits & allowances', he: 'קצבאות והטבות', kind: 'income', grp: null, emoji: '🤲', color: 'cat-3', icon: 'hand-coins' },
  { key: 'other_income', en: 'Other income', he: 'הכנסות אחרות', kind: 'income', grp: null, emoji: '💰', color: 'cat-1', icon: 'plus-circle' },
  { key: 'rent', en: 'Rent', he: 'שכר דירה', kind: 'expense', grp: 'fixed', emoji: '🏠', color: 'cat-1', icon: 'home' },
  { key: 'mortgage', en: 'Mortgage', he: 'משכנתא', kind: 'expense', grp: 'fixed', isDebt: true, emoji: '🏦', color: 'cat-7', icon: 'landmark', extra: true },
  { key: 'loans', en: 'Loan repayments', he: 'החזרי הלוואות', kind: 'expense', grp: 'fixed', isDebt: true, emoji: '🧾', color: 'cat-8', icon: 'banknote', aliases: ['Loans', 'הלוואות'] },
  { key: 'utilities', en: 'Municipal tax & utilities', he: 'ארנונה וחשבונות', kind: 'expense', grp: 'fixed', emoji: '💡', color: 'cat-4', icon: 'zap' },
  { key: 'phone', en: 'Phone & internet', he: 'טלפון ואינטרנט', kind: 'expense', grp: 'fixed', emoji: '📱', color: 'cat-3', icon: 'smartphone' },
  { key: 'insurance', en: 'Insurance', he: 'ביטוחים', kind: 'expense', grp: 'fixed', emoji: '🛡️', color: 'cat-7', icon: 'shield' },
  { key: 'education', en: 'Education & childcare', he: 'חינוך ומסגרות', kind: 'expense', grp: 'fixed', emoji: '🎓', color: 'cat-2', icon: 'graduation-cap' },
  { key: 'subscriptions', en: 'Subscriptions', he: 'מנויים', kind: 'expense', grp: 'fixed', emoji: '🔁', color: 'cat-5', icon: 'repeat', extra: true },
  { key: 'bank_fees', en: 'Bank fees', he: 'עמלות בנק', kind: 'expense', grp: 'fixed', emoji: '🏛️', color: 'cat-8', icon: 'percent', extra: true },
  { key: 'groceries', en: 'Groceries', he: 'סופר ומכולת', kind: 'expense', grp: 'variable', emoji: '🛒', color: 'cat-6', icon: 'shopping-cart' },
  { key: 'eating_out', en: 'Eating out', he: 'אוכל בחוץ', kind: 'expense', grp: 'variable', emoji: '🍕', color: 'cat-2', icon: 'utensils' },
  { key: 'transport', en: 'Transport & fuel', he: 'תחבורה ודלק', kind: 'expense', grp: 'variable', emoji: '⛽', color: 'cat-4', icon: 'fuel' },
  { key: 'car', en: 'Car', he: 'רכב', kind: 'expense', grp: 'variable', emoji: '🚗', color: 'cat-1', icon: 'car', extra: true },
  { key: 'health', en: 'Health', he: 'בריאות', kind: 'expense', grp: 'variable', emoji: '🩺', color: 'cat-8', icon: 'heart-pulse' },
  { key: 'clothing', en: 'Clothing', he: 'ביגוד והנעלה', kind: 'expense', grp: 'variable', emoji: '👕', color: 'cat-5', icon: 'shirt', extra: true, mode: 'general' },
  { key: 'home', en: 'Home', he: 'בית', kind: 'expense', grp: 'variable', emoji: '🛋️', color: 'cat-3', icon: 'sofa' },
  { key: 'leisure', en: 'Leisure', he: 'פנאי', kind: 'expense', grp: 'variable', emoji: '🎟️', color: 'cat-7', icon: 'ticket' },
  { key: 'kids', en: 'Kids', he: 'ילדים', kind: 'expense', grp: 'variable', emoji: '🧸', color: 'cat-5', icon: 'baby', extra: true },
  { key: 'gifts', en: 'Gifts & donations', he: 'מתנות ותרומות', kind: 'expense', grp: 'variable', emoji: '🎁', color: 'cat-8', icon: 'gift', extra: true, mode: 'occasional' },
  { key: 'travel', en: 'Travel', he: 'חופשות', kind: 'expense', grp: 'variable', emoji: '✈️', color: 'cat-1', icon: 'plane', extra: true, mode: 'occasional' },
  { key: 'cash', en: 'Cash withdrawals', he: 'משיכות מזומן', kind: 'expense', grp: 'variable', emoji: '💵', color: 'cat-6', icon: 'wallet', extra: true },
  { key: 'card_unsplit', en: 'Credit card (not split)', he: 'כרטיס אשראי (לא מפוצל)', kind: 'expense', grp: 'variable', systemKey: 'card_unsplit', emoji: '💳', color: 'cat-other', icon: 'credit-card' },
  { key: 'pets', en: 'Pets', he: 'חיות מחמד', kind: 'expense', grp: 'variable', emoji: '🐾', color: 'cat-2', icon: 'paw-print', extra: true },
  { key: 'personal_care', en: 'Personal care', he: 'טיפוח', kind: 'expense', grp: 'variable', emoji: '💅', color: 'cat-5', icon: 'sparkles', extra: true, mode: 'general' },
  { key: 'sport', en: 'Sport & fitness', he: 'ספורט וכושר', kind: 'expense', grp: 'variable', emoji: '🏋️', color: 'cat-3', icon: 'dumbbell', extra: true },
  { key: 'other', en: 'Other', he: 'אחר', kind: 'expense', grp: 'variable', emoji: '📦', color: 'cat-other', icon: 'circle-help' },
  { key: 'transfers', en: 'Internal transfers', he: 'העברות פנימיות', kind: 'transfer', grp: null, systemKey: 'transfer', emoji: '🔄', color: 'cat-other', icon: 'arrow-left-right' },
  { key: 'savings', en: 'Savings & investments', he: 'חיסכון והשקעות', kind: 'transfer', grp: null, emoji: '🐷', color: 'cat-7', icon: 'piggy-bank' },
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

export interface SeedRows {
  categories: Record<string, string | number | null>[];
  rules: Record<string, string | number | null>[];
}

export const categoryRow = (d: DefaultCategory, locale: Locale, sort: number) => ({
  id: newId(),
  name: locale === 'he' ? d.he : d.en,
  kind: d.kind,
  grp: d.grp,
  is_debt: d.isDebt ? 1 : 0,
  system_key: d.systemKey ?? null,
  budget_mode: d.mode ?? 'monthly',
  icon: d.icon,
  emoji: d.emoji,
  color: d.color,
  sort,
});

/** Seed rules (deduped) for the categories in `ids` (default key → category id). */
export function seedRuleRows(ids: Map<string, string>) {
  const now = nowIso();
  const seen = new Set<string>();
  const rules: { id: string; field: string; match: string; pattern_norm: string; sign: string; category_id: string; source: 'seed'; created_at: string }[] = [];
  for (const r of SEED_RULES) {
    const pat = norm(r.pattern);
    const k = `${r.field}|${r.match}|${pat}|${r.sign}`;
    const categoryId = ids.get(r.cat);
    if (!categoryId || seen.has(k)) continue;
    seen.add(k);
    rules.push({ id: newId(), field: r.field, match: r.match, pattern_norm: pat, sign: r.sign, category_id: categoryId, source: 'seed', created_at: now });
  }
  return rules;
}

/** Rows for the core default categories (catalog extras excluded) and their seed rules (inserted set-based). */
export function defaultCategoryRows(locale: Locale): SeedRows {
  const ids = new Map<string, string>();
  const categories = DEFAULT_CATEGORIES.filter((d) => !d.extra).map((d, i) => {
    const row = categoryRow(d, locale, i);
    ids.set(d.key, row.id);
    return row;
  });
  return { categories, rules: seedRuleRows(ids) };
}
