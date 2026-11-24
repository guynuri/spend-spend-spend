import { z } from 'zod';
import { HOME_WIDGETS, type HomeWidgetId } from '../home';

export const roleSchema = z.enum(['owner', 'member', 'viewer']);
export type Role = z.infer<typeof roleSchema>;

export interface MeHousehold {
  id: string;
  name: string;
  role: Role;
}
export interface MeResponse {
  user: { id: string; displayName: string; isSuperAdmin: boolean; locale: 'en' | 'he' | null; theme: 'light' | 'dark' | 'system' | null; /** Home widgets in order; null = the default layout. */ homeWidgets: HomeWidgetId[] | null };
  households: MeHousehold[];
  active: { id: string; name: string; currency: string; timezone: string; hasSampleData: boolean; aiEnabled: boolean; today: string; periodStartDay: number; statsByPeriod: boolean } | null;
  role: Role | null;
  features: { ai: boolean };
  /** reviewDue: month (YYYY-MM) whose monthly review is ready and not yet completed/dismissed. */
  badges: { uncategorized: number; overBudget: boolean; reviewDue: string | null };
}

export const patchMeSchema = z
  .object({
    locale: z.enum(['en', 'he']).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    displayName: z.string().trim().min(1).max(60).optional(),
    /** Home widgets in order (no repeats); null resets to the default. */
    homeWidgets: z
      .array(z.enum(HOME_WIDGETS))
      .max(HOME_WIDGETS.length)
      .refine((a) => new Set(a).size === a.length, { message: 'duplicate' })
      .nullable()
      .optional(),
  })
  .strict();
