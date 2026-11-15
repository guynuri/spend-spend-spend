import type { z } from 'zod';
import { AiError } from './provider';

/** First balanced JSON object or array in a model reply. */
export function extractJson(text: string): unknown {
  const start = text.search(/[{[]/);
  if (start < 0) throw new AiError('ai_bad_output');
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        throw new AiError('ai_bad_output');
      }
    }
  }
  throw new AiError('ai_bad_output');
}

/** Calls `ask` (with a 20 s timeout), validates with zod, retries once on invalid output. */
export async function generateValidated<T>(ask: (signal: AbortSignal) => Promise<{ text: string; tokensIn: number; tokensOut: number }>, schema: z.ZodType<T>) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const r = await ask(ctrl.signal);
      const parsed = schema.safeParse(extractJson(r.text));
      if (parsed.success) return { data: parsed.data, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
      lastErr = new AiError('ai_bad_output');
    } catch (e) {
      if (ctrl.signal.aborted) throw new AiError('ai_timeout');
      if (e instanceof AiError && e.code !== 'ai_bad_output') throw e;
      lastErr = e instanceof AiError ? e : new AiError('ai_unavailable');
      if (!(e instanceof AiError)) throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof AiError ? lastErr : new AiError('ai_bad_output');
}
