import type { AppEnv } from './env';
import type { Role } from '../shared/schemas/me';
import type { HouseholdRow } from './db/rows';
import type { TenantDb } from './db/tenant';

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
  household?: HouseholdRow;
  db?: TenantDb;
}

export interface AppCtx {
  Bindings: AppEnv;
  Variables: AppVars;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any route path / input
export type Ctx = import('hono').Context<AppCtx, any, any>;
