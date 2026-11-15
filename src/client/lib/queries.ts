import { useQuery } from '@tanstack/react-query';
import { get } from '../api';
import type { Account, Category, Rule } from '../../shared/schemas/ledger';

export const QK = {
  accounts: ['accounts'] as const,
  categories: ['categories'] as const,
  rules: ['rules'] as const,
  tx: ['transactions'] as const,
};

export function useAccounts() {
  return useQuery({ queryKey: QK.accounts, queryFn: () => get<{ accounts: Account[]; asOf: string }>('/api/accounts') });
}
export function useCategories() {
  return useQuery({ queryKey: QK.categories, queryFn: () => get<{ categories: Category[] }>('/api/categories'), staleTime: 5 * 60_000 });
}
export function useRules() {
  return useQuery({ queryKey: QK.rules, queryFn: () => get<{ rules: Rule[] }>('/api/rules') });
}
export function useCategoryMap() {
  const q = useCategories();
  return new Map((q.data?.categories ?? []).map((c) => [c.id, c]));
}
/** Every query that depends on transactions (invalidate after any ledger write). */
export const LEDGER_DEPENDENT: readonly (readonly string[])[] = [['transactions'], ['accounts'], ['me'], ['budget'], ['dashboard'], ['forecast'], ['trends'], ['upcoming'], ['recurring'], ['health'], ['review'], ['goals'], ['imports']];
