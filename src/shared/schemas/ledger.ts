import { z } from 'zod';
import { bool01, dateStr, id, minor, posMinor, text } from './common';
import { BANK_IDS } from '../banks';
import { isEmoji } from '../categoryLook';

export const accountType = z.enum(['checking', 'savings', 'cash', 'credit_card', 'investment']);
export const accountCreate = z
  .object({
    name: text(60).min(1),
    type: accountType,
    institution: text(60).optional(),
    bankId: z.enum(BANK_IDS).nullable().optional(),
    accountMask: z.string().regex(/^\d{0,4}$/).optional(),
    openingBalanceMinor: minor.optional(),
    openingDate: dateStr.nullable().optional(),
    includeInForecast: bool01.optional(),
    isLiquid: bool01.optional(),
  })
  .strict();
export const accountPatch = accountCreate.partial().extend({ archived: bool01.optional() }).strict();
export const balanceSet = z.object({ date: dateStr, balanceMinor: minor }).strict();

export const categoryKind = z.enum(['income', 'expense', 'transfer']);
/** How an expense category is budgeted: its own monthly line, pooled into general expenses, or yearly (occasional). */
export const budgetMode = z.enum(['monthly', 'general', 'occasional']);
/** One emoji (see isEmoji), or '' / null to clear it. */
export const categoryEmoji = z
  .string()
  .trim()
  .max(16)
  .refine((v) => v === '' || isEmoji(v), 'emoji')
  .transform((v) => (v === '' ? null : v));
export const categoryColor = z.enum(['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8', 'cat-other']);
export const categoryCreate = z
  .object({
    name: text(40).min(1),
    kind: categoryKind,
    grp: z.enum(['fixed', 'variable']).nullable().optional(),
    isDebt: bool01.optional(),
    budgetMode: budgetMode.optional(),
    /** A subcategory of this top-level category (its kind, group and budget mode come from the parent). */
    parentId: id.optional(),
    emoji: categoryEmoji.nullable().optional(),
    color: categoryColor.optional(),
  })
  .strict();
export const categoryPatch = z
  .object({
    name: text(40).min(1).optional(),
    grp: z.enum(['fixed', 'variable']).nullable().optional(),
    isDebt: bool01.optional(),
    budgetMode: budgetMode.optional(),
    archived: bool01.optional(),
    sort: z.number().int().min(0).max(1000).optional(),
    /** Move under a top-level category, or null to make it top-level. */
    parentId: id.nullable().optional(),
    emoji: categoryEmoji.nullable().optional(),
    color: categoryColor.optional(),
  })
  .strict();

export const ruleField = z.enum(['description', 'operation_type']);
export const ruleMatch = z.enum(['contains', 'equals', 'starts_with']);
export const ruleSign = z.enum(['any', 'in', 'out']);
/** Rows (e.g. a card statement) to look up the winning rule's category for. */
export const ruleLookup = z.object({ items: z.array(z.object({ description: text(300), amountMinor: minor }).strict()).max(5000) }).strict();
/** Business → category choices from a card split, remembered as rules (`ai` when the AI suggestion was kept). */
export const ruleLearn = z
  .object({ items: z.array(z.object({ description: text(300).min(1), amountMinor: minor, categoryId: id, source: z.enum(['learned', 'ai']) }).strict()).min(1).max(30) })
  .strict();
/** Rows that are not transactions yet (card statement businesses) for AI categorization. */
export const aiCategorizeItems = z.object({ items: z.array(z.object({ description: text(300).min(1), amountMinor: minor }).strict()).min(1).max(40) }).strict();
export const ruleCreate = z.object({ field: ruleField, match: ruleMatch, pattern: text(100).min(1), sign: ruleSign, categoryId: id }).strict();
export const rulePatch = z.object({ match: ruleMatch.optional(), pattern: text(100).min(1).optional(), sign: ruleSign.optional(), categoryId: id.optional() }).strict();

export const txCreate = z
  .object({
    date: dateStr,
    amountMinor: posMinor.refine((v) => v > 0, 'must be positive'),
    direction: z.enum(['in', 'out']),
    description: text(300).default(''),
    accountId: id,
    categoryId: id.nullable().optional(),
    notes: text(500).optional(),
  })
  .strict();
