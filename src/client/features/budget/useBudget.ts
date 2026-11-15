import { useQuery } from '@tanstack/react-query';
import { get } from '../../api';
import type { BudgetView } from '../../../shared/domain/budget';

export type BudgetResponse = BudgetView & {
  history: { month: string; budgetedMinor: number; spentBudgetedMinor: number; expensesMinor: number }[];
  categoryHistory: Record<string, { month: string; spentMinor: number; limitMinor: number | null }[]>;
  asOf: string;
  today: string;
};

export function useBudget(month: string | null) {
  return useQuery({ queryKey: ['budget', month ?? 'default'], queryFn: () => get<BudgetResponse>(`/api/budgets${month ? `?month=${month}` : ''}`) });
}
