import type { AppEnv } from '../env';
import { AiError, registerProvider, type AiProvider } from './provider';
import { generateValidated } from './json';

const msgs = (system: string, user: string) => [
  { role: 'system', content: system },
  { role: 'user', content: user },
];

/** Cloudflare Workers AI: binding in the same Worker, no key; customer content is not used for training. */
registerProvider('workers-ai', (env: AppEnv) => {
  if (!env.AI) return null;
  const ai = env.AI as unknown as { run(model: string, input: unknown, opts?: unknown): Promise<unknown> };
  const p: AiProvider = {
    id: 'workers-ai',
    info: { label: 'Cloudflare Workers AI', model: env.AI_MODEL, trainsOnInputs: false, note: 'workers-ai' },
    generateJson: (req) =>
      generateValidated(async () => {
        let out: unknown;
        try {
          out = await ai.run(env.AI_MODEL, { messages: msgs(req.system, req.user), max_tokens: req.maxTokens, temperature: req.temperature });
        } catch {
          throw new AiError('ai_unavailable');
        }
        const o = out as { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: string } }[] };
        const text = typeof o.response === 'string' ? o.response : o.response ? JSON.stringify(o.response) : (o.choices?.[0]?.message?.content ?? '');
        return { text, tokensIn: o.usage?.prompt_tokens ?? 0, tokensOut: o.usage?.completion_tokens ?? 0 };
      }, req.schema),
  };
  return p;
});

/** Any OpenAI-compatible chat API (e.g. Groq). The key stays server-side (AI_API_KEY secret). */
registerProvider('openai-compatible', (env: AppEnv) => {
  if (!env.AI_BASE_URL || !env.AI_API_KEY) return null;
  const base = env.AI_BASE_URL.replace(/\/$/, '');
  return {
    id: 'openai-compatible',
    info: { label: new URL(base).hostname, model: env.AI_MODEL, trainsOnInputs: env.AI_TRAINS_ON_INPUTS === 'true', note: 'openai-compatible' },
    generateJson: (req) =>
      generateValidated(async (signal) => {
        let res: Response;
        try {
          res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            signal,
            headers: { Authorization: `Bearer ${env.AI_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: env.AI_MODEL, messages: msgs(req.system, req.user), max_tokens: req.maxTokens, temperature: req.temperature }),
          });
        } catch (e) {
          if (signal.aborted) throw e;
          throw new AiError('ai_unavailable');
        }
        if (!res.ok) throw new AiError('ai_unavailable');
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        return { text: j.choices?.[0]?.message?.content ?? '', tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
      }, req.schema),
  } satisfies AiProvider;
});

/** Deterministic canned output derived from the request (tests and local e2e only). */
registerProvider('mock', (env: AppEnv) => ({
  id: 'mock',
  info: { label: 'Mock provider (test)', model: env.AI_MODEL || 'mock', trainsOnInputs: false, note: 'mock' },
  generateJson: (req) =>
    generateValidated(async () => {
      const u = JSON.parse(req.user) as { task: string; language?: string; categories?: string[]; items?: { i: number; text: string; dir: string }[]; data?: { month: string } };
      if (u.task === 'categorize') {
        if (u.items?.some((it) => it.text.includes('MOCK_FAIL'))) throw new AiError('ai_unavailable');
        const cats = u.categories ?? [];
        return { text: JSON.stringify((u.items ?? []).map((it) => ({ i: it.i, category: cats[(it.text.length + it.i) % Math.max(1, cats.length)] ?? 'none', confidence: it.i % 2 ? 0.5 : 0.9, reason: 'Mock guess' }))), tokensIn: 10, tokensOut: 10 };
      }
      const he = u.language === 'he';
      const w = (en: string, h: string) => (he ? h : en);
      const commentary = Object.fromEntries(['summary', 'income', 'spending', 'budget', 'goals', 'cashflow', 'wrapup'].map((k) => [k, w(`AI note on ${k} for ${u.data?.month}.`, `הערת AI על ${k} עבור ${u.data?.month}.`)]));
      return { text: `Here you go: ${JSON.stringify({ headline: w('AI headline: a steady month.', 'כותרת AI: חודש יציב.'), commentary })}`, tokensIn: 100, tokensOut: 60 };
    }, req.schema),
}));
