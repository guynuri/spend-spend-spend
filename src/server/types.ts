import type { AppEnv } from './env';
import type { Role } from '../shared/schemas/me';

export interface SessionInfo {
  tokenHash: string;
  userId: string;
  activeHouseholdId: string | null;
  isSuperAdmin: boolean;
}

export interface AppVars {
  rid: string;
  userId?: string;
  session?: SessionInfo;
  householdId?: string;
  role?: Role;
}

export interface AppCtx {
  Bindings: AppEnv;
  Variables: AppVars;
}
