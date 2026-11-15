import { useQuery } from '@tanstack/react-query';
import { get } from '../../api';

export interface AiStatus {
  available: boolean;
  enabled: boolean;
  provider: string | null;
  label: string | null;
  model: string | null;
  trainsOnInputs: boolean | null;
  usageToday: { categorize: number; review: number };
  limits: { categorize: number; review: number; globalDaily: number };
  consentAt: string | null;
}
export const useAiStatus = () => useQuery({ queryKey: ['ai-status'], queryFn: () => get<AiStatus>('/api/ai/status') });
