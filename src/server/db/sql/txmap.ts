import type { SplitLine, Tx } from '../../../shared/schemas/ledger';

export const TX_COLS = `t.id, t.account_id, t.date, t.value_date, t.amount_minor, t.description, t.reference, t.operation_type, t.category_id,
  t.category_source, t.has_splits, t.kind, t.notes, t.recurring_id, t.recurring_due, t.planned_id, t.import_id, t.source, t.balance_after_minor`;

export function mapTx(r: Record<string, unknown>, splits: SplitLine[] = []): Tx {
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    date: r.date as string,
    valueDate: (r.value_date as string) ?? null,
    amountMinor: r.amount_minor as number,
    description: r.description as string,
    reference: (r.reference as string) ?? null,
    operationType: (r.operation_type as string) ?? null,
    categoryId: (r.category_id as string) ?? null,
    categorySource: (r.category_source as Tx['categorySource']) ?? null,
    hasSplits: r.has_splits === 1,
    splits,
    kind: r.kind as Tx['kind'],
    notes: (r.notes as string) ?? null,
    recurringId: (r.recurring_id as string) ?? null,
    recurringDue: (r.recurring_due as string) ?? null,
    plannedId: (r.planned_id as string) ?? null,
    importId: (r.import_id as string) ?? null,
    source: r.source as Tx['source'],
    balanceAfterMinor: (r.balance_after_minor as number) ?? null,
  };
}
