import { z } from 'zod';
import { dateStr, id, posMinor, text } from './common';

export const recurringCreate = z
  .object({
    name: text(60).min(1),
    kind: z.enum(['expense', 'income', 'card_charge']),
    amountMinor: posMinor,
    amountMode: z.enum(['fixed', 'estimated']).optional(),
    cadence: z.enum(['weekly', 'monthly', 'bimonthly', 'quarterly', 'yearly']),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    anchorDate: dateStr,
    startDate: dateStr.nullable().optional(),
    endDate: dateStr.nullable().optional(),
    accountId: id.nullable().optional(),
    categoryId: id.nullable().optional(),
    matchText: text(80).optional(),
  })
  .strict();
export const recurringPatch = recurringCreate.partial().extend({ status: z.enum(['active', 'paused', 'suggested', 'dismissed']).optional() }).strict();
export const overridePut = z.object({ amountMinor: z.number().int().min(-1e11).max(1e11).nullable().optional(), skipped: z.boolean().optional() }).strict();

export const plannedCreate = z
  .object({
    name: text(60).min(1),
    amountMinor: posMinor.refine((v) => v > 0),
    direction: z.enum(['out', 'in']).default('out'),
    date: dateStr,
    categoryId: id.nullable().optional(),
    accountId: id.nullable().optional(),
    cardRecurringId: id.nullable().optional(),
    notes: text(300).optional(),
  })
  .strict();
export const plannedPatch = plannedCreate.partial().extend({ status: z.enum(['planned', 'done', 'cancelled']).optional(), matchedTxId: id.nullable().optional() }).strict();

export interface RecurringDto {
  id: string;
  name: string;
  kind: 'expense' | 'income' | 'card_charge';
  amountMinor: number;
  amountMode: 'fixed' | 'estimated';
  cadence: 'weekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'yearly';
  dayOfMonth: number | null;
  anchorDate: string;
  startDate: string | null;
  endDate: string | null;
  accountId: string | null;
  categoryId: string | null;
  matchNorm: string;
  status: 'active' | 'paused' | 'suggested' | 'dismissed';
  source: string;
  next: { due: string; amountMinor: number; overridden: boolean } | null;
  lastSettled: { due: string; amountMinor: number }[];
}
export interface PlannedDto {
  id: string;
  name: string;
  amountMinor: number;
  date: string;
  categoryId: string | null;
  accountId: string | null;
  cardRecurringId: string | null;
  status: 'planned' | 'done' | 'cancelled';
  matchedTxId: string | null;
  notes: string | null;
}
