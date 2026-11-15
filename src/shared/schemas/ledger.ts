import { z } from 'zod';
import { bool01, dateStr, id, minor, posMinor, text } from './common';
import { BANK_IDS } from '../banks';

export const accountType = z.enum(['checking', 'savings', 'cash', 'credit_card']);
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
export const categoryCreate = z.object({ name: text(40).min(1), kind: categoryKind, grp: z.enum(['fixed', 'variable']).nullable().optional(), isDebt: bool01.optional() }).strict();
export const categoryPatch = z.object({ name: text(40).min(1).optional(), grp: z.enum(['fixed', 'variable']).nullable().optional(), isDebt: bool01.optional(), archived: bool01.optional(), sort: z.number().int().min(0).max(1000).optional() }).strict();

export const ruleField = z.enum(['description', 'operation_type']);
export const ruleMatch = z.enum(['contains', 'equals', 'starts_with']);
export const ruleSign = z.enum(['any', 'in', 'out']);
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
  systemKey: string | null;
  icon: string | null;
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
}
export interface TxList {
  items: Tx[];
  nextCursor: string | null;
  summary: { count: number; inMinor: number; outMinor: number };
  range: { from: string; to: string };
}
