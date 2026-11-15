import type { TenantDb } from '../tenant';

/**
 * Post-write passes for transactions (recurring settlement, planned matching). Filled in M6;
 * called after manual add/edit and after import commit.
 */
export async function afterTransactionsWritten(_q: TenantDb, _scope: { importId?: string; ids?: string[] }, _today: string): Promise<void> {}
