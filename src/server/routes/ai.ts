import { z } from 'zod';
import { tenantGroup } from './tenant';
import { tctx } from '../ctx';
import { HttpError, body } from '../http';
import type { Ctx } from '../types';
import { requireOwner } from '../middleware/auth';
import { AiError, getProvider, type AiProvider } from '../ai/provider';
import { CATEGORIZE_SYSTEM, reviewSystem } from '../ai/prompts';
import { buildCategorizePayload, buildReviewPayload } from '../../shared/ai/payloads';
import { norm } from '../../shared/normalize';
import { id, monthStr } from '../../shared/schemas/common';
import { newId, nowIso } from '../lib/crypto';
import { AI_LIMITS, recordTokensStmt, reserveStmt, usageToday } from '../db/sql/aiUsage';
import { buildReviewFor } from '../db/sql/review';

export const aiRoutes = tenantGroup();

const aiErrorStatus = { ai_bad_output: 502, ai_unavailable: 503, ai_timeout: 504 } as const;

/** Gate (PLAN §11.3): provider → household opt-in → limits → reserve a call. */
async function gate(c: Ctx, feature: 'categorize' | 'review', reserve = true): Promise<AiProvider> {
  const p = getProvider(c.env);
  if (!p) throw new HttpError(503, 'ai_unavailable', 'AI is not configured');
  const { db, hh } = tctx(c);
  if (hh.ai_enabled !== 1) throw new HttpError(403, 'ai_disabled', 'AI is off for this household');
  const u = await usageToday(db);
  if (u[feature] >= AI_LIMITS[feature] || u.global >= Number(c.env.AI_GLOBAL_DAILY_CALLS || 150)) throw new HttpError(429, 'ai_rate_limited', 'Daily AI limit reached');
  if (reserve) await reserveStmt(db, feature).run();
  return p;
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiError) throw new HttpError(aiErrorStatus[e.code], e.code, 'AI call failed');
    throw new HttpError(503, 'ai_unavailable', 'AI call failed');
  }
}

aiRoutes.get('/status', async (c) => {
  const { db, hh } = tctx(c);
  const p = getProvider(c.env);
  const u = await usageToday(db);
  return c.json({
    available: !!p,
    enabled: hh.ai_enabled === 1,
    provider: p?.id ?? null,
    label: p?.info.label ?? null,
    model: p?.info.model ?? null,
    trainsOnInputs: p?.info.trainsOnInputs ?? null,
    usageToday: { categorize: u.categorize, review: u.review },
    limits: { categorize: AI_LIMITS.categorize, review: AI_LIMITS.review, globalDaily: Number(c.env.AI_GLOBAL_DAILY_CALLS || 150) },
    consentAt: hh.ai_consent_at,
    consentProvider: hh.ai_consent_provider,
  });
});

/** Owner-only opt-in / opt-out; consent (who/when/provider) is recorded (AC13.1). */
aiRoutes.post('/consent', requireOwner, async (c) => {
  const b = await body(c, z.object({ enabled: z.boolean() }).strict());
  const p = getProvider(c.env);
  if (b.enabled && !p) throw new HttpError(503, 'ai_unavailable', 'AI is not configured');
  const { db, userId } = tctx(c);
  await db.members.setAi(b.enabled, userId, p ? `${p.id}:${p.info.model}` : 'none');
  await db.audit(userId, b.enabled ? 'ai.enable' : 'ai.disable', 'household', db.householdId).run();
  return c.json({ ok: true });
});

const catOut = z.array(z.object({ i: z.number().int(), category: z.string().max(80), confidence: z.number().min(0).max(1).optional(), reason: z.string().transform((x) => x.slice(0, 120)).optional() }));

/** All-time count of what /categorize can look at (the nav badge only covers 60 days). */
aiRoutes.get('/uncategorized', async (c) => {
  const { db } = tctx(c);
  const r = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE household_id = ?1 AND category_id IS NULL AND has_splits = 0 AND description_norm <> ''");
  return c.json({ count: r?.n ?? 0 });
});