export const txPatch = z
  .object({
    categoryId: id.nullable().optional(),
    notes: text(500).nullable().optional(),
    description: text(300).optional(),
    date: dateStr.optional(),
    amountMinor: posMinor.refine((v) => v > 0).optional(),
    direction: z.enum(['in', 'out']).optional(),
    accountId: id.optional(),
    kind: z.enum(['normal', 'card_lump']).optional(),
    recurringId: id.nullable().optional(),
    recurringDue: dateStr.nullable().optional(),
    learn: z.boolean().optional(),
    /** Card charges: the card account it pays, or null = not a card bill (never linked automatically again). */
    cardAccountId: id.nullable().optional(),
  })
  .strict();
export const splitsPut = z.object({ lines: z.array(z.object({ categoryId: id.nullable(), amountMinor: minor, note: text(120).optional() }).strict()).max(30) }).strict();
export const bulkCategorize = z.object({ ids: z.array(id).min(1).max(500), categoryId: id.nullable() }).strict();
export const undoLearn = z
  .object({ ruleId: id, txIds: z.array(id).max(5000).optional(), previous: z.object({ categoryId: id, source: z.enum(['user', 'learned', 'ai', 'seed']) }).strict().nullable().optional() })
  .strict();

export const txQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  account: id.optional(),
  category: id.optional(),
  uncategorized: z.enum(['1', 'true']).optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().max(200).optional(),
  kind: z.enum(['card_lump']).optional(),
});

export interface Account {
  id: string;
  name: string;
  type: z.infer<typeof accountType>;
  institution: string | null;
  bankId: string | null;
  accountMask: string | null;
  openingBalanceMinor: number;
  openingDate: string | null;
  includeInForecast: boolean;
  isLiquid: boolean;
  archived: boolean;
  balanceMinor: number;
  balanceDate: string | null;
  varianceMinor: number | null;
  latestSnapshot: { date: string; balanceMinor: number; source: string } | null;
}
export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  grp: 'fixed' | 'variable' | null;
  isDebt: boolean;
  /** Expense categories: 'monthly' | 'general' | 'occasional' (always 'monthly' for income / transfer). */
  budgetMode: 'monthly' | 'general' | 'occasional';
  systemKey: string | null;
  icon: string | null;
  /** Palette slot (cat-1..cat-8, cat-other) or null (a stable one is derived from the id). */
  color: string | null;
  emoji: string | null;
  /** The top-level category this one is a subcategory of. */
  parentId: string | null;
  sort: number;
  archived: boolean;
}
export interface Rule {
  id: string;
  field: 'description' | 'operation_type';
  match: 'contains' | 'equals' | 'starts_with';
  pattern: string;
  sign: 'any' | 'in' | 'out';
  categoryId: string;
  source: 'user' | 'learned' | 'ai' | 'seed';
  hits: number;
}
export interface SplitLine {
  id?: string;
  categoryId: string | null;
  amountMinor: number;
  note?: string | null;
}
export interface Tx {
  id: string;
  accountId: string;
  date: string;
  valueDate: string | null;
  amountMinor: number;
  description: string;
  reference: string | null;
  operationType: string | null;
  categoryId: string | null;
  categorySource: 'user' | 'rule' | 'ai' | null;
  hasSplits: boolean;
  splits: SplitLine[];
  kind: 'normal' | 'card_lump';
  notes: string | null;
  recurringId: string | null;
  recurringDue: string | null;
  plannedId: string | null;
  importId: string | null;
  source: 'import' | 'manual';
  balanceAfterMinor: number | null;
  /** A bank card charge booked as the bill of this credit-card account (its purchases are the spending). */
  cardAccountId: string | null;
  /** Added by a phone automation (Apple Pay); replaced by the card file's row when that is imported. */
  captured: boolean;
}
export interface TxList {
  items: Tx[];
  nextCursor: string | null;
  summary: { count: number; inMinor: number; outMinor: number };
  range: { from: string; to: string };
}
