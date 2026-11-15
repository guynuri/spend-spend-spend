import { z } from 'zod';

export const roleSchema = z.enum(['owner', 'member', 'viewer']);
export type Role = z.infer<typeof roleSchema>;

export interface MeHousehold {
  id: string;
  name: string;
  role: Role;
}
export interface MeResponse {
  user: { id: string; displayName: string; isSuperAdmin: boolean; locale: 'en' | 'he' | null; theme: 'light' | 'dark' | 'system' | null };
  households: MeHousehold[];
  active: { id: string; name: string; currency: string; timezone: string; hasSampleData: boolean; aiEnabled: boolean; today: string } | null;
  role: Role | null;
  features: { ai: boolean };
  badges: { uncategorized: number; overBudget: boolean };
}

export const patchMeSchema = z
  .object({
    locale: z.enum(['en', 'he']).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
