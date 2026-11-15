import type { TenantDb } from '../tenant';

/** Recurring detection after imports (filled in M6). */
export async function afterImportCommitted(_q: TenantDb, _today: string): Promise<void> {}