aiRoutes.post('/categorize', async (c) => {
  const { db } = tctx(c);
  await gate(c, 'categorize', false);
  const [rows, cats] = await Promise.all([
    db.all<{ key: string; description: string; operationType: string | null; amountMinor: number; n: number }>(
      `SELECT t.description_norm AS key, MIN(t.description) AS description, MIN(t.operation_type) AS operationType, MIN(t.amount_minor) AS amountMinor, COUNT(*) AS n
         FROM transactions t WHERE t.household_id = ?1 AND t.category_id IS NULL AND t.has_splits = 0 AND t.description_norm <> ''
        GROUP BY t.description_norm ORDER BY n DESC LIMIT 200`,
    ),
    db.all<{ id: string; name: string; kind: string }>("SELECT id, name, kind FROM categories WHERE household_id = ?1 AND archived = 0 AND kind <> 'transfer' AND system_key IS NULL"),
  ]);
  const { payload, keys } = buildCategorizePayload(rows, cats.map((x) => x.name));
  if (!payload.items.length) return c.json({ suggestions: [] });
  const p = await gate(c, 'categorize');
  // Batches of 20 keep each reply (with reasons) well inside maxTokens; one reserved call per request.
  const res = { data: [] as z.infer<typeof catOut>, tokensIn: 0, tokensOut: 0 };
  for (let k = 0; k < payload.items.length; k += 20) {
    const part = await run(() => p.generateJson({ system: CATEGORIZE_SYSTEM, user: JSON.stringify({ task: 'categorize', ...payload, items: payload.items.slice(k, k + 20) }), schema: catOut, maxTokens: 1600, temperature: 0 }));
    res.data.push(...part.data);
    res.tokensIn += part.tokensIn;
    res.tokensOut += part.tokensOut;
  }
  await recordTokensStmt(db, 'categorize', res.tokensIn, res.tokensOut).run();
  const byName = new Map(cats.map((x) => [norm(x.name), x.id]));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const suggestions = res.data
    .map((o) => ({ key: keys[o.i], categoryId: byName.get(norm(o.category)), confidence: o.confidence ?? null, reason: o.reason?.trim() || null }))
    .filter((s): s is { key: string; categoryId: string; confidence: number | null; reason: string | null } => !!s.key && !!s.categoryId)
    .map((s) => {
      const r = byKey.get(s.key)!;
      return { ...s, description: r.description, count: r.n, amountMinor: r.amountMinor, direction: r.amountMinor >= 0 ? 'in' : 'out' };
    });
  return c.json({ suggestions });
});

/** Applies accepted suggestions: category_source='ai' and an `ai` rule per merchant (D-16). */
aiRoutes.post('/categorize/apply', async (c) => {
  const b = await body(c, z.object({ items: z.array(z.object({ key: z.string().min(1).max(300), categoryId: id, direction: z.enum(['in', 'out']) }).strict()).min(1).max(40) }).strict());
  const { db } = tctx(c);
  await db.assertOwned({ categories: b.items.map((i) => i.categoryId) });
  const now = nowIso();
  const res = await db.batch(
    b.items.flatMap((i) => [
      db.stmt(
        `UPDATE transactions SET category_id = ?2, category_source = 'ai', updated_at = ?3
          WHERE household_id = ?1 AND category_id IS NULL AND has_splits = 0 AND description_norm = ?4 AND ((?5 = 'in' AND amount_minor > 0) OR (?5 = 'out' AND amount_minor < 0))`,
        i.categoryId,
        now,
        i.key,
        i.direction,
      ),
      db.stmt(
        `INSERT INTO category_rules (id, household_id, field, match, pattern_norm, sign, category_id, source, created_at)
         SELECT ?2, ?1, 'description', 'equals', ?3, ?4, ?5, 'ai', ?6 WHERE EXISTS (SELECT 1 FROM categories WHERE household_id = ?1 AND id = ?5)
         ON CONFLICT(household_id, field, match, pattern_norm, sign) DO NOTHING`,
        newId(),
        i.key,
        i.direction,
        i.categoryId,
        now,
      ),
    ]),
  );
  return c.json({ updated: res.filter((_, k) => k % 2 === 0).reduce((s, r) => s + (r.meta.changes ?? 0), 0) });
});

const reviewOut = z.object({
  headline: z.string().min(1).max(400),
  commentary: z.object({ summary: z.string().max(600), income: z.string().max(600), spending: z.string().max(600), budget: z.string().max(600), goals: z.string().max(600), cashflow: z.string().max(600), wrapup: z.string().max(600) }),
});

/** AI commentary for a review; stored on the draft (or kept beside a completed snapshot). */
aiRoutes.post('/review/:month', async (c) => {
  const m = monthStr.safeParse(c.req.param('month'));
  if (!m.success) throw new HttpError(400, 'validation', 'Bad month');
  const { db, hh } = tctx(c);
  const language = c.req.header('x-mz-locale') === 'he' ? 'he' : 'en';
  const row = await db.first<{ status: string; snapshot_json: string | null }>('SELECT status, snapshot_json FROM reviews WHERE household_id = ?1 AND month = ?2', m.data);
  const snap = row?.status === 'completed' && row.snapshot_json ? JSON.parse(row.snapshot_json) : await buildReviewFor(db, hh, m.data);
  const p = await gate(c, 'review');
  const res = await run(() => p.generateJson({ system: reviewSystem(language), user: JSON.stringify({ task: 'review', language, data: buildReviewPayload(snap) }), schema: reviewOut, maxTokens: 700, temperature: 0.4 }));
  const ai = { ...res.data, language, model: p.info.model, provider: p.id, createdAt: nowIso() };
  await db.batch([
    recordTokensStmt(db, 'review', res.tokensIn, res.tokensOut),
    db.stmt(
      `INSERT INTO reviews (id, household_id, month, status, ai_json) VALUES (?2, ?1, ?3, 'draft', ?4)
       ON CONFLICT(household_id, month) DO UPDATE SET ai_json = excluded.ai_json WHERE reviews.household_id = ?1`,
      newId(),
      m.data,
      JSON.stringify(ai),
    ),
  ]);
  return c.json(ai);
});
