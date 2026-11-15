import type { z } from 'zod';
import type { AppEnv } from '../env';

export class AiError extends Error {
  constructor(public code: 'ai_bad_output' | 'ai_unavailable' | 'ai_timeout') {
    super(code);
  }
}

export interface AiProvider {
  id: 'workers-ai' | 'openai-compatible' | 'mock';
  info: { label: string; model: string; trainsOnInputs: boolean; note: string };
  generateJson<T>(req: { system: string; user: string; schema: z.ZodType<T>; maxTokens: number; temperature: number }): Promise<{ data: T; tokensIn: number; tokensOut: number }>;
}

type Factory = (env: AppEnv) => AiProvider | null;
const factories: Record<string, Factory> = {};
export function registerProvider(id: string, f: Factory) {
  factories[id] = f;
}

/** null when AI_PROVIDER = 'none' or the provider is misconfigured. */
export function getProvider(env: AppEnv): AiProvider | null {
  const f = factories[env.AI_PROVIDER];
  return f ? f(env) : null;
}
