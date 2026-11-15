import { z } from 'zod';
import { isValidDate, isValidMonth } from '../dates';

export const id = z.string().min(1).max(40);
export const dateStr = z.string().refine(isValidDate, 'invalid date');
export const monthStr = z.string().refine(isValidMonth, 'invalid month');
export const minor = z.number().int().min(-1e11).max(1e11);
export const posMinor = z.number().int().min(0).max(1e11);
export const text = (max: number) => z.string().trim().max(max);
export const bool01 = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));
